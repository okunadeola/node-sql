/**
 * Cart routes
 */
const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validation');

// Apply rate limiter to all cart routes
// router.use(rateLimiter({
//   maxRequests: 120,
//   windowMs: 60 * 1000, // 1 minute
//   keyPrefix: 'cart_api'
// }));

// Get cart (authenticated or session-based)
router.get('/', cartController.getCart);

// Cart operations
router.post('/items', validate.cartItem, cartController.addToCart);
router.put('/items/:itemId', validate.cartItemUpdate, cartController.updateCartItem);
router.delete('/items/:itemId', cartController.removeCartItem);
router.delete('/', cartController.clearCart);

// Apply coupon/discount code
router.post('/apply-discount', validate.discountCode, cartController.applyDiscount);
router.delete('/remove-discount', cartController.removeDiscount);

// Cart checkout preparation
router.get('/shipping-methods', cartController.getShippingMethods);
router.post('/estimate-shipping', validate.shippingEstimate, cartController.estimateShipping);
router.post('/estimate-taxes', validate.taxEstimate, cartController.estimateTaxes);

// Save cart for later (requires authentication)
router.post('/save', auth.requireAuth, cartController.saveCartForLater);
router.get('/saved', auth.requireAuth, cartController.getSavedCarts);
router.post('/saved/:savedCartId/restore', auth.requireAuth, cartController.restoreSavedCart);
router.delete('/saved/:savedCartId', auth.requireAuth, cartController.deleteSavedCart);

// Merge guest cart with user cart after login
router.post('/merge', auth.requireAuth, validate.cartMerge, cartController.mergeGuestCart);

module.exports = router;