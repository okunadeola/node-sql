/**
 * Analytics routes
 */
const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validation');
const rateLimiter = require('../middleware/rateLimiter');

// Apply rate limiter to all analytics routes
router.use(rateLimiter({
  maxRequests: 30,
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: 'analytics_api'
}));

// All analytics routes require authentication and admin/seller role
router.use(auth.requireAuth);
router.use(auth.requireRole('admin', 'seller'));

// Sales analytics
router.get('/sales/overview', analyticsController.getSalesOverview);
router.get('/sales/daily', validate.dateRange, analyticsController.getDailySales);
router.get('/sales/monthly', validate.dateRange, analyticsController.getMonthlySales);
router.get('/sales/by-category', validate.dateRange, analyticsController.getSalesByCategory);
router.get('/sales/by-product', validate.dateRange, analyticsController.getTopSellingProducts);

// Customer analytics
router.get('/customers/overview', analyticsController.getCustomerOverview);
router.get('/customers/growth', validate.dateRange, analyticsController.getCustomerGrowth);
router.get('/customers/retention', validate.dateRange, analyticsController.getCustomerRetention);
router.get('/customers/top', validate.dateRange, analyticsController.getTopCustomers);

// Inventory analytics
router.get('/inventory/status', analyticsController.getInventoryStatus);
router.get('/inventory/low-stock', analyticsController.getLowStockProducts);
router.get('/inventory/turnover', validate.dateRange, analyticsController.getInventoryTurnover);

// Product analytics
router.get('/products/views', validate.dateRange, analyticsController.getProductViews);
router.get('/products/conversion', validate.dateRange, analyticsController.getProductConversion);
router.get('/products/performance', validate.dateRange, analyticsController.getProductPerformance);

// Cart analytics
router.get('/carts/abandoned', validate.dateRange, analyticsController.getAbandonedCarts);
router.get('/carts/conversion-rate', validate.dateRange, analyticsController.getCartConversionRate);

// Export reports (with stricter rate limit)
router.get('/export/sales', 
  rateLimiter({ maxRequests: 5, windowMs: 3600 * 1000 }), // 5 per hour
  validate.dateRange, 
  analyticsController.exportSalesReport
);

router.get('/export/inventory', 
  rateLimiter({ maxRequests: 5, windowMs: 3600 * 1000 }), // 5 per hour
  analyticsController.exportInventoryReport
);

module.exports = router;