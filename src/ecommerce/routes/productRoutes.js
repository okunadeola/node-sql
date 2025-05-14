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
router.get('/:productId', productController.getProductById);
router.get('/:productId/reviews', productController.getProductReviews);
router.get('/:productId/related', productController.getRelatedProducts);

// Protected routes - require authentication
router.post('/', auth.requireAuth, auth.requireRole('admin', 'seller'), validate.product, productController.createProduct);
router.put('/:productId', auth.requireAuth, auth.requireRole('admin', 'seller'), validate.product, productController.updateProduct);
router.delete('/:productId', auth.requireAuth, auth.requireRole('admin', 'seller'), productController.deleteProduct);

// Image management
router.post('/:productId/images', auth.requireAuth, auth.requireRole('admin', 'seller'), productController.addProductImage);
router.delete('/:productId/images/:imageId', auth.requireAuth, auth.requireRole('admin', 'seller'), productController.deleteProductImage);
router.put('/:productId/images/:imageId/primary', auth.requireAuth, auth.requireRole('admin', 'seller'), productController.setPrimaryImage);

// Review management
router.post('/:productId/reviews', auth.requireAuth, validate.review, productController.addProductReview);
router.put('/:productId/reviews/:reviewId', auth.requireAuth, validate.review, productController.updateProductReview);
router.delete('/:productId/reviews/:reviewId', auth.requireAuth, productController.deleteProductReview);

// Inventory management
router.get('/:productId/inventory', auth.requireAuth, auth.requireRole('admin', 'seller'), productController.getProductInventory);
router.put('/:productId/inventory', auth.requireAuth, auth.requireRole('admin', 'seller'), validate.inventory, productController.updateProductInventory);

module.exports = router;