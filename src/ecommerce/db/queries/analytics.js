// db/queries/analytics.js
const analyticsQueries = {
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