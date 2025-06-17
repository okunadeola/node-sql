const { query } = require('../config/db');
const analyticsQueries = require('../db/queries/analytics');

/**
 * Analytics Controller
 * Handles analytics and reporting functions for the e-commerce platform
 */

const { AuthorizationError } = require('../utils/error');
const logger = require('../utils/logger');

const analyticsController = {

   /**
   * Get sales overview
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */

   getSalesAnalytics_old: async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      const result = await query(
        analyticsQueries.salesPerformance(startDate, endDate)
      );

      res.json({
        status: 'success',
        data: result.rows
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch sales data'
      });
    }
  },

  /**
   * Get sales overview
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  getSalesOverview_old: async (req, res, next) => {
    try {
      // Check permissions - only admin and sellers can access
      if (!['admin', 'seller'].includes(req.user.role)) {
        throw new AuthorizationError('You do not have permission to access sales analytics');
      }
      
      const period = req.query.period || 'month'; // day, week, month, year
      const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
      const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
      const sellerId = req.user.role === 'seller' ? req.user.userId : req.query.sellerId;
      
      // Get sales overview
      const salesData = await analyticsQueries.getSalesOverview(period, startDate, endDate, sellerId);
      
      res.status(200).json({
        success: true,
        data: salesData
      });
    } catch (error) {
      logger.error('Error getting sales overview', { error: error.message });
      next(error);
    }
  },
  
  /**
   * Get product performance
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  getProductPerformance_old: async (req, res, next) => {
    try {
      // Check permissions - only admin and sellers can access
      if (!['admin', 'seller'].includes(req.user.role)) {
        throw new AuthorizationError('You do not have permission to access product analytics');
      }
      
      const sortBy = req.query.sortBy || 'sales'; // sales, revenue, views
      const limit = parseInt(req.query.limit) || 10;
      const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
      const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
      const sellerId = req.user.role === 'seller' ? req.user.userId : req.query.sellerId;
      
      // Get product performance
      const productData = await analyticsQueries.getProductPerformance(sortBy, limit, startDate, endDate, sellerId);
      
      res.status(200).json({
        success: true,
        data: productData
      });
    } catch (error) {
      logger.error('Error getting product performance', { error: error.message });
      next(error);
    }
  },
  
  /**
   * Get customer insights
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  getCustomerInsights: async (req, res, next) => {
    try {
      // Check permissions - only admin can access customer insights
      if (req.user.role !== 'admin') {
        throw new AuthorizationError('You do not have permission to access customer insights');
      }
      
      const metric = req.query.metric || 'acquisition'; // acquisition, retention, activity
      const period = req.query.period || 'month'; // day, week, month, year
      const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
      const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
      
      // Get customer insights
      const customerData = await analyticsQueries.getCustomerInsights(metric, period, startDate, endDate);
      
      res.status(200).json({
        success: true,
        data: customerData
      });
    } catch (error) {
      logger.error('Error getting customer insights', { error: error.message });
      next(error);
    }
  },
  
  /**
   * Get inventory analysis
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  getInventoryAnalysis: async (req, res, next) => {
    try {
      // Check permissions - only admin and sellers can access
      if (!['admin', 'seller'].includes(req.user.role)) {
        throw new AuthorizationError('You do not have permission to access inventory analytics');
      }
      
      const type = req.query.type || 'stock'; // stock, turnover, forecasting
      const sellerId = req.user.role === 'seller' ? req.user.userId : req.query.sellerId;
      
      // Get inventory analysis
      const inventoryData = await analyticsQueries.getInventoryAnalysis(type, sellerId);
      
      res.status(200).json({
        success: true,
        data: inventoryData
      });
    } catch (error) {
      logger.error('Error getting inventory analysis', { error: error.message });
      next(error);
    }
  },
  
  /**
   * Get dashboard summary for admin or seller
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  getDashboardSummary: async (req, res, next) => {
    try {
      // Check permissions - only admin and sellers can access
      if (!['admin', 'seller'].includes(req.user.role)) {
        throw new AuthorizationError('You do not have permission to access dashboard summary');
      }
      
      const sellerId = req.user.role === 'seller' ? req.user.userId : req.query.sellerId;
      const period = req.query.period || 'today'; // today, week, month, year
      
      // Get dashboard summary stats
      const dashboardData = await analyticsQueries.getDashboardSummary(period, sellerId);
      
      res.status(200).json({
        success: true,
        data: dashboardData
      });
    } catch (error) {
      logger.error('Error getting dashboard summary', { error: error.message });
      next(error);
    }
  },
  
  /**
   * Get sales by category
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  getSalesByCategory: async (req, res, next) => {
    try {
      // Check permissions - only admin and sellers can access
      if (!['admin', 'seller'].includes(req.user.role)) {
        throw new AuthorizationError('You do not have permission to access sales by category');
      }
      
      const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
      const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
      const sellerId = req.user.role === 'seller' ? req.user.userId : req.query.sellerId;
      
      // Get sales by category
      const categoryData = await analyticsQueries.getSalesByCategory(sellerId, req.user.role,  {startDate, endDate});
      
      res.status(200).json({
        success: true,
        data: categoryData
      });
    } catch (error) {
      logger.error('Error getting sales by category', { error: error.message });
      next(error);
    }
  },
  
  /**
   * Get sales trend over time
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  getSalesTrend: async (req, res, next) => {
    try {
      // Check permissions - only admin and sellers can access
      if (!['admin', 'seller'].includes(req.user.role)) {
        throw new AuthorizationError('You do not have permission to access sales trend data');
      }
      
      const interval = req.query.interval || 'day'; // hour, day, week, month
      const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
      const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
      const sellerId = req.user.role === 'seller' ? req.user.userId : req.query.sellerId;
      
      // Get sales trend
      const trendData = await analyticsQueries.getSalesTrend(interval, startDate, endDate, sellerId);
      
      res.status(200).json({
        success: true,
        data: trendData
      });
    } catch (error) {
      logger.error('Error getting sales trend', { error: error.message });
      next(error);
    }
  },
  
  /**
   * Get order status distribution
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  getOrderStatusDistribution: async (req, res, next) => {
    try {
      // Check permissions - only admin and sellers can access
      if (!['admin', 'seller'].includes(req.user.role)) {
        throw new AuthorizationError('You do not have permission to access order status data');
      }
      
      const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
      const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
      const sellerId = req.user.role === 'seller' ? req.user.userId : req.query.sellerId;
      
      // Get order status distribution
      const statusData = await analyticsQueries.getOrderStatusDistribution(startDate, endDate, sellerId);
      
      res.status(200).json({
        success: true,
        data: statusData
      });
    } catch (error) {
      logger.error('Error getting order status distribution', { error: error.message });
      next(error);
    }
  },
  
  /**
   * Export sales report (CSV)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  exportSalesReport: async (req, res, next) => {
    try {
      // Check permissions - only admin and sellers can access
      if (!['admin', 'seller'].includes(req.user.role)) {
        throw new AuthorizationError('You do not have permission to export sales reports');
      }
      
      const format = req.query.format || 'csv';
      const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
      const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
      const sellerId = req.user.role === 'seller' ? req.user.userId : req.query.sellerId;
      
      // Generate sales report
      const reportData = await analyticsQueries.generateSalesReport(format, startDate, endDate, sellerId);
      
      // Set headers for file download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="sales-report-${new Date().toISOString().split('T')[0]}.csv"`);
      
      // Send CSV data
      res.status(200).send(reportData);
    } catch (error) {
      logger.error('Error exporting sales report', { error: error.message });
      next(error);
    }
  },

    // ===== SALES ANALYTICS =====

  /**
   * Get sales overview metrics
   */
   getSalesOverview: async (req, res, next) => {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      // Default to last 30 days if no dates provided
      const endDate = new Date().toISOString();
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      
      const filters = {
        startDate: req.query.start_date || startDate,
        endDate: req.query.end_date || endDate
      };

      const overview = await analyticsQueries.getSalesOverview(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: overview,
        message: 'Sales overview retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getSalesOverview controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  /**
   * Get daily sales data
   */
  getDailySales: async(req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date
      };

      const dailySales = await analyticsQueries.getDailySales(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: dailySales,
        message: 'Daily sales data retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getDailySales controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  /**
   * Get monthly sales data
   */
  getMonthlySales: async (req, res, next) => {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date
      };

      const monthlySales = await analyticsQueries.getMonthlySales(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: monthlySales,
        message: 'Monthly sales data retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getMonthlySales controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  /**
   * Get sales by category
   */
  getSalesByCategory: async(req, res, next) => {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date
      };

      const categoryData = await analyticsQueries.getSalesByCategory(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: categoryData,
        message: 'Sales by category retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getSalesByCategory controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  /**
   * Get top selling products
   */
   getTopSellingProducts: async(req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date,
        limit: parseInt(req.query.limit) || 10
      };

      const topProducts = await analyticsQueries.getTopSellingProducts(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: topProducts,
        message: 'Top selling products retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getTopSellingProducts controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  // ===== CUSTOMER ANALYTICS =====

  /**
   * Get customer overview metrics
   */
  getCustomerOverview: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      // Default to last 30 days if no dates provided
      const endDate = new Date().toISOString();
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      
      const filters = {
        startDate: req.query.start_date || startDate,
        endDate: req.query.end_date || endDate
      };

      const overview = await analyticsQueries.getCustomerOverview(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: overview,
        message: 'Customer overview retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getCustomerOverview controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  /**
   * Get customer growth data
   */
  getCustomerGrowth: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date
      };

      const growthData = await analyticsQueries.getCustomerGrowth(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: growthData,
        message: 'Customer growth data retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getCustomerGrowth controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  /**
   * Get customer retention data
   */
getCustomerRetention: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date
      };

      const retentionData = await analyticsQueries.getCustomerRetention(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: retentionData,
        message: 'Customer retention data retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getCustomerRetention controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  /**
   * Get top customers
   */
 getTopCustomers: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date,
        limit: parseInt(req.query.limit) || 10
      };

      const topCustomers = await analyticsQueries.getTopCustomers(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: topCustomers,
        message: 'Top customers retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getTopCustomers controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  // ===== INVENTORY ANALYTICS =====

  /**
   * Get inventory status overview
   */
 getInventoryStatus: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;

      const inventoryStatus = await analyticsQueries.getInventoryStatus(userId, userRole);

      res.status(200).json({
        success: true,
        data: inventoryStatus,
        message: 'Inventory status retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getInventoryStatus controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  /**
   * Get low stock products
   */
getLowStockProducts: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        limit: parseInt(req.query.limit) || 20
      };

      const lowStockProducts = await analyticsQueries.getLowStockProducts(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: lowStockProducts,
        message: 'Low stock products retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getLowStockProducts controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  /**
   * Get inventory turnover data
   */
getInventoryTurnover: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date
      };

      const turnoverData = await analyticsQueries.getInventoryTurnover(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: turnoverData,
        message: 'Inventory turnover data retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getInventoryTurnover controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  // ===== PRODUCT ANALYTICS =====

  /**
   * Get product views data
   */
getProductViews: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date,
        limit: parseInt(req.query.limit) || 20
      };

      const productViews = await analyticsQueries.getProductViews(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: productViews,
        message: 'Product views data retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getProductViews controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  /**
   * Get product conversion rates
   */
getProductConversion: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date,
        limit: parseInt(req.query.limit) || 20
      };

      const conversionData = await analyticsQueries.getProductConversion(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: conversionData,
        message: 'Product conversion data retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getProductConversion controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  /**
   * Get product performance metrics
   */
getProductPerformance: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date,
        limit: parseInt(req.query.limit) || 20
      };

      const performanceData = await analyticsQueries.getProductPerformance(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: performanceData,
        message: 'Product performance data retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getProductPerformance controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  // ===== CART ANALYTICS =====

  /**
   * Get abandoned carts data
   */
 getAbandonedCarts: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date
      };

      const abandonedCarts = await analyticsQueries.getAbandonedCarts(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: abandonedCarts,
        message: 'Abandoned carts data retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getAbandonedCarts controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  /**
   * Get cart conversion rate
   */
 getCartConversionRate: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date
      };

      const conversionRate = await analyticsQueries.getCartConversionRate(userId, userRole, filters);

      res.status(200).json({
        success: true,
        data: conversionRate,
        message: 'Cart conversion rate retrieved successfully'
      });
    } catch (error) {
      logger.error('Error in getCartConversionRate controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  // ===== EXPORT FUNCTIONS =====

  /**
   * Export sales report
   */
 exportSalesReport: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;
      
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date
      };

      const salesData = await analyticsQueries.getSalesReportData(userId, userRole, filters);

      // Convert to CSV format
      const csvData = convertToCSV(salesData, [
        'order_number',
        'order_date',
        'order_status',
        'customer_name',
        'customer_email',
        'product_name',
        'sku',
        'category_name',
        'quantity',
        'unit_price',
        'line_total',
        'subtotal',
        'tax_amount',
        'shipping_amount',
        'discount_amount',
        'order_total',
        'payment_method',
        'payment_status'
      ]);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=sales_report_${new Date().toISOString().split('T')[0]}.csv`);
      
      res.status(200).send(csvData);
    } catch (error) {
      logger.error('Error in exportSalesReport controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  },

  /**
   * Export inventory report
   */
exportInventoryReport: async (req, res, next)=> {
    try {
      const userId = req.user.user_id;
      const userRole = req.user.role;

      const inventoryData = await analyticsQueries.getInventoryReportData(userId, userRole);

      // Convert to CSV format
      const csvData = convertToCSV(inventoryData, [
        'product_name',
        'sku',
        'category_name',
        'brand',
        'price',
        'cost_price',
        'current_stock',
        'reserved_quantity',
        'available_stock',
        'low_stock_threshold',
        'stock_status',
        'warehouse_location',
        'last_restock_date',
        'next_restock_date',
        'inventory_value',
        'is_active',
        'product_created_date'
      ]);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=inventory_report_${new Date().toISOString().split('T')[0]}.csv`);
      
      res.status(200).send(csvData);
    } catch (error) {
      logger.error('Error in exportInventoryReport controller', { 
        error: error.message, 
        userId: req.user?.user_id 
      });
      next(error);
    }
  }
}



/**
 * Helper function to convert array of objects to CSV
 * @param {Array} data - Array of objects to convert
 * @param {Array} columns - Column names to include in CSV
 * @returns {string} CSV formatted string
 */
function convertToCSV(data, columns) {
  if (!data || data.length === 0) {
    return columns.join(',') + '\n';
  }

  // Create header row
  const header = columns.join(',');
  
  // Create data rows
  const rows = data.map(row => {
    return columns.map(column => {
      let value = row[column];
      
      // Handle null/undefined values
      if (value === null || value === undefined) {
        value = '';
      }
      
      // Handle dates
      if (value instanceof Date) {
        value = value.toISOString();
      }
      
      // Convert to string and escape quotes
      value = String(value);
      
      // If value contains comma, newline, or quote, wrap in quotes and escape internal quotes
      if (value.includes(',') || value.includes('\n') || value.includes('"')) {
        value = '"' + value.replace(/"/g, '""') + '"';
      }
      
      return value;
    }).join(',');
  });
  
  return [header, ...rows].join('\n');
}



module.exports = analyticsController;