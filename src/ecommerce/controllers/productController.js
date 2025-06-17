/**
 * Product Controller
 * Handles all product-related operations
 */
const productQueries = require('../db/queries/products');
const searchQueries = require('../db/queries/search');
const { NotFoundError, ValidationError, AuthorizationError } = require('../utils/error');
const logger = require('../utils/logger');
const {pool} = require('../config/db')

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
    
    const products = await productQueries.getAllProducts(filters, {
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
    const { productId:id } = req.params;
    
    const product = await productQueries.getProductById(id);
    
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
    const existingProduct = await productQueries.getProductById(id);
    
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
    const existingProduct = await productQueries.getProductById(id);
    
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
    
    const results = await searchQueries.searchProducts({
      query: q.trim(), 
      filters, 
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sortBy: sort || 'relevance',
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
    const product = await productQueries.getProductById(id);
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    
    // Check if user has purchased the product
    const hasVerifiedPurchase = await productQueries.hasUserPurchasedProduct(
      req.user.user_id,
      id
    );
    
    // Create review
    const review = await productQueries.addProductReview({
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

// v2
exports.listProducts2 = async (req, res, next) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      sort = 'created_at:desc',
      price_min, 
      price_max, 
      brand, 
      category, 
      is_featured,
      is_active = true
    } = req.query;

    // Prepare filters
    const filters = { is_active };
    
    if (price_min) filters.price = { operator: '>=', value: parseFloat(price_min) };
    if (price_max) filters.price = { ...filters.price, operator: '<=', value: parseFloat(price_max) };
    if (brand) filters.brand = brand;
    if (category) filters.category_id = category;
    if (is_featured !== undefined) filters.is_featured = is_featured === 'true';

    // Parse sort parameter - format: field:direction
    const [sortField, sortDirection] = sort.split(':');
    const sortOption = { [sortField]: sortDirection || 'ASC' };

    // Get products with pagination
    const products = await productQueries.getAllProducts(filters, {
      pagination: { page, limit },
      sort: sortOption
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
 * Get featured products
 * @route GET /api/products/featured
 */
exports.getFeaturedProducts = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    
    const featuredProducts = await productQueries.getFeaturedProducts(parseInt(limit));
    
    res.status(200).json({
      success: true,
      data: featuredProducts
    });
  } catch (error) {
    logger.error('Error getting featured products', { error: error.message });
    next(error);
  }
};

/**
 * Search products
 * @route GET /api/products/search
 */
exports.searchProducts2 = async (req, res, next) => {
  try {
    const { 
      q, 
      page = 1, 
      limit = 20, 
      category,
      price_min,
      price_max,
      brand,
      sort = 'relevance'  // relevance, price_asc, price_desc, newest
    } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    // Build filter options
    const options = {
      pagination: { page: parseInt(page), limit: parseInt(limit) },
      category_id: category,
      price_range: price_min || price_max ? { min: price_min, max: price_max } : null,
      brand,
      sort
    };

    const searchResults = await searchQueries.searchProducts(q, options);

    res.status(200).json({
      success: true,
      data: searchResults.data,
      pagination: searchResults.pagination
    });
  } catch (error) {
    logger.error('Error searching products', { error: error.message });
    next(error);
  }
};

/**
 * Get products by category
 * @route GET /api/products/categories/:categoryId
 */
exports.getProductsByCategory = async (req, res, next) => {
  try {
    const { categoryId } = req.params;
    const { 
      page = 1, 
      limit = 20, 
      sort = 'created_at:desc',
      include_subcategories = 'true'
    } = req.query;

    // Parse sort parameter
    const [sortField, sortDirection] = sort.split(':');
    const sortOption = { [sortField]: sortDirection || 'ASC' };
    
    const includeSubcats = include_subcategories === 'true';

    const products = await productQueries.getProductsByCategory(categoryId, {
      includeSubcategories: includeSubcats,
      pagination: { page: parseInt(page), limit: parseInt(limit) },
      sort: sortOption
    });

    res.status(200).json({
      success: true,
      data: products.data,
      pagination: products.pagination
    });
  } catch (error) {
    logger.error('Error getting products by category', { 
      error: error.message,
      categoryId: req.params.categoryId
    });
    next(error);
  }
};

/**
 * Get single product details
 * @route GET /api/products/:productId
 */
exports.getProduct2 = async (req, res, next) => {
  try {
    const { productId } = req.params;
    
    const product = await productQueries.getProductById(productId);
    
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    
    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    logger.error('Error getting product details', { 
      error: error.message,
      productId: req.params.productId
    });
    next(error);
  }
};

/**
 * Get product reviews
 * @route GET /api/products/:productId/reviews
 */
exports.getProductReviews2 = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 10, sort = 'created_at:desc' } = req.query;
    
    // Parse sort parameter
    const [sortField, sortDirection] = sort.split(':');
    const sortOption = { [sortField]: sortDirection || 'DESC' };
    
    const reviews = await productQueries.getProductReviews(productId, {
      pagination: { page: parseInt(page), limit: parseInt(limit) },
      sort: sortOption
    });
    
    res.status(200).json({
      success: true,
      data: reviews.data,
      pagination: reviews.pagination
    });
  } catch (error) {
    logger.error('Error getting product reviews', { 
      error: error.message,
      productId: req.params.productId
    });
    next(error);
  }
};

/**
 * Create a new product
 * @route POST /api/products
 * @access Protected - Admin, Seller
 */
exports.createProduct2 = async (req, res, next) => {
  try {
    // Start a database transaction
    const client = await pool.connect();;
    
    try {
      await client.query('BEGIN');
      
      // Add seller_id from authenticated user
      const productData = {
        ...req.body,
        seller_id: req.user.user_id
      };
      
      // Create the product
      const product = await productQueries.createProduct(productData, client);
      
      // Handle inventory if provided
      if (req.body.inventory) {
        // await productQueries.addProductInventory({
        //   product_id: product.product_id,
        //   quantity: req.body.inventory.quantity || 0,
        //   reserved_quantity: 0,
        //   low_stock_threshold: req.body.inventory.low_stock_threshold || 5
        // }, client);
      }
      
      // Handle product attributes if provided
      if (req.body.attributes && Array.isArray(req.body.attributes)) {
        // for (const attr of req.body.attributes) {
        //   await productQueries.addProductAttribute({
        //     product_id: product.product_id,
        //     name: attr.name,
        //     value: attr.value
        //   }, client);
        // }
      }
      
      await client.query('COMMIT');
      
      res.status(201).json({
        success: true,
        data: product
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error creating product', { error: error.message });
    next(error);
  }
};

/**
 * Update a product
 * @route PUT /api/products/:productId
 * @access Protected - Admin, Seller
 */
exports.updateProduct2 = async (req, res, next) => {
  try {
    const { productId } = req.params;
    
    // Check if product exists and user has permission
    const existingProduct = await productQueries.getProductById(productId);
    
    if (!existingProduct) {
      throw new NotFoundError('Product not found');
    }
    
    // Check if user is the seller or an admin
    if (req.user.role !== 'admin' && existingProduct.seller_id !== req.user.user_id) {
      throw new AuthorizationError('You do not have permission to update this product');
    }
    
    // Update the product
    const updatedProduct = await productQueries.updateProduct(productId, req.body);
    
    res.status(200).json({
      success: true,
      data: updatedProduct
    });
  } catch (error) {
    logger.error('Error updating product', { 
      error: error.message,
      productId: req.params.productId
    });
    next(error);
  }
};

/**
 * Delete a product
 * @route DELETE /api/products/:productId
 * @access Protected - Admin, Seller
 */
exports.deleteProduct2 = async (req, res, next) => {
  try {
    const { productId } = req.params;
    
    // Check if product exists and user has permission
    const existingProduct = await productQueries.getProductById(productId);
    
    if (!existingProduct) {
      throw new NotFoundError('Product not found');
    }
    
    // Check if user is the seller or an admin
    if (req.user.role !== 'admin' && existingProduct.seller_id !== req.user.user_id) {
      throw new AuthorizationError('You do not have permission to delete this product');
    }
    
    // Delete the product
    await productQueries.deleteProduct(productId);
    
    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting product', { 
      error: error.message,
      productId: req.params.productId
    });
    next(error);
  }
};

/**
 * Add a product image
 * @route POST /api/products/:productId/images
 * @access Protected - Admin, Seller
 */
exports.addProductImage = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { url, alt_text, is_primary } = req.body;
    
    if (!url) {
      throw new ValidationError('Image URL is required');
    }
    
    // Check if product exists and user has permission
    const existingProduct = await productQueries.getProductById(productId);
    
    if (!existingProduct) {
      throw new NotFoundError('Product not found');
    }
    
    // Check if user is the seller or an admin
    if (req.user.role !== 'admin' && existingProduct.seller_id !== req.user.user_id) {
      throw new AuthorizationError('You do not have permission to add images to this product');
    }
    
    const newImage = await productQueries.setPrimaryImage({
      product_id: productId,
      url,
      alt_text,
      is_primary: is_primary === true
    });
    
    res.status(201).json({
      success: true,
      data: newImage
    });
  } catch (error) {
    logger.error('Error adding product image', { 
      error: error.message,
      productId: req.params.productId
    });
    next(error);
  }
};

/**
 * Delete a product image
 * @route DELETE /api/products/:productId/images/:imageId
 * @access Protected - Admin, Seller
 */
exports.deleteProductImage = async (req, res, next) => {
  try {
    const { productId, imageId } = req.params;
    
    // Check if product exists and user has permission
    const existingProduct = await productQueries.getProductById(productId);
    
    if (!existingProduct) {
      throw new NotFoundError('Product not found');
    }
    
    // Check if user is the seller or an admin
    if (req.user.role !== 'admin' && existingProduct.seller_id !== req.user.user_id) {
      throw new AuthorizationError('You do not have permission to delete images from this product');
    }
    
    // Check if image exists for this product
    const image = await productQueries.getProductImageById(imageId);
    
    if (!image || image.product_id !== productId) {
      throw new NotFoundError('Image not found for this product');
    }
    
    await productQueries.deleteProductImage(imageId);
    
    res.status(200).json({
      success: true,
      message: 'Product image deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting product image', { 
      error: error.message,
      productId: req.params.productId,
      imageId: req.params.imageId
    });
    next(error);
  }
};

/**
 * Set primary product image
 * @route PUT /api/products/:productId/images/:imageId/primary
 * @access Protected - Admin, Seller
 */
exports.setPrimaryImage = async (req, res, next) => {
  try {
    const { productId, imageId } = req.params;
    
    // Check if product exists and user has permission
    const existingProduct = await productQueries.getProductById(productId);
    
    if (!existingProduct) {
      throw new NotFoundError('Product not found');
    }
    
    // Check if user is the seller or an admin
    if (req.user.role !== 'admin' && existingProduct.seller_id !== req.user.user_id) {
      throw new AuthorizationError('You do not have permission to modify this product');
    }
    
    // Check if image exists for this product
    const image = await productQueries.getProductImageById(imageId);
    
    if (!image || image.product_id !== productId) {
      throw new NotFoundError('Image not found for this product');
    }
    
    // Update the primary image
    await productQueries.setPrimaryImage(productId, imageId);
    
    res.status(200).json({
      success: true,
      message: 'Primary image updated successfully'
    });
  } catch (error) {
    logger.error('Error setting primary product image', { 
      error: error.message,
      productId: req.params.productId,
      imageId: req.params.imageId
    });
    next(error);
  }
};

/**
 * Add a product review
 * @route POST /api/products/:productId/reviews
 * @access Protected - Any authenticated user
 */
exports.addProductReview = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { rating, title, content } = req.body;
    
    // Check if product exists
    const product = await productQueries.getProductById(productId);
    
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    
    // Check if user has already reviewed this product
    const existingReview = await productQueries.getProductUserReview(req.user.user_id, productId);
    
    if (existingReview) {
      throw new ValidationError('You have already reviewed this product');
    }
    
    // Check if the user has purchased this product
    const hasVerifiedPurchase = await productQueries.hasUserPurchasedProduct(req.user.user_id, productId);
    
    const reviewData = {
      product_id: productId,
      user_id: req.user.user_id,
      rating: parseInt(rating),
      title,
      content,
      is_verified_purchase: hasVerifiedPurchase,
      status: 'pending' // Reviews might require approval
    };
    
    const newReview = await productQueries.addProductReview(reviewData);
    
    res.status(201).json({
      success: true,
      data: newReview
    });
  } catch (error) {
    logger.error('Error adding product review', { 
      error: error.message,
      productId: req.params.productId,
      userId: req.user?.user_id
    });
    next(error);
  }
};

/**
 * Update a product review
 * @route PUT /api/products/:productId/reviews/:reviewId
 * @access Protected - Review author only
 */
exports.updateProductReview = async (req, res, next) => {
  try {
    const { productId, reviewId } = req.params;
    const { rating, title, content } = req.body;
    
    // Check if review exists
    const review = await productQueries.getReviewById(reviewId);
    
    if (!review || review.product_id !== productId) {
      throw new NotFoundError('Review not found for this product');
    }
    
    // Check if user is the review author
    if (review.user_id !== req.user.user_id) {
      throw new AuthorizationError('You do not have permission to update this review');
    }
    
    const updatedReview = await productQueries.updateProductReview(reviewId, {
      rating: parseInt(rating),
      title,
      content,
      status: 'pending' // Reset status as the review was modified
    });
    
    res.status(200).json({
      success: true,
      data: updatedReview
    });
  } catch (error) {
    logger.error('Error updating product review', { 
      error: error.message,
      productId: req.params.productId,
      reviewId: req.params.reviewId
    });
    next(error);
  }
};

/**
 * Delete a product review
 * @route DELETE /api/products/:productId/reviews/:reviewId
 * @access Protected - Review author or Admin
 */
exports.deleteProductReview = async (req, res, next) => {
  try {
    const { productId, reviewId } = req.params;
    
    // Check if review exists
    const review = await productQueries.getReviewById(reviewId);
    
    if (!review || review.product_id !== productId) {
      throw new NotFoundError('Review not found for this product');
    }
    
    // Check if user is the review author or admin
    if (review.user_id !== req.user.user_id && req.user.role !== 'admin') {
      throw new AuthorizationError('You do not have permission to delete this review');
    }
    
    await productQueries.deleteProductReview(reviewId);
    
    res.status(200).json({
      success: true,
      message: 'Review deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting product review', { 
      error: error.message,
      productId: req.params.productId,
      reviewId: req.params.reviewId
    });
    next(error);
  }
};

/**
 * Get product inventory
 * @route GET /api/products/:productId/inventory
 * @access Protected - Admin, Seller
 */
exports.getProductInventory = async (req, res, next) => {
  try {
    const { productId } = req.params;
    
    // Check if product exists
    const product = await productQueries.getProductById(productId);
    
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    
    // Check if user is the seller or an admin
    if (req.user.role !== 'admin' && product.seller_id !== req.user.user_id) {
      throw new AuthorizationError('You do not have permission to view this product\'s inventory');
    }
    
    const inventory = await productQueries.getProductInventory(productId);
    
    res.status(200).json({
      success: true,
      data: inventory
    });
  } catch (error) {
    logger.error('Error getting product inventory', { 
      error: error.message,
      productId: req.params.productId
    });
    next(error);
  }
};

/**
 * Update product inventory
 * @route PUT /api/products/:productId/inventory
 * @access Protected - Admin, Seller
 */
exports.updateProductInventory = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { quantity, low_stock_threshold, warehouse_location } = req.body;
    
    // Check if product exists
    const product = await productQueries.getProductById(productId);
    
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    
    // Check if user is the seller or an admin
    if (req.user.role !== 'admin' && product.seller_id !== req.user.user_id) {
      throw new AuthorizationError('You do not have permission to update this product\'s inventory');
    }
    
    // Update inventory
    const updatedInventory = await productQueries.updateProductInventory(productId, {
      quantity: quantity !== undefined ? parseInt(quantity) : undefined,
      low_stock_threshold: low_stock_threshold !== undefined ? parseInt(low_stock_threshold) : undefined,
      warehouse_location
    });
    
    res.status(200).json({
      success: true,
      data: updatedInventory
    });
  } catch (error) {
    logger.error('Error updating product inventory', { 
      error: error.message,
      productId: req.params.productId
    });
    next(error);
  }
}

