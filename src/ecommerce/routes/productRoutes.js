/**
 * Product routes
 */
const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validation');
const rateLimiter = require('../middleware/rateLimiter');

// Apply rate limiter to all product routes
router.use(rateLimiter({
  maxRequests: 200,
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: 'product_api'
}));

// Public routes
router.get('/', productController.listProducts);
router.get('/featured', productController.getFeaturedProducts);
router.get('/search', productController.searchProducts);
router.get('/categories/:categoryId', productController.getProductsByCategory);
router.get('/:productId', productController.getProduct);
router.get('/:productId/reviews', productController.getProductReviews);
router.get('/:productId/related', productController.getRelatedProducts);

// Protected routes - require authentication
router.post('/', auth.protect, auth.requireRole('admin', 'seller'), validate.product, productController.createProduct);
router.put('/:productId', auth.protect, auth.requireRole('admin', 'seller'), validate.product, productController.updateProduct);
router.delete('/:productId', auth.protect, auth.requireRole('admin', 'seller'), productController.deleteProduct);

// Image management
router.post('/:productId/images', auth.protect, auth.requireRole('admin', 'seller'), productController.addProductImage);
router.delete('/:productId/images/:imageId', auth.protect, auth.requireRole('admin', 'seller'), productController.deleteProductImage);
router.put('/:productId/images/:imageId/primary', auth.protect, auth.requireRole('admin', 'seller'), productController.setPrimaryImage);

// Review management
router.post('/:productId/reviews', auth.protect, validate.review, productController.addProductReview);
router.put('/:productId/reviews/:reviewId', auth.protect, validate.review, productController.updateProductReview);
router.delete('/:productId/reviews/:reviewId', auth.protect, productController.deleteProductReview);

// Inventory management
router.get('/:productId/inventory', auth.protect, auth.requireRole('admin', 'seller'), productController.getProductInventory);
router.put('/:productId/inventory', auth.protect, auth.requireRole('admin', 'seller'), validate.inventory, productController.updateProductInventory);

module.exports = router;
