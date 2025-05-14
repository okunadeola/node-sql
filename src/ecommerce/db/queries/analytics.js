// db/queries/analytics.js
/**
 * Analytics Queries
 * Handles all database operations related to analytics and reporting
 */
const db = require('../../config/db');
const logger = require('../../utils/logger');
const { DatabaseError } = require('../../utils/error');

const analyticsQueries = {
  /**
   * Get sales overview for a specific period
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} Sales statistics
   */
  getSalesOverview: async (startDate, endDate) => {
    try {
      const query = `
        SELECT
          COUNT(DISTINCT order_id) AS total_orders,
          COUNT(DISTINCT user_id) AS unique_customers,
          SUM(total_amount) AS revenue,
          AVG(total_amount) AS average_order_value,
          SUM(
            CASE 
              WHEN status = 'completed' THEN total_amount 
              ELSE 0 
            END
          ) AS completed_revenue,
          COUNT(
            CASE 
              WHEN status = 'completed' THEN 1 
              ELSE NULL 
            END
          ) AS completed_orders
        FROM orders
        WHERE created_at BETWEEN $1 AND $2
      `;
      
      const result = await db.query(query, [startDate, endDate]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching sales overview', { 
        error: error.message, 
        startDate, 
        endDate 
      });
      throw new DatabaseError('Failed to fetch sales overview');
    }
  },
  
  /**
   * Get daily sales for a date range
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Daily sales data
   */
  getDailySales: async (startDate, endDate) => {
    try {
      const query = `
        SELECT
          DATE_TRUNC('day', created_at) AS date,
          COUNT(order_id) AS orders,
          SUM(total_amount) AS revenue
        FROM orders
        WHERE created_at BETWEEN $1 AND $2
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY date
      `;
      
      const result = await db.query(query, [startDate, endDate]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching daily sales', { 
        error: error.message, 
        startDate, 
        endDate 
      });
      throw new DatabaseError('Failed to fetch daily sales');
    }
  },
  
  /**
   * Get top selling products for a specific period
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {number} limit - Number of products to return
   * @returns {Promise<Array>} Top products
   */
  getTopProducts: async (startDate, endDate, limit = 10) => {
    try {
      const query = `
        SELECT
          p.product_id,
          p.name AS product_name,
          p.sku,
          SUM(oi.quantity) AS units_sold,
          SUM(oi.total) AS revenue,
          COUNT(DISTINCT o.order_id) AS order_count
        FROM
          order_items oi
        JOIN
          orders o ON oi.order_id = o.order_id
        JOIN
          products p ON oi.product_id = p.product_id
        WHERE
          o.created_at BETWEEN $1 AND $2
        GROUP BY
          p.product_id, p.name, p.sku
        ORDER BY
          units_sold DESC
        LIMIT $3
      `;
      
      const result = await db.query(query, [startDate, endDate, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching top products', { 
        error: error.message, 
        startDate, 
        endDate 
      });
      throw new DatabaseError('Failed to fetch top products');
    }
  },
  
  /**
   * Get revenue by category
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Category revenue
   */
  getRevenueByCategory: async (startDate, endDate) => {
    try {
      const query = `
        SELECT
          c.category_id,
          c.name AS category_name,
          SUM(oi.total) AS revenue,
          COUNT(DISTINCT o.order_id) AS orders,
          SUM(oi.quantity) AS units_sold
        FROM
          order_items oi
        JOIN
          orders o ON oi.order_id = o.order_id
        JOIN
          products p ON oi.product_id = p.product_id
        JOIN
          categories c ON p.category_id = c.category_id
        WHERE
          o.created_at BETWEEN $1 AND $2
        GROUP BY
          c.category_id, c.name
        ORDER BY
          revenue DESC
      `;
      
      const result = await db.query(query, [startDate, endDate]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching revenue by category', { 
        error: error.message, 
        startDate, 
        endDate 
      });
      throw new DatabaseError('Failed to fetch revenue by category');
    }
  },
  
  /**
   * Get customer cohort analysis
   * @param {number} months - Number of months to analyze
   * @returns {Promise<Array>} Cohort analysis data
   */
  getCustomerCohortAnalysis: async (months = 6) => {
    try {
      const query = `
        WITH first_purchases AS (
          SELECT
            user_id,
            DATE_TRUNC('month', MIN(created_at)) AS cohort_month
          FROM
            orders
          WHERE
            created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '${months} months')
          GROUP BY
            user_id
        ),
        monthly_activity AS (
          SELECT
            o.user_id,
            fp.cohort_month,
            DATE_TRUNC('month', o.created_at) AS activity_month,
            SUM(o.total_amount) AS revenue
          FROM
            orders o
          JOIN
            first_purchases fp ON o.user_id = fp.user_id
          WHERE
            o.created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '${months} months')
          GROUP BY
            o.user_id, fp.cohort_month, DATE_TRUNC('month', o.created_at)
        ),
        cohort_size AS (
          SELECT
            cohort_month,
            COUNT(DISTINCT user_id) AS num_customers
          FROM
            first_purchases
          GROUP BY
            cohort_month
        ),
        cohort_retention AS (
          SELECT
            ma.cohort_month,
            ma.activity_month,
            COUNT(DISTINCT ma.user_id) AS active_customers,
            SUM(ma.revenue) AS cohort_revenue,
            EXTRACT(MONTH FROM AGE(ma.activity_month, ma.cohort_month)) AS month_number
          FROM
            monthly_activity ma
          GROUP BY
            ma.cohort_month, ma.activity_month
        )
        SELECT
          to_char(cr.cohort_month, 'YYYY-MM') AS cohort,
          cs.num_customers AS cohort_size,
          cr.month_number,
          cr.active_customers,
          ROUND((cr.active_customers::decimal / cs.num_customers) * 100, 2) AS retention_rate,
          cr.cohort_revenue,
          ROUND(cr.cohort_revenue / cr.active_customers, 2) AS average_revenue_per_customer
        FROM
          cohort_retention cr
        JOIN
          cohort_size cs ON cr.cohort_month = cs.cohort_month
        ORDER BY
          cr.cohort_month, cr.month_number
      `;
      
      const result = await db.query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching customer cohort analysis', { 
        error: error.message,
        months
      });
      throw new DatabaseError('Failed to fetch customer cohort analysis');
    }
  },
  
  /**
   * Get inventory status and alerts
   * @returns {Promise<Object>} Inventory status
   */
  getInventoryStatus: async () => {
    try {
      const query = `
        SELECT
          (SELECT COUNT(*) FROM inventory WHERE quantity <= low_stock_threshold) AS low_stock_count,
          (SELECT COUNT(*) FROM inventory WHERE quantity = 0) AS out_of_stock_count,
          (SELECT AVG(quantity) FROM inventory) AS average_stock_level,
          (
            SELECT jsonb_agg(p)
            FROM (
              SELECT
                p.product_id,
                p.name,
                p.sku,
                i.quantity,
                i.low_stock_threshold
              FROM
                inventory i
              JOIN
                products p ON i.product_id = p.product_id
              WHERE
                i.quantity <= i.low_stock_threshold
              ORDER BY
                i.quantity ASC
              LIMIT 10
            ) p
          ) AS low_stock_products
      `;
      
      const result = await db.query(query);
      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching inventory status', { error: error.message });
      throw new DatabaseError('Failed to fetch inventory status');
    }
  },
  
  /**
   * Get sales funnel metrics
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} Sales funnel metrics
   */
  getSalesFunnel: async (startDate, endDate) => {
    try {
      const query = `
        SELECT
          (
            SELECT COUNT(DISTINCT cart_id)
            FROM shopping_carts
            WHERE created_at BETWEEN $1 AND $2
          ) AS cart_creations,
          (
            SELECT COUNT(DISTINCT cart_id)
            FROM shopping_carts sc
            WHERE 
              created_at BETWEEN $1 AND $2
              AND EXISTS (
                SELECT 1 FROM cart_items 
                WHERE cart_id = sc.cart_id
              )
          ) AS carts_with_items,
          (
            SELECT COUNT(DISTINCT order_id)
            FROM orders
            WHERE created_at BETWEEN $1 AND $2
              AND status NOT IN ('cancelled', 'failed')
          ) AS checkouts_started,
          (
            SELECT COUNT(DISTINCT order_id)
            FROM orders
            WHERE created_at BETWEEN $1 AND $2
              AND payment_status = 'paid'
          ) AS successful_payments,
          (
            SELECT COUNT(DISTINCT order_id)
            FROM orders
            WHERE created_at BETWEEN $1 AND $2
              AND status = 'completed'
          ) AS completed_orders
      `;
      
      const result = await db.query(query, [startDate, endDate]);
      
      const data = result.rows[0];
      
      // Calculate conversion rates
      if (data.cart_creations > 0) {
        data.add_to_cart_rate = parseFloat(((data.carts_with_items / data.cart_creations) * 100).toFixed(2));
        
        if (data.carts_with_items > 0) {
          data.checkout_rate = parseFloat(((data.checkouts_started / data.carts_with_items) * 100).toFixed(2));
          
          if (data.checkouts_started > 0) {
            data.payment_success_rate = parseFloat(((data.successful_payments / data.checkouts_started) * 100).toFixed(2));
          }
        }
      }
      
      return data;
    } catch (error) {
      logger.error('Error fetching sales funnel metrics', { 
        error: error.message, 
        startDate, 
        endDate 
      });
      throw new DatabaseError('Failed to fetch sales funnel metrics');
    }
  },

    salesPerformance: (startDate, endDate) => {
    return `
      WITH order_totals AS (
        SELECT 
          DATE_TRUNC('day', o.created_at) AS order_day,
          SUM(oi.total) AS daily_sales,
          COUNT(DISTINCT o.order_id) AS order_count,
          COUNT(oi.product_id) AS items_sold
        FROM orders o
        JOIN order_items oi ON o.order_id = oi.order_id
        WHERE o.created_at BETWEEN '${startDate}' AND '${endDate}'
          AND o.status = 'completed'
        GROUP BY order_day
      )
      SELECT 
        order_day,
        daily_sales,
        order_count,
        items_sold,
        SUM(daily_sales) OVER (ORDER BY order_day) AS running_total,
        AVG(daily_sales) OVER (
          ORDER BY order_day
          ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
        ) AS seven_day_avg,
        LAG(daily_sales, 7) OVER (ORDER BY order_day) AS prev_week_sales
      FROM order_totals
      ORDER BY order_day DESC;`;
  },

  customerLifetimeValue: () => {
    return `
      SELECT 
        u.user_id,
        u.email,
        COUNT(DISTINCT o.order_id) AS total_orders,
        SUM(o.total_amount) AS total_spent,
        AVG(o.total_amount) AS avg_order_value,
        MAX(o.created_at) AS last_order_date,
        NTILE(5) OVER (ORDER BY SUM(o.total_amount) DESC) AS value_segment
      FROM users u
      JOIN orders o ON u.user_id = o.user_id
      WHERE o.status = 'completed'
      GROUP BY u.user_id
      HAVING SUM(o.total_amount) > 0
      ORDER BY total_spent DESC;`;
  }
};

module.exports = analyticsQueries;