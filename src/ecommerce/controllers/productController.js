/**
 * Product Controller
 * Handles all product-related operations
 */
const productQueries = require('../db/queries/products');
const searchQueries = require('../db/queries/search');
const { NotFoundError, ValidationError } = require('../utils/error');
const logger = require('../utils/logger');

/**
 * Get a list of products with pagination and filtering
 */
exports.listProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, category, sort, priceMin, priceMax, brand, featured } = req.query;
    
    // Build filter object
    const filters = {};
    if (category) filters.category_id = category;
    if (brand) filters.brand = brand;
    if (featured === 'true') filters.is_featured = true;
    if (priceMin || priceMax) {
      filters.price = {};
      if (priceMin) filters.price.min = parseFloat(priceMin);
      if (priceMax) filters.price.max = parseFloat(priceMax);
    }
    
    // Always filter for active products in public API
    filters.is_active = true;
    
    const products = await productQueries.findProducts(filters, {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: sort || 'created_at:desc'
    });
    
    res.status(200).json({
      success: true,
      data: products.data,
      pagination: products.pagination
    });
  } catch (error) {
    logger.error('Error listing products', { error: error.message });
    next(error);
  }
};

/**
 * Get a single product by ID
 */
exports.getProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const product = await productQueries.findProductById(id);
    
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    
    // Get additional product data
    const [images, attributes, inventory, reviews] = await Promise.all([
      productQueries.getProductImages(id),
      productQueries.getProductAttributes(id),
      productQueries.getProductInventory(id),
      productQueries.getProductReviews(id)
    ]);
    
    // Calculate average rating
    const avgRating = reviews.length > 0 
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length 
      : 0;
    
    res.status(200).json({
      success: true,
      data: {
        ...product,
        images,
        attributes,
        inventory: {
          inStock: inventory.quantity > 0,
          quantity: inventory.quantity,
          ...inventory
        },
        reviews: {
          count: reviews.length,
          avgRating,
          items: reviews.slice(0, 5) // Return only 5 recent reviews
        }
      }
    });
  } catch (error) {
    logger.error('Error fetching product', { error: error.message, productId: req.params.id });
    next(error);
  }
};

/**
 * Create a new product
 */
exports.createProduct = async (req, res, next) => {
  try {
    // Validate seller role
    if (req.user.role !== 'admin' && req.user.role !== 'seller') {
      throw new ValidationError('Insufficient permissions to create products');
    }
    
    const {
      name, description, sku, price, category_id, 
      brand, weight, dimensions, is_featured, compare_price,
      cost_price, attributes, inventory
    } = req.body;
    
    // Basic validation
    if (!name || !price || !category_id) {
      throw new ValidationError('Name, price, and category are required');
    }
    
    // Create product with transaction to ensure all related data is saved
    const product = await productQueries.createProduct({
      name,
      description,
      sku,
      price,
      compare_price,
      cost_price,
      category_id,
      seller_id: req.user.user_id,
      brand,
      weight,
      dimensions,
      is_featured: is_featured || false,
      is_active: true
    }, { attributes, inventory });
    
    res.status(201).json({
      success: true,
      data: product
    });
  } catch (error) {
    logger.error('Error creating product', { error: error.message, user: req.user.user_id });
    next(error);
  }
};

/**
 * Update an existing product
 */
exports.updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Check if product exists and user has permission
    const existingProduct = await productQueries.findProductById(id);
    
    if (!existingProduct) {
      throw new NotFoundError('Product not found');
    }
    
    // Ensure user has permission (admin or the seller of this product)
    if (req.user.role !== 'admin' && existingProduct.seller_id !== req.user.user_id) {
      throw new ValidationError('You do not have permission to update this product');
    }
    
    // Update product
    const product = await productQueries.updateProduct(id, req.body);
    
    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    logger.error('Error updating product', { error: error.message, productId: req.params.id });
    next(error);
  }
};

/**
 * Delete a product (soft delete)
 */
exports.deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Check if product exists and user has permission
    const existingProduct = await productQueries.findProductById(id);
    
    if (!existingProduct) {
      throw new NotFoundError('Product not found');
    }
    
    // Ensure user has permission (admin or the seller of this product)
    if (req.user.role !== 'admin' && existingProduct.seller_id !== req.user.user_id) {
      throw new ValidationError('You do not have permission to delete this product');
    }
    
    // Soft delete - set is_active to false
    await productQueries.updateProduct(id, { is_active: false });
    
    res.status(200).json({
      success: true,
      message: 'Product successfully deleted'
    });
  } catch (error) {
    logger.error('Error deleting product', { error: error.message, productId: req.params.id });
    next(error);
  }
};

/**
 * Search products
 */
exports.searchProducts = async (req, res, next) => {
  try {
    const { q, page = 1, limit = 20, category, sort, priceMin, priceMax, brand } = req.query;
    
    if (!q || q.trim().length < 2) {
      throw new ValidationError('Search query must be at least 2 characters');
    }
    
    // Build filter object
    const filters = {};
    if (category) filters.category_id = category;
    if (brand) filters.brand = brand;
    if (priceMin || priceMax) {
      filters.price = {};
      if (priceMin) filters.price.min = parseFloat(priceMin);
      if (priceMax) filters.price.max = parseFloat(priceMax);
    }
    
    // Always search only active products
    filters.is_active = true;
    
    const results = await searchQueries.searchProducts(q.trim(), filters, {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: sort || 'relevance'
    });
    
    res.status(200).json({
      success: true,
      data: results.data,
      pagination: results.pagination
    });
  } catch (error) {
    logger.error('Error searching products', { error: error.message, query: req.query.q });
    next(error);
  }
};

/**
 * Get related products
 */
exports.getRelatedProducts = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { limit = 6 } = req.query;
    
    const relatedProducts = await productQueries.getRelatedProducts(id, parseInt(limit, 10));
    
    res.status(200).json({
      success: true,
      data: relatedProducts
    });
  } catch (error) {
    logger.error('Error fetching related products', { error: error.message, productId: req.params.id });
    next(error);
  }
};

/**
 * Get product reviews
 */
exports.getProductReviews = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, sort = 'created_at:desc' } = req.query;
    
    const reviews = await productQueries.getProductReviews(id, {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort
    });
    
    res.status(200).json({
      success: true,
      data: reviews.data,
      pagination: reviews.pagination
    });
  } catch (error) {
    logger.error('Error fetching product reviews', { error: error.message, productId: req.params.id });
    next(error);
  }
};

/**
 * Create a product review
 */
exports.createProductReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rating, title, content } = req.body;
    
    // Validate product exists
    const product = await productQueries.findProductById(id);
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    
    // Check if user has purchased the product
    const hasVerifiedPurchase = await productQueries.hasUserPurchasedProduct(
      req.user.user_id,
      id
    );
    
    // Create review
    const review = await productQueries.createProductReview({
      product_id: id,
      user_id: req.user.user_id,
      rating,
      title,
      content,
      is_verified_purchase: hasVerifiedPurchase,
      status: hasVerifiedPurchase ? 'approved' : 'pending'
    });
    
    res.status(201).json({
      success: true,
      data: review
    });
  } catch (error) {
    logger.error('Error creating product review', { error: error.message, productId: req.params.id });
    next(error);
  }
};