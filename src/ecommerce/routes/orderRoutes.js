/**
 * Order routes
 */
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validation');

// Apply rate limiter to all order routes - more restrictive for order creation
// router.use(rateLimiter({
//   maxRequests: 60,
//   windowMs: 60 * 1000, // 1 minute
//   keyPrefix: 'order_api'
// }));

// Customer routes - require authentication
router.get('/my-orders', auth.protect, orderController.getMyOrders);
router.get('/my-orders/:orderId', auth.protect, orderController.getMyOrderById);
router.post('/', auth.protect, validate.createOrder, orderController.createOrder);
router.post('/:orderId/cancel', auth.protect, orderController.cancelOrder);

// Admin/seller routes - require special roles
router.get('/', auth.protect, auth.requireRole('admin', 'seller'), orderController.getAllOrders);
router.get('/:orderId', auth.protect, auth.requireRole('admin', 'seller'), orderController.getOrderById);
router.put('/:orderId/status', auth.protect, auth.requireRole('admin', 'seller'), validate.updateOrderStatus, orderController.updateOrderStatus); 
router.post('/:orderId/refund', auth.protect, auth.requireRole('admin'), validate.refund, orderController.refundOrder);

// Order items management
router.put('/:orderId/items/:itemId', auth.protect, auth.requireRole('admin'), validate.orderItem, orderController.updateOrderItem);

// Order history
router.get('/:orderId/history', auth.protect, auth.requireRole('admin', 'seller'), orderController.getOrderHistory);
router.post('/:orderId/history', auth.protect, auth.requireRole('admin', 'seller'), validate.orderHistory, orderController.addOrderHistoryEntry);

// Payment processing
router.post('/:orderId/payment', auth.protect, validate.addOrderPayment, orderController.processPayment);
router.get('/:orderId/payment', auth.protect, orderController.getPaymentDetails);

// Export orders (with rate limit)
router.get('/export/csv', 
  // rateLimiter({ maxRequests: 3, windowMs: 3600 * 1000 }), // 3 per hour
  auth.protect, 
  auth.requireRole('admin'), 
  orderController.exportOrdersCSV
);

module.exports = router;