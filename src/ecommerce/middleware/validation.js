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
    
    changePassword: Joi.object({
      current_password: Joi.string().required(),
      new_password: Joi.string().min(8).required(),
      confirm_password: Joi.string().valid(Joi.ref('new_password')).required()
        .messages({ 'any.only': 'Passwords do not match' })
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
      sort_by: Joi.string().valid('price_asc', 'price_desc', 'newest', 'oldest', 'name_asc', 'name_desc'),
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
    })
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
  }
};

/**
 * Generate validation middleware for common use cases
 */
exports.createUser = exports.validate(exports.schemas.user.create);
exports.updateUser = exports.validate(exports.schemas.user.update);
exports.loginUser = exports.validate(exports.schemas.user.login);
exports.changePassword = exports.validate(exports.schemas.user.changePassword);

exports.createProduct = exports.validate(exports.schemas.product.create);
exports.updateProduct = exports.validate(exports.schemas.product.update);
exports.searchProducts = exports.validate(exports.schemas.product.search, 'query');

exports.createOrder = exports.validate(exports.schemas.order.create);
exports.updateOrderStatus = exports.validate(exports.schemas.order.updateStatus);
exports.addOrderPayment = exports.validate(exports.schemas.order.addPayment);

exports.validateUuid = exports.validate(exports.schemas.common.uuid, 'params');
exports.validatePagination = exports.validate(exports.schemas.common.pagination, 'query');
exports.validateDateRange = exports.validate(exports.schemas.common.dateRange, 'query');