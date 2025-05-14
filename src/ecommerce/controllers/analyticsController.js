const { query } = require('../config/db');
const analyticsQueries = require('../db/queries/analytics');

/**
 * Analytics Controller
 * Handles analytics and reporting functions for the e-commerce platform
 */
const analyticsQueries = require('../db/queries/analytics');
const { AuthorizationError } = require('../utils/error');
const logger = require('../utils/logger');

const analyticsController = {

   /**
   * Get sales overview
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */

   getSalesAnalytics: async (req, res) => {
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
  getSalesOverview: async (req, res, next) => {
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
  getProductPerformance: async (req, res, next) => {
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
      const categoryData = await analyticsQueries.getSalesByCategory(startDate, endDate, sellerId);
      
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
  }
};

module.exports = analyticsController;