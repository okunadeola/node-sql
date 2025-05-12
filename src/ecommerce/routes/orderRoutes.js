const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticate, authorize } = require('../middleware/auth');
const { validateOrder } = require('../middleware/validation');

router.use(authenticate);

// Customer routes
router.post('/', validateOrder, orderController.createOrder);
// router.get('/my-orders', orderController.getUserOrders);
// router.get('/:id', orderController.getOrderById);
// router.post('/:id/cancel', orderController.cancelOrder);

// // Seller routes
// router.use(authorize('seller'));
// router.get('/seller/orders', orderController.getSellerOrders);
// router.patch('/:id/status', orderController.updateOrderStatus);

// // Admin routes
// router.use(authorize('admin'));
// router.get('/', orderController.getAllOrders);
// router.get('/analytics/summary', orderController.getOrderSummary);
// router.delete('/:id', orderController.deleteOrder);

module.exports = router;