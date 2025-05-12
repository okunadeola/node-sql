const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { authenticate, authorize } = require('../middleware/auth');
const { validateProduct } = require('../middleware/validation');

// Public routes
router.get('/', productController.getProducts);
router.get('/search', productController.searchProducts);
// router.get('/:id', productController.getProductById);
// router.get('/:id/reviews', productController.getProductReviews);
// router.get('/:id/related', productController.getRelatedProducts);

// // Protected routes
// router.use(authenticate);

// // Seller routes
// router.use(authorize('seller'));

// router.post('/', validateProduct, productController.createProduct);
// router.route('/:id')
//   .patch(validateProduct, productController.updateProduct)
//   .delete(productController.deleteProduct);

// // Inventory management
// router.get('/:id/inventory', productController.getInventory);
// router.patch('/:id/inventory', productController.updateInventory);

// // Admin-only routes
// router.patch('/:id/status', authorize('admin'), productController.updateProductStatus);

module.exports = router;