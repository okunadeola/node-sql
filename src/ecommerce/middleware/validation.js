/**
 * Validation Middleware
 * Provides request validation using Joi
 */
const Joi = require('joi');
const { ValidationError } = require('../utils/error');

/**
 * Validate request body, query parameters, or URL parameters
 * @param {Object} schema - Joi validation schema
 * @param {string} source - Request property to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware
 */
exports.validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const data = req[source];
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
      errors: { wrap: { label: false } }
    });
    
    if (error) {
      const errorDetails = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return next(new ValidationError('Validation failed', 400, 'VALIDATION_ERROR', errorDetails));
    }
    
    // Replace the request data with the validated value
    req[source] = value;
    next();
  };
};

/**
 * Common validation schemas
 */
exports.schemas = {
  // User validation schemas
  user: {
    create: Joi.object({
      username: Joi.string().alphanum().min(3).max(50).required(),
      email: Joi.string().email().required(),
      password: Joi.string().min(8).required(),
      first_name: Joi.string().max(50),
      last_name: Joi.string().max(50),
      phone: Joi.string().max(20),
      address: Joi.object({
        address_line1: Joi.string().required(),
        address_line2: Joi.string().allow('', null),
        city: Joi.string().required(),
        state: Joi.string().allow('', null),
        postal_code: Joi.string().required(),
        country: Joi.string().required()
      }),
      role: Joi.string().valid('customer', 'admin', 'seller').default('customer')
    }),
    
    update: Joi.object({
      username: Joi.string().alphanum().min(3).max(50),
      email: Joi.string().email(),
      first_name: Joi.string().max(50),
      last_name: Joi.string().max(50),
      phone: Joi.string().max(20),
      address: Joi.object({
        address_line1: Joi.string(),
        address_line2: Joi.string().allow('', null),
        city: Joi.string(),
        state: Joi.string().allow('', null),
        postal_code: Joi.string(),
        country: Joi.string()
      })
    }).min(1),
    
    login: Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().required()
    }),

     email: Joi.object({
      email: Joi.string().email().required()
    }),

     resetPassword: Joi.object({
      token: Joi.string().required(),
      password: Joi.string().min(8).required(),
      password_confirm: Joi.string().valid(Joi.ref('password')).required()
        .messages({ 'any.only': 'Passwords must match' })
    }),
    
    changePassword: Joi.object({
      current_password: Joi.string().required(),
      new_password: Joi.string().min(8).required(),
      confirm_password: Joi.string().valid(Joi.ref('new_password')).required()
        .messages({ 'any.only': 'Passwords do not match' })
    }),

    userProfile: Joi.object({
      username: Joi.string().alphanum().min(3).max(50),
      first_name: Joi.string().max(50),
      last_name: Joi.string().max(50),
      phone: Joi.string().max(20),
      email: Joi.string().email(),
    }),

    userAdmin: Joi.object({
      username: Joi.string().alphanum().min(3).max(50),
      email: Joi.string().email(),
      first_name: Joi.string().max(50),
      last_name: Joi.string().max(50),
      phone: Joi.string().max(20),
      role: Joi.string().valid('customer', 'admin', 'seller')
    }),

    userStatus: Joi.object({
      account_status: Joi.string().valid('active', 'suspended', 'banned').required()
    }),
    
    verificationToken: Joi.object({
      token: Joi.string().required()
    }),

    address: Joi.object({
      is_default: Joi.boolean().default(false),
      address_type: Joi.string().valid('billing', 'shipping', 'both').required(),
      first_name: Joi.string().max(50).required(),
      last_name: Joi.string().max(50).required(),
      address_line1: Joi.string().max(255).required(),
      address_line2: Joi.string().max(255).allow('', null),
      city: Joi.string().max(100).required(),
      state: Joi.string().max(100).allow('', null),
      postal_code: Joi.string().max(20).required(),
      country: Joi.string().max(100).required(),
      phone: Joi.string().max(20).allow('', null)
    }),
    
    wishlist: Joi.object({
      name: Joi.string().max(100).required(),
      is_public: Joi.boolean().default(false)
    }),

    apiToken: Joi.object({
      name: Joi.string().max(100).required(),
      permissions: Joi.array().items(
        Joi.string().valid('read', 'write', 'products', 'orders', 'users')
      ).min(1).required(),
      expires_in: Joi.number().integer().min(1).max(365).default(30) // Days
    })
  },
  
  // Product validation schemas
  product: {
    create: Joi.object({
      name: Joi.string().max(255).required(),
      description: Joi.string().allow('', null),
      sku: Joi.string().max(50),
      price: Joi.number().positive().required(),
      compare_price: Joi.number().positive().allow(null)
        .when('price', {
          is: Joi.exist(),
          then: Joi.number().greater(Joi.ref('price')).message('Compare price must be greater than regular price')
        }),
      cost_price: Joi.number().positive().allow(null),
      category_id: Joi.string().uuid().required(),
      brand: Joi.string().max(100).allow('', null),
      weight: Joi.number().positive().allow(null),
      dimensions: Joi.object({
        length: Joi.number().positive(),
        width: Joi.number().positive(),
        height: Joi.number().positive()
      }).allow(null),
      is_physical: Joi.boolean().default(true),
      is_active: Joi.boolean().default(true),
      is_featured: Joi.boolean().default(false),
      attributes: Joi.array().items(
        Joi.object({
          name: Joi.string().required(),
          value: Joi.alternatives().try(
            Joi.string(), Joi.number(), Joi.boolean(), Joi.object()
          ).required()
        })
      ),
      inventory: Joi.object({
        quantity: Joi.number().integer().min(0).required(),
        low_stock_threshold: Joi.number().integer().min(0).default(5),
        warehouse_location: Joi.string().allow('', null)
      })
    }),
    
    update: Joi.object({
      name: Joi.string().max(255),
      description: Joi.string().allow('', null),
      sku: Joi.string().max(50),
      price: Joi.number().positive(),
      compare_price: Joi.number().positive().allow(null)
        .when('price', {
          is: Joi.exist(),
          then: Joi.number().greater(Joi.ref('price')).message('Compare price must be greater than regular price')
        }),
      cost_price: Joi.number().positive().allow(null),
      category_id: Joi.string().uuid(),
      brand: Joi.string().max(100).allow('', null),
      weight: Joi.number().positive().allow(null),
      dimensions: Joi.object({
        length: Joi.number().positive(),
        width: Joi.number().positive(),
        height: Joi.number().positive()
      }).allow(null),
      is_physical: Joi.boolean(),
      is_active: Joi.boolean(),
      is_featured: Joi.boolean(),
      attributes: Joi.array().items(
        Joi.object({
          name: Joi.string().required(),
          value: Joi.alternatives().try(
            Joi.string(), Joi.number(), Joi.boolean(), Joi.object()
          ).required()
        })
      )
    }).min(1),
    
    search: Joi.object({
      query: Joi.string().allow('', null),
      category_id: Joi.string().uuid().allow(null),
      brand: Joi.string().allow('', null),
      min_price: Joi.number().min(0),
      max_price: Joi.number().greater(Joi.ref('min_price')),
      sort_by: Joi.string().valid('price_asc', 'price_desc', 'newest', 'oldest', 'name_asc', 'name_desc', 'featured', 'rating').default('created_at_desc'),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      include_out_of_stock: Joi.boolean().default(false)
    })
  },
  
  // Order validation schemas
  order: {
    create: Joi.object({
      user_id: Joi.string().uuid(),
      items: Joi.array().items(
        Joi.object({
          product_id: Joi.string().uuid().required(),
          quantity: Joi.number().integer().min(1).required(),
          custom_attributes: Joi.object().allow(null)
        })
      ).min(1).required(),
      shipping_address: Joi.object({
        first_name: Joi.string().required(),
        last_name: Joi.string().required(),
        address_line1: Joi.string().required(),
        address_line2: Joi.string().allow('', null),
        city: Joi.string().required(),
        state: Joi.string().allow('', null),
        postal_code: Joi.string().required(),
        country: Joi.string().required(),
        phone: Joi.string().allow('', null)
      }).required(),
      billing_address: Joi.object({
        first_name: Joi.string().required(),
        last_name: Joi.string().required(),
        address_line1: Joi.string().required(),
        address_line2: Joi.string().allow('', null),
        city: Joi.string().required(),
        state: Joi.string().allow('', null),
        postal_code: Joi.string().required(),
        country: Joi.string().required(),
        phone: Joi.string().allow('', null)
      }).required(),
      payment_method: Joi.string().required(),
      discount_code: Joi.string().allow('', null),
      notes: Joi.string().allow('', null)
    }),
    
    updateStatus: Joi.object({
      status: Joi.string().valid(
        'pending', 'processing', 'on_hold', 'completed',
        'cancelled', 'refunded', 'failed', 'shipped', 'delivered'
      ).required(),
      comment: Joi.string().allow('', null)
    }),
    
    addPayment: Joi.object({
      amount: Joi.number().positive().required(),
      payment_method: Joi.string().required(),
      payment_provider: Joi.string().required(),
      transaction_id: Joi.string(),
      provider_response: Joi.object().allow(null)
    }),
    // Refund request validation
    refund: Joi.object({
      amount: Joi.number().positive().precision(2).required(),
      reason: Joi.string().max(500).required(),
      items: Joi.array().items(
        Joi.object({
          order_item_id: Joi.string().uuid().required(),
          quantity: Joi.number().integer().min(1).required()
        })
      ),
      refund_shipping: Joi.boolean().default(false)
    }),

    // Order item update validation
    orderItem: Joi.object({
      quantity: Joi.number().integer().min(0).required(),
      price: Joi.number().precision(2).min(0),
      notes: Joi.string().max(500).allow('', null)
    }),

    // Order history entry validation
    orderHistory: Joi.object({
      status: Joi.string().valid(
        'pending', 'processing', 'on_hold', 'completed', 
        'cancelled', 'refunded', 'failed', 'shipped', 'delivered'
      ).required(),
      comment: Joi.string().max(500).required()
    }),
  },

  // Analytics validation schemes
  analytics: {
   dateRange : Joi.object({
      start_date: Joi.date()
        .iso()
        .max('now')
        .required()
        .messages({
          'date.base': 'Start date must be a valid date',
          'date.iso': 'Start date must be in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)',
          'date.max': 'Start date cannot be in the future',
          'any.required': 'Start date is required'
        }),
      
      end_date: Joi.date()
        .iso()
        .min(Joi.ref('start_date'))
        .max('now')
        .required()
        .messages({
          'date.base': 'End date must be a valid date',
          'date.iso': 'End date must be in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)',
          'date.min': 'End date must be after start date',
          'date.max': 'End date cannot be in the future',
          'any.required': 'End date is required'
        }),
      
      // Optional parameters for various endpoints
      limit: Joi.number()
        .integer()
        .min(1)
        .max(1000)
        .optional()
        .messages({
          'number.base': 'Limit must be a number',
          'number.integer': 'Limit must be an integer',
          'number.min': 'Limit must be at least 1',
          'number.max': 'Limit cannot exceed 1000'
        }),
      
      category_id: Joi.string()
        .uuid()
        .optional()
        .messages({
          'string.base': 'Category ID must be a string',
          'string.guid': 'Category ID must be a valid UUID'
        }),
      
      product_id: Joi.string()
        .uuid()
        .optional()
        .messages({
          'string.base': 'Product ID must be a string',
          'string.guid': 'Product ID must be a valid UUID'
        }),
      
      timeframe: Joi.string()
        .valid('7 days', '30 days', '90 days', '1 year')
        .optional()
        .messages({
          'any.only': 'Timeframe must be one of: 7 days, 30 days, 90 days, 1 year'
        }),
      
      group_by: Joi.string()
        .valid('day', 'week', 'month', 'quarter', 'year')
        .optional()
        .messages({
          'any.only': 'Group by must be one of: day, week, month, quarter, year'
        }),
      
      sort_by: Joi.string()
        .valid('date', 'revenue', 'orders', 'customers', 'quantity')
        .optional()
        .messages({
          'any.only': 'Sort by must be one of: date, revenue, orders, customers, quantity'
        }),
      
      sort_order: Joi.string()
        .valid('asc', 'desc')
        .default('desc')
        .optional()
        .messages({
          'any.only': 'Sort order must be either asc or desc'
        })
    }),
  },
  
  // Common pagination and sorting schemas
  common: {
    pagination: Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20)
    }),
    
    uuid: Joi.object({
      id: Joi.string().uuid().required()
    }),
    
    dateRange: Joi.object({
      start_date: Joi.date().iso(),
      end_date: Joi.date().iso().min(Joi.ref('start_date'))
    })
  },


   // Product review validation schemas
  review: {
    create: Joi.object({
      rating: Joi.number().integer().min(1).max(5).required(),
      title: Joi.string().max(255),
      content: Joi.string().allow('', null)
    }),
    
    update: Joi.object({
      rating: Joi.number().integer().min(1).max(5),
      title: Joi.string().max(255),
      content: Joi.string().allow('', null)
    }).min(1), // At least one field must be provided
    
    // Admin review management
    moderate: Joi.object({
      status: Joi.string().valid('pending', 'approved', 'rejected').required()
    })
  },

  // Inventory validation schemas
  inventory: {
    update: Joi.object({
      quantity: Joi.number().integer().min(0).required(),
      warehouse_location: Joi.string().max(100),
      low_stock_threshold: Joi.number().integer().min(0).default(5),
      next_restock_date: Joi.date().iso().greater('now')
    }),
  },
};

/**
 * Generate validation middleware for common use cases
 */
exports.createUser = exports.validate(exports.schemas.user.create);
exports.updateUser = exports.validate(exports.schemas.user.update);
exports.loginUser = exports.validate(exports.schemas.user.login);
exports.changePassword = exports.validate(exports.schemas.user.changePassword);
exports.email = exports.validate(exports.schemas.user.email);
exports.resetPassword = exports.validate(exports.schemas.user.resetPassword);
exports.userProfile = exports.validate(exports.schemas.user.userProfile);
exports.userAdmin = exports.validate(exports.schemas.user.userAdmin);
exports.userStatus = exports.validate(exports.schemas.user.userStatus);
exports.verificationToken = exports.validate(exports.schemas.user.verificationToken);
exports.address = exports.validate(exports.schemas.user.address);
exports.wishlist = exports.validate(exports.schemas.user.wishlist);
exports.apiToken = exports.validate(exports.schemas.user.apiToken);


exports.createProduct = exports.validate(exports.schemas.product.create);
exports.updateProduct = exports.validate(exports.schemas.product.update);
exports.searchProducts = exports.validate(exports.schemas.product.search, 'query');
exports.review = exports.validate(exports.schemas.review.create);
exports.inventory = exports.validate(exports.schemas.review.update);


exports.createOrder = exports.validate(exports.schemas.order.create);
exports.updateOrderStatus = exports.validate(exports.schemas.order.updateStatus);
exports.addOrderPayment = exports.validate(exports.schemas.order.addPayment);
exports.orderItem = exports.validate(exports.schemas.order.orderItem);
exports.orderHistory = exports.validate(exports.schemas.order.orderHistory);
exports.refund = exports.validate(exports.schemas.order.refund);

exports.validateUuid = exports.validate(exports.schemas.common.uuid, 'params');
exports.validatePagination = exports.validate(exports.schemas.common.pagination, 'query');
exports.dateRange = exports.validate(exports.schemas.common.dateRange, 'query');



exports.validateDateRange2 = exports.validate(exports.schemas.analytics.dateRange, 'query');