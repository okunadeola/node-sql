 const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.use(authorize('admin', 'seller'));

// Sales analytics
router.get('/sales', analyticsController.getSalesAnalytics);
// router.get('/sales/trends', analyticsController.getSalesTrends);
// router.get('/sales/by-category', analyticsController.getSalesByCategory);

// // Customer analytics
// router.get('/customers/top', analyticsController.getTopCustomers);
// router.get('/customers/lifetime-value', analyticsController.getCustomerLTV);

// // Product analytics
// router.get('/products/top-selling', analyticsController.getTopSellingProducts);
// router.get('/products/low-stock', analyticsController.getLowStockProducts);

// // Financial analytics
// router.get('/revenue', analyticsController.getRevenueReport);
// router.get('/profit-margin', analyticsController.getProfitMargin);

module.exports = router;