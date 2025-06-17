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
  getSalesOverview_old: async (startDate, endDate) => {
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
  getDailySales_old: async (startDate, endDate) => {
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

  salesPerformance: async (startDate, endDate) => {
    const query = `
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

      const result = await db.query(query, [startDate, endDate]);
      
      const data = result.rows[0];
      
      return data;
  },

  customerLifetimeValue: async () => {
    const query =  `
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

            const result = await db.query(query);
      
      const data = result.rows[0];
      
      return data;
  },


  /**
   * Get sales overview with key metrics
   */
  getSalesOverview: async(userId, userRole, filters = {}) => {
    try {
      const { startDate, endDate } = filters;
      
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $3' : '';
      const params = [startDate || '1970-01-01', endDate || new Date().toISOString()];
      if (userRole === 'seller') params.push(userId);

      const query = `
        WITH sales_metrics AS (
          SELECT 
            COUNT(DISTINCT o.order_id) as total_orders,
            COALESCE(SUM(o.total_amount), 0) as total_revenue,
            COALESCE(AVG(o.total_amount), 0) as avg_order_value,
            COUNT(DISTINCT o.user_id) as unique_customers,
            SUM(oi.quantity) as total_items_sold
          FROM orders o
          JOIN order_items oi ON o.order_id = oi.order_id
          JOIN products p ON oi.product_id = p.product_id
          WHERE o.created_at BETWEEN $1 AND $2
            AND o.status IN ('completed', 'shipped', 'delivered')
            ${sellerCondition}
        ),
        previous_period AS (
          SELECT 
            COUNT(DISTINCT o.order_id) as prev_total_orders,
            COALESCE(SUM(o.total_amount), 0) as prev_total_revenue
          FROM orders o
          JOIN order_items oi ON o.order_id = oi.order_id
          JOIN products p ON oi.product_id = p.product_id
          WHERE o.created_at BETWEEN ($1::date - ($2::date - $1::date)) AND $1
            AND o.status IN ('completed', 'shipped', 'delivered')
            ${sellerCondition}
        )
        SELECT 
          sm.*,
          pp.prev_total_orders,
          pp.prev_total_revenue,
          CASE 
            WHEN pp.prev_total_orders > 0 
            THEN ROUND(((sm.total_orders - pp.prev_total_orders) * 100.0 / pp.prev_total_orders), 2)
            ELSE 0 
          END as orders_growth_rate,
          CASE 
            WHEN pp.prev_total_revenue > 0 
            THEN ROUND(((sm.total_revenue - pp.prev_total_revenue) * 100.0 / pp.prev_total_revenue), 2)
            ELSE 0 
          END as revenue_growth_rate
        FROM sales_metrics sm, previous_period pp
      `;

      const result = await db.query(query, params);
      return result.rows[0] || {};
    } catch (error) {
      logger.error('Error in getSalesOverview', { error: error.message });
      throw new DatabaseError('Failed to fetch sales overview');
    }
  },

  /**
   * Get daily sales data
   */
  getDailySales: async(userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate } = filters;
      
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $3' : '';
      const params = [startDate, endDate];
      if (userRole === 'seller') params.push(userId);

      const query = `
        SELECT 
          DATE(o.created_at) as date,
          COUNT(DISTINCT o.order_id) as orders_count,
          COALESCE(SUM(o.total_amount), 0) as revenue,
          COALESCE(AVG(o.total_amount), 0) as avg_order_value,
          SUM(oi.quantity) as items_sold
        FROM orders o
        JOIN order_items oi ON o.order_id = oi.order_id
        JOIN products p ON oi.product_id = p.product_id
        WHERE o.created_at BETWEEN $1 AND $2
          AND o.status IN ('completed', 'shipped', 'delivered')
          ${sellerCondition}
        GROUP BY DATE(o.created_at)
        ORDER BY date ASC
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getDailySales', { error: error.message });
      throw new DatabaseError('Failed to fetch daily sales');
    }
  },

  /**
   * Get monthly sales data
   */
  getMonthlySales: async(userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate } = filters;
      
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $3' : '';
      const params = [startDate, endDate];
      if (userRole === 'seller') params.push(userId);

      const query = `
        SELECT 
          DATE_TRUNC('month', o.created_at) as month,
          COUNT(DISTINCT o.order_id) as orders_count,
          COALESCE(SUM(o.total_amount), 0) as revenue,
          COALESCE(AVG(o.total_amount), 0) as avg_order_value,
          SUM(oi.quantity) as items_sold,
          COUNT(DISTINCT o.user_id) as unique_customers
        FROM orders o
        JOIN order_items oi ON o.order_id = oi.order_id
        JOIN products p ON oi.product_id = p.product_id
        WHERE o.created_at BETWEEN $1 AND $2
          AND o.status IN ('completed', 'shipped', 'delivered')
          ${sellerCondition}
        GROUP BY DATE_TRUNC('month', o.created_at)
        ORDER BY month ASC
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getMonthlySales', { error: error.message });
      throw new DatabaseError('Failed to fetch monthly sales');
    }
  },

  /**
   * Get sales by category
   */
  getSalesByCategory: async(userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate } = filters;
      
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $3' : '';
      const params = [startDate, endDate];
      if (userRole === 'seller') params.push(userId);

      const query = `
        SELECT 
          c.name as category_name,
          c.category_id,
          COUNT(DISTINCT o.order_id) as orders_count,
          SUM(oi.quantity) as total_quantity,
          COALESCE(SUM(oi.total), 0) as total_revenue,
          COALESCE(AVG(oi.unit_price), 0) as avg_unit_price,
          COUNT(DISTINCT p.product_id) as products_count
        FROM orders o
        JOIN order_items oi ON o.order_id = oi.order_id
        JOIN products p ON oi.product_id = p.product_id
        JOIN categories c ON p.category_id = c.category_id
        WHERE o.created_at BETWEEN $1 AND $2
          AND o.status IN ('completed', 'shipped', 'delivered')
          ${sellerCondition}
        GROUP BY c.category_id, c.name
        ORDER BY total_revenue DESC
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getSalesByCategory', { error: error.message });
      throw new DatabaseError('Failed to fetch sales by category');
    }
  },

  /**
   * Get top selling products
   */
  getTopSellingProducts: async(userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate, limit = 10 } = filters;
      
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $4' : '';
      const params = [startDate, endDate, limit];
      if (userRole === 'seller') params.push(userId);

      const query = `
        SELECT 
          p.product_id,
          p.name as product_name,
          p.sku,
          c.name as category_name,
          SUM(oi.quantity) as total_quantity_sold,
          COALESCE(SUM(oi.total), 0) as total_revenue,
          COUNT(DISTINCT o.order_id) as orders_count,
          COALESCE(AVG(oi.unit_price), 0) as avg_selling_price,
          (
            SELECT url 
            FROM product_images 
            WHERE product_id = p.product_id AND is_primary = TRUE 
            LIMIT 1
          ) as primary_image
        FROM orders o
        JOIN order_items oi ON o.order_id = oi.order_id
        JOIN products p ON oi.product_id = p.product_id
        LEFT JOIN categories c ON p.category_id = c.category_id
        WHERE o.created_at BETWEEN $1 AND $2
          AND o.status IN ('completed', 'shipped', 'delivered')
          ${sellerCondition}
        GROUP BY p.product_id, p.name, p.sku, c.name
        ORDER BY total_quantity_sold DESC
        LIMIT $3
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getTopSellingProducts', { error: error.message });
      throw new DatabaseError('Failed to fetch top selling products');
    }
  },

  // ===== CUSTOMER ANALYTICS =====

  /**
   * Get customer overview metrics
   */
  getCustomerOverview: async(userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate } = filters;
      
      // For sellers, we need to filter by customers who bought their products
      const sellerJoin = userRole === 'seller' 
        ? `JOIN order_items oi2 ON o2.order_id = oi2.order_id
           JOIN products p2 ON oi2.product_id = p2.product_id` 
        : '';
      const sellerCondition = userRole === 'seller' ? 'AND p2.seller_id = $3' : '';
      const params = [startDate || '1970-01-01', endDate || new Date().toISOString()];
      if (userRole === 'seller') params.push(userId);

      const query = `
        WITH customer_metrics AS (
          SELECT 
            COUNT(DISTINCT u.user_id) as total_customers,
            COUNT(DISTINCT CASE WHEN o.created_at BETWEEN $1 AND $2 THEN u.user_id END) as period_customers,
            COUNT(DISTINCT CASE WHEN u.created_at BETWEEN $1 AND $2 THEN u.user_id END) as new_customers
          FROM users u
          LEFT JOIN orders o ON u.user_id = o.user_id
          ${sellerJoin}
          WHERE u.role = 'customer'
            ${sellerCondition}
        ),
        repeat_customers AS (
          SELECT COUNT(DISTINCT o.user_id) as repeat_customers_count
          FROM orders o
          ${userRole === 'seller' ? `
            JOIN order_items oi ON o.order_id = oi.order_id
            JOIN products p ON oi.product_id = p.product_id
          ` : ''}
          WHERE o.created_at BETWEEN $1 AND $2
            AND o.status IN ('completed', 'shipped', 'delivered')
            ${sellerCondition}
            AND o.user_id IN (
              SELECT o2.user_id 
              FROM orders o2 
              ${userRole === 'seller' ? `
                JOIN order_items oi2 ON o2.order_id = oi2.order_id
                JOIN products p2 ON oi2.product_id = p2.product_id
              ` : ''}
              WHERE o2.created_at < $1 
                AND o2.status IN ('completed', 'shipped', 'delivered')
                ${userRole === 'seller' ? 'AND p2.seller_id = $' + params.length : ''}
            )
        )
        SELECT 
          cm.*,
          rc.repeat_customers_count,
          CASE 
            WHEN cm.period_customers > 0 
            THEN ROUND((rc.repeat_customers_count * 100.0 / cm.period_customers), 2)
            ELSE 0 
          END as repeat_customer_rate
        FROM customer_metrics cm, repeat_customers rc
      `;

      const result = await db.query(query, params);
      return result.rows[0] || {};
    } catch (error) {
      logger.error('Error in getCustomerOverview', { error: error.message });
      throw new DatabaseError('Failed to fetch customer overview');
    }
  },

  /**
   * Get customer growth data
   */
  getCustomerGrowth: async(userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate } = filters;
      
      const sellerJoin = userRole === 'seller' 
        ? `JOIN orders o ON u.user_id = o.user_id
           JOIN order_items oi ON o.order_id = oi.order_id
           JOIN products p ON oi.product_id = p.product_id` 
        : '';
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $3' : '';
      const params = [startDate, endDate];
      if (userRole === 'seller') params.push(userId);

      const query = `
        SELECT 
          DATE_TRUNC('month', u.created_at) as month,
          COUNT(DISTINCT u.user_id) as new_customers,
          COUNT(DISTINCT CASE WHEN o.order_id IS NOT NULL THEN u.user_id END) as customers_with_orders
        FROM users u
        ${sellerJoin}
        WHERE u.created_at BETWEEN $1 AND $2
          AND u.role = 'customer'
          ${sellerCondition}
        GROUP BY DATE_TRUNC('month', u.created_at)
        ORDER BY month ASC
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getCustomerGrowth', { error: error.message });
      throw new DatabaseError('Failed to fetch customer growth');
    }
  },

  /**
   * Get customer retention data
   */
  getCustomerRetention: async(userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate } = filters;
      
      const sellerJoin = userRole === 'seller' 
        ? `JOIN order_items oi ON o.order_id = oi.order_id
           JOIN products p ON oi.product_id = p.product_id` 
        : '';
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $3' : '';
      const params = [startDate, endDate];
      if (userRole === 'seller') params.push(userId);

      const query = `
        WITH customer_cohorts AS (
          SELECT 
            o.user_id,
            DATE_TRUNC('month', MIN(o.created_at)) as cohort_month,
            DATE_TRUNC('month', o.created_at) as order_month
          FROM orders o
          ${sellerJoin}
          WHERE o.created_at BETWEEN $1 AND $2
            AND o.status IN ('completed', 'shipped', 'delivered')
            ${sellerCondition}
          GROUP BY o.user_id, DATE_TRUNC('month', o.created_at)
        ),
        cohort_data AS (
          SELECT 
            cohort_month,
            (EXTRACT(YEAR FROM order_month) - EXTRACT(YEAR FROM cohort_month)) * 12 + 
            (EXTRACT(MONTH FROM order_month) - EXTRACT(MONTH FROM cohort_month)) as month_number,
            COUNT(DISTINCT user_id) as customers
          FROM customer_cohorts
          GROUP BY cohort_month, month_number
        ),
        cohort_sizes AS (
          SELECT 
            cohort_month,
            COUNT(DISTINCT user_id) as cohort_size
          FROM customer_cohorts
          WHERE month_number = 0
          GROUP BY cohort_month
        )
        SELECT 
          cd.cohort_month,
          cd.month_number,
          cd.customers,
          cs.cohort_size,
          ROUND((cd.customers * 100.0 / cs.cohort_size), 2) as retention_rate
        FROM cohort_data cd
        JOIN cohort_sizes cs ON cd.cohort_month = cs.cohort_month
        ORDER BY cd.cohort_month, cd.month_number
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getCustomerRetention', { error: error.message });
      throw new DatabaseError('Failed to fetch customer retention');
    }
  },

  /**
   * Get top customers by value
   */
  getTopCustomers: async (userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate, limit = 10 } = filters;
      
      const sellerJoin = userRole === 'seller' 
        ? `JOIN order_items oi ON o.order_id = oi.order_id
           JOIN products p ON oi.product_id = p.product_id` 
        : '';
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $4' : '';
      const params = [startDate, endDate, limit];
      if (userRole === 'seller') params.push(userId);

      const query = `
        SELECT 
          u.user_id,
          u.first_name,
          u.last_name,
          u.email,
          COUNT(DISTINCT o.order_id) as total_orders,
          COALESCE(SUM(o.total_amount), 0) as total_spent,
          COALESCE(AVG(o.total_amount), 0) as avg_order_value,
          MAX(o.created_at) as last_order_date,
          MIN(o.created_at) as first_order_date
        FROM users u
        JOIN orders o ON u.user_id = o.user_id
        ${sellerJoin}
        WHERE o.created_at BETWEEN $1 AND $2
          AND o.status IN ('completed', 'shipped', 'delivered')
          AND u.role = 'customer'
          ${sellerCondition}
        GROUP BY u.user_id, u.first_name, u.last_name, u.email
        ORDER BY total_spent DESC
        LIMIT $3
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getTopCustomers', { error: error.message });
      throw new DatabaseError('Failed to fetch top customers');
    }
  },

  // ===== INVENTORY ANALYTICS =====

  /**
   * Get inventory status overview
   */
  getInventoryStatus2: async(userId, userRole)=> {
    try {
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $1' : '';
      const params = userRole === 'seller' ? [userId] : [];

      const query = `
        SELECT 
          COUNT(DISTINCT p.product_id) as total_products,
          COUNT(DISTINCT CASE WHEN i.quantity > 0 THEN p.product_id END) as in_stock_products,
          COUNT(DISTINCT CASE WHEN i.quantity = 0 THEN p.product_id END) as out_of_stock_products,
          COUNT(DISTINCT CASE WHEN i.quantity <= i.low_stock_threshold AND i.quantity > 0 THEN p.product_id END) as low_stock_products,
          COALESCE(SUM(i.quantity), 0) as total_inventory_units,
          COALESCE(SUM(i.quantity * p.cost_price), 0) as total_inventory_value,
          COALESCE(AVG(i.quantity), 0) as avg_stock_per_product
        FROM products p
        LEFT JOIN inventory i ON p.product_id = i.product_id
        WHERE p.is_active = TRUE
          ${sellerCondition}
      `;

      const result = await db.query(query, params);
      return result.rows[0] || {};
    } catch (error) {
      logger.error('Error in getInventoryStatus', { error: error.message });
      throw new DatabaseError('Failed to fetch inventory status');
    }
  },

  /**
   * Get low stock products
   */
  getLowStockProducts: async(userId, userRole, filters = {})=> {
    try {
      const { limit = 20 } = filters;
      
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $1' : '';
      const params = userRole === 'seller' ? [userId, limit] : [limit];
      const limitParam = userRole === 'seller' ? '$2' : '$1';

      const query = `
        SELECT 
          p.product_id,
          p.name as product_name,
          p.sku,
          c.name as category_name,
          i.quantity as current_stock,
          i.low_stock_threshold,
          i.warehouse_location,
          i.last_restock_date,
          i.next_restock_date,
          (
            SELECT url 
            FROM product_images 
            WHERE product_id = p.product_id AND is_primary = TRUE 
            LIMIT 1
          ) as primary_image,
          p.price,
          p.cost_price
        FROM products p
        JOIN inventory i ON p.product_id = i.product_id
        LEFT JOIN categories c ON p.category_id = c.category_id
        WHERE p.is_active = TRUE
          AND i.quantity <= i.low_stock_threshold
          AND i.quantity >= 0
          ${sellerCondition}
        ORDER BY (i.quantity::float / NULLIF(i.low_stock_threshold, 0)) ASC, i.quantity ASC
        LIMIT ${limitParam}
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getLowStockProducts', { error: error.message });
      throw new DatabaseError('Failed to fetch low stock products');
    }
  },

  /**
   * Get inventory turnover data
   */
  getInventoryTurnover: async (userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate } = filters;
      
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $3' : '';
      const params = [startDate, endDate];
      if (userRole === 'seller') params.push(userId);

      const query = `
        WITH product_sales AS (
          SELECT 
            p.product_id,
            p.name as product_name,
            p.sku,
            c.name as category_name,
            SUM(oi.quantity) as total_sold,
            COALESCE(AVG(i.quantity), 0) as avg_inventory,
            p.cost_price,
            COUNT(DISTINCT o.order_id) as orders_count
          FROM products p
          LEFT JOIN inventory i ON p.product_id = i.product_id
          LEFT JOIN order_items oi ON p.product_id = oi.product_id
          LEFT JOIN orders o ON oi.order_id = o.order_id
          LEFT JOIN categories c ON p.category_id = c.category_id
          WHERE (o.created_at BETWEEN $1 AND $2 OR o.created_at IS NULL)
            AND (o.status IN ('completed', 'shipped', 'delivered') OR o.status IS NULL)
            AND p.is_active = TRUE
            ${sellerCondition}
          GROUP BY p.product_id, p.name, p.sku, c.name, p.cost_price
        )
        SELECT 
          *,
          CASE 
            WHEN avg_inventory > 0 
            THEN ROUND((total_sold / avg_inventory), 2)
            ELSE 0 
          END as turnover_ratio,
          CASE 
            WHEN total_sold > 0 AND avg_inventory > 0
            THEN ROUND((365.0 / (total_sold / avg_inventory)), 2)
            ELSE 0 
          END as days_on_hand
        FROM product_sales
        WHERE total_sold > 0 OR avg_inventory > 0
        ORDER BY turnover_ratio DESC
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getInventoryTurnover', { error: error.message });
      throw new DatabaseError('Failed to fetch inventory turnover');
    }
  },

  // ===== PRODUCT ANALYTICS =====

  /**
   * Get product views (this would require a product_views table)
   * For now, we'll simulate with order frequency
   */
  getProductViews: async (userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate, limit = 20 } = filters;
      
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $4' : '';
      const params = [startDate, endDate, limit];
      if (userRole === 'seller') params.push(userId);

      const query = `
        SELECT 
          p.product_id,
          p.name as product_name,
          p.sku,
          c.name as category_name,
          COUNT(DISTINCT o.order_id) as order_frequency,
          SUM(oi.quantity) as total_ordered,
          COALESCE(AVG(pr.rating), 0) as avg_rating,
          COUNT(DISTINCT pr.review_id) as review_count,
          (
            SELECT url 
            FROM product_images 
            WHERE product_id = p.product_id AND is_primary = TRUE 
            LIMIT 1
          ) as primary_image
        FROM products p
        LEFT JOIN order_items oi ON p.product_id = oi.product_id
        LEFT JOIN orders o ON oi.order_id = o.order_id
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN product_reviews pr ON p.product_id = pr.product_id AND pr.status = 'approved'
        WHERE (o.created_at BETWEEN $1 AND $2 OR o.created_at IS NULL)
          AND p.is_active = TRUE
          ${sellerCondition}
        GROUP BY p.product_id, p.name, p.sku, c.name
        ORDER BY order_frequency DESC, total_ordered DESC
        LIMIT $3
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getProductViews', { error: error.message });
      throw new DatabaseError('Failed to fetch product views');
    }
  },

  /**
   * Get product conversion rates
   */
  getProductConversion: async (userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate, limit = 20 } = filters;
      
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $4' : '';
      const params = [startDate, endDate, limit];
      if (userRole === 'seller') params.push(userId);

      const query = `
        WITH cart_data AS (
          SELECT 
            p.product_id,
            p.name as product_name,
            COUNT(DISTINCT ci.cart_id) as times_added_to_cart,
            COUNT(DISTINCT CASE 
              WHEN o.order_id IS NOT NULL AND o.status IN ('completed', 'shipped', 'delivered') 
              THEN ci.cart_id 
            END) as times_purchased
          FROM products p
          LEFT JOIN cart_items ci ON p.product_id = ci.product_id
          LEFT JOIN shopping_carts sc ON ci.cart_id = sc.cart_id
          LEFT JOIN orders o ON sc.user_id = o.user_id
          LEFT JOIN order_items oi ON o.order_id = oi.order_id AND oi.product_id = p.product_id
          WHERE (ci.added_at BETWEEN $1 AND $2 OR ci.added_at IS NULL)
            AND p.is_active = TRUE
            ${sellerCondition}
          GROUP BY p.product_id, p.name
        )
        SELECT 
          *,
          CASE 
            WHEN times_added_to_cart > 0 
            THEN ROUND((times_purchased * 100.0 / times_added_to_cart), 2)
            ELSE 0 
          END as conversion_rate
        FROM cart_data
        WHERE times_added_to_cart > 0
        ORDER BY conversion_rate DESC, times_added_to_cart DESC
        LIMIT $3
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getProductConversion', { error: error.message });
      throw new DatabaseError('Failed to fetch product conversion');
    }
  },

  /**
   * Get product performance metrics
   */
  getProductPerformance: async(userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate, limit = 20 } = filters;
      
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $4' : '';
      const params = [startDate, endDate, limit];
      if (userRole === 'seller') params.push(userId);

      const query = `
        SELECT 
          p.product_id,
          p.name as product_name,
          p.sku,
          c.name as category_name,
          p.price,
          p.cost_price,
          COUNT(DISTINCT o.order_id) as orders_count,
          SUM(oi.quantity) as total_sold,
          COALESCE(SUM(oi.total), 0) as total_revenue,
          COALESCE(SUM(oi.total - (oi.quantity * p.cost_price)), 0) as total_profit,
          COALESCE(AVG(pr.rating), 0) as avg_rating,
          COUNT(DISTINCT pr.review_id) as review_count,
          i.quantity as current_stock,
          (
            SELECT url 
            FROM product_images 
            WHERE product_id = p.product_id AND is_primary = TRUE 
            LIMIT 1
          ) as primary_image
        FROM products p
        LEFT JOIN order_items oi ON p.product_id = oi.product_id
        LEFT JOIN orders o ON oi.order_id = o.order_id
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN product_reviews pr ON p.product_id = pr.product_id AND pr.status = 'approved'
        LEFT JOIN inventory i ON p.product_id = i.product_id
        WHERE (o.created_at BETWEEN $1 AND $2 OR o.created_at IS NULL)
          AND (o.status IN ('completed', 'shipped', 'delivered') OR o.status IS NULL)
          AND p.is_active = TRUE
          ${sellerCondition}
        GROUP BY p.product_id, p.name, p.sku, c.name, p.price, p.cost_price, i.quantity
        ORDER BY total_revenue DESC, total_sold DESC
        LIMIT $3
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getProductPerformance', { error: error.message });
      throw new DatabaseError('Failed to fetch product performance');
    }
  },

  // ===== CART ANALYTICS =====

  /**
   * Get abandoned carts data
   */
  getAbandonedCarts: async(userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate } = filters;
      
      // For sellers, we need to check if any items in abandoned carts are their products
      const sellerJoin = userRole === 'seller' 
        ? `JOIN cart_items ci2 ON sc.cart_id = ci2.cart_id
           JOIN products p2 ON ci2.product_id = p2.product_id` 
        : '';
      const sellerCondition = userRole === 'seller' ? 'AND p2.seller_id = $3' : '';
      const params = [startDate, endDate];
      if (userRole === 'seller') params.push(userId);

      const query = `
        WITH abandoned_carts AS (
          SELECT DISTINCT
            sc.cart_id,
            sc.user_id,
            u.email,
            u.first_name,
            u.last_name,
            sc.created_at as cart_created,
            sc.updated_at as last_activity,
            COUNT(ci.cart_item_id) as items_count,
            SUM(ci.quantity * p.price) as cart_value
          FROM shopping_carts sc
          ${sellerJoin}
          LEFT JOIN users u ON sc.user_id = u.user_id
          LEFT JOIN cart_items ci ON sc.cart_id = ci.cart_id
          LEFT JOIN products p ON ci.product_id = p.product_id
          WHERE sc.created_at BETWEEN $1 AND $2
            AND sc.cart_id NOT IN (
              SELECT DISTINCT sc2.cart_id 
              FROM shopping_carts sc2
              JOIN orders o ON sc2.user_id = o.user_id
              WHERE o.created_at >= sc2.created_at
                AND o.status IN ('completed', 'shipped', 'delivered', 'processing')
            )
            AND sc.updated_at < NOW() - INTERVAL '24 hours'
            ${sellerCondition}
          GROUP BY sc.cart_id, sc.user_id, u.email, u.first_name, u.last_name, sc.created_at, sc.updated_at
          HAVING COUNT(ci.cart_item_id) > 0
        )
        SELECT 
          *,
          EXTRACT(DAYS FROM NOW() - last_activity) as days_abandoned
        FROM abandoned_carts
        ORDER BY cart_value DESC, last_activity DESC
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getAbandonedCarts', { error: error.message });
      throw new DatabaseError('Failed to fetch abandoned carts');
    }
  },

  /**
   * Get cart conversion rate
   */
  getCartConversionRate: async(userId, userRole, filters = {}) =>{
    try {
      const { startDate, endDate } = filters;
      
      const sellerJoin = userRole === 'seller' 
        ? `JOIN cart_items ci2 ON sc.cart_id = ci2.cart_id
           JOIN products p2 ON ci2.product_id = p2.product_id` 
        : '';
      const sellerCondition = userRole === 'seller' ? 'AND p2.seller_id = $3' : '';
      const params = [startDate, endDate];
      if (userRole === 'seller') params.push(userId);

      const query = `
        WITH cart_metrics AS (
          SELECT 
            COUNT(DISTINCT sc.cart_id) as total_carts,
            COUNT(DISTINCT CASE 
              WHEN EXISTS (
                SELECT 1 FROM orders o 
                WHERE o.user_id = sc.user_id 
                  AND o.created_at >= sc.created_at
                  AND o.status IN ('completed', 'shipped', 'delivered', 'processing')
              ) THEN sc.cart_id 
            END) as converted_carts,
            AVG(cart_totals.cart_value) as avg_cart_value,
            SUM(CASE 
              WHEN EXISTS (
                SELECT 1 FROM orders o 
                WHERE o.user_id = sc.user_id 
                  AND o.created_at >= sc.created_at
                  AND o.status IN ('completed', 'shipped', 'delivered', 'processing')
              ) THEN cart_totals.cart_value 
              ELSE 0 
            END) as converted_value
          FROM shopping_carts sc
          ${sellerJoin}
          JOIN (
            SELECT 
              ci.cart_id,
              SUM(ci.quantity * p.price) as cart_value
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.product_id
            GROUP BY ci.cart_id
          ) cart_totals ON sc.cart_id = cart_totals.cart_id
          WHERE sc.created_at BETWEEN $1 AND $2
            ${sellerCondition}
        )
        SELECT 
          total_carts,
          converted_carts,
          CASE 
            WHEN total_carts > 0 
            THEN ROUND((converted_carts * 100.0 / total_carts), 2)
            ELSE 0 
          END as conversion_rate,
          ROUND(avg_cart_value, 2) as avg_cart_value,
          ROUND(converted_value, 2) as total_converted_value,
          (total_carts - converted_carts) as abandoned_carts
        FROM cart_metrics
      `;

      const result = await db.query(query, params);
      return result.rows[0] || {};
    } catch (error) {
      logger.error('Error in getCartConversionRate', { error: error.message });
      throw new DatabaseError('Failed to fetch cart conversion rate');
    }
  },

  // ===== EXPORT FUNCTIONS =====

  /**
   * Export sales report data
   */
  getSalesReportData: async(userId, userRole, filters = {})=> {
    try {
      const { startDate, endDate } = filters;
      
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $3' : '';
      const params = [startDate, endDate];
      if (userRole === 'seller') params.push(userId);

      const query = `
        SELECT 
          o.order_number,
          o.created_at as order_date,
          o.status as order_status,
          CONCAT(u.first_name, ' ', u.last_name) as customer_name,
          u.email as customer_email,
          p.name as product_name,
          p.sku,
          c.name as category_name,
          oi.quantity,
          oi.unit_price,
          oi.total as line_total,
          o.subtotal,
          o.tax_amount,
          o.shipping_amount,
          o.discount_amount,
          o.total_amount as order_total,
          o.payment_method,
          o.payment_status
        FROM orders o
        JOIN order_items oi ON o.order_id = oi.order_id
        JOIN products p ON oi.product_id = p.product_id
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN users u ON o.user_id = u.user_id
        WHERE o.created_at BETWEEN $1 AND $2
          AND o.status IN ('completed', 'shipped', 'delivered')
          ${sellerCondition}
        ORDER BY o.created_at DESC, o.order_number, oi.order_item_id
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getSalesReportData', { error: error.message });
      throw new DatabaseError('Failed to fetch sales report data');
    }
  },

  /**
   * Export inventory report data
   */
  getInventoryReportData: async(userId, userRole)=> {
    try {
      const sellerCondition = userRole === 'seller' ? 'AND p.seller_id = $1' : '';
      const params = userRole === 'seller' ? [userId] : [];

      const query = `
        SELECT 
          p.name as product_name,
          p.sku,
          c.name as category_name,
          p.brand,
          p.price,
          p.cost_price,
          i.quantity as current_stock,
          i.reserved_quantity,
          (i.quantity - i.reserved_quantity) as available_stock,
          i.low_stock_threshold,
          CASE 
            WHEN i.quantity <= 0 THEN 'Out of Stock'
            WHEN i.quantity <= i.low_stock_threshold THEN 'Low Stock'
            ELSE 'In Stock'
          END as stock_status,
          i.warehouse_location,
          i.last_restock_date,
          i.next_restock_date,
          (i.quantity * p.cost_price) as inventory_value,
          p.is_active,
          p.created_at as product_created_date
        FROM products p
        LEFT JOIN inventory i ON p.product_id = i.product_id
        LEFT JOIN categories c ON p.category_id = c.category_id
        WHERE p.is_active = TRUE
          ${sellerCondition}
        ORDER BY 
          CASE 
            WHEN i.quantity <= 0 THEN 1
            WHEN i.quantity <= i.low_stock_threshold THEN 2
            ELSE 3
          END,
          c.name, p.name
      `;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error in getInventoryReportData', { error: error.message });
      throw new DatabaseError('Failed to fetch inventory report data');
    }
  }







};

module.exports = analyticsQueries;