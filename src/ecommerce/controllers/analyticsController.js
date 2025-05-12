const { query } = require('../config/db');
const analyticsQueries = require('../db/queries/analytics');

const getSalesAnalytics = async (req, res) => {
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
};

module.exports = {
  getSalesAnalytics,
  // Add other analytics methods
};