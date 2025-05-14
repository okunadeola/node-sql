/**
 * Order Queries
 * Handles all SQL queries related to orders and order processing
 */
const db = require('../../config/db');
const SqlBuilder = require('../../utils/sqlBuilder');
const logger = require('../../utils/logger');
const { NotFoundError, DatabaseError, ValidationError } = require('../../utils/error');

/**
 * Generate a unique order number
 * @returns {string} Unique order number
 */
const generateOrderNumber = () => {
  const timestamp = new Date().getTime().toString().slice(-8);
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `ORD-${timestamp}-${random}`;
};

const orderQueries = {
  /**
   * Create a new order
   * @param {Object} orderData - Order data including items
   * @returns {Promise<Object>} Created order
   */
  createOrder: async (orderData) => {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Generate order number
      const orderNumber = generateOrderNumber();
      
      // Calculate order totals
      const subtotal = orderData.items.reduce(
        (sum, item) => sum + (item.unit_price * item.quantity), 
        0
      );
      
      // Apply tax, shipping, discounts as needed
      const taxAmount = orderData.tax_amount || 0;
      const shippingAmount = orderData.shipping_amount || 0;
      const discountAmount = orderData.discount_amount || 0;
      
      const totalAmount = subtotal + taxAmount + shippingAmount - discountAmount;
      
      // Insert order
      const orderInsertQuery = `
        INSERT INTO orders (
          user_id, order_number, status, subtotal, tax_amount, 
          shipping_amount, discount_amount, total_amount,
          shipping_address, billing_address, payment_method, payment_status, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `;
      
      const orderParams = [
        orderData.user_id, 
        orderNumber,
        orderData.status || 'pending',
        subtotal,
        taxAmount,
        shippingAmount,
        discountAmount,
        totalAmount,
        orderData.shipping_address,
        orderData.billing_address || orderData.shipping_address,
        orderData.payment_method,
        orderData.payment_status || 'pending',
        orderData.notes || null
      ];
      
      const orderResult = await client.query(orderInsertQuery, orderParams);
      const order = orderResult.rows[0];
      
      // Insert order items
      const orderItems = [];
      
      for (const item of orderData.items) {
        // Get product details
        const productQuery = 'SELECT * FROM products WHERE product_id = $1';
        const productResult = await client.query(productQuery, [item.product_id]);
        
        if (productResult.rows.length === 0) {
          throw new ValidationError(`Product not found: ${item.product_id}`);
        }
        
        const product = productResult.rows[0];
        
        // Calculate item totals
        const itemSubtotal = item.unit_price * item.quantity;
        const itemTax = item.tax_amount || 0;
        const itemDiscount = item.discount_amount || 0;
        const itemTotal = itemSubtotal + itemTax - itemDiscount;
        
        // Insert order item
        const orderItemQuery = `
          INSERT INTO order_items (
            order_id, product_id, name, sku, quantity, unit_price,
            subtotal, tax_amount, discount_amount, total, product_data
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `;
        
        const orderItemParams = [
          order.order_id,
          product.product_id,
          product.name, // Use product name from product table
          product.sku,
          item.quantity,
          item.unit_price,
          itemSubtotal,
          itemTax,
          itemDiscount,
          itemTotal,
          JSON.stringify(product) // Store product snapshot
        ];
        
        const orderItemResult = await client.query(orderItemQuery, orderItemParams);
        orderItems.push(orderItemResult.rows[0]);
        
        // Update inventory
        const updateInventoryQuery = `
          UPDATE inventory
          SET quantity = quantity - $1,
              updated_at = CURRENT_TIMESTAMP
          WHERE product_id = $2
          RETURNING quantity
        `;
        
        const inventoryResult = await client.query(
          updateInventoryQuery, 
          [item.quantity, product.product_id]
        );
        
        if (inventoryResult.rows.length === 0) {
          throw new ValidationError(`No inventory found for product: ${product.product_id}`);
        }
        
        // Check if we've gone negative on inventory
        if (inventoryResult.rows[0].quantity < 0) {
          throw new ValidationError(
            `Insufficient inventory for product: ${product.name} (${product.sku})`
          );
        }
      }
      
      // Add order history entry
      await client.query(
        `INSERT INTO order_history (order_id, status, comment, created_by)
         VALUES ($1, $2, $3, $4)`,
        [order.order_id, order.status, 'Order created', orderData.user_id]
      );
      
      await client.query('COMMIT');
      
      return { ...order, items: orderItems };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating order', { error: error.message });
      
      if (error instanceof ValidationError) {
        throw error;
      }
      
      throw new DatabaseError('Failed to create order: ' + error.message);
    } finally {
      client.release();
    }
  },
  
  /**
   * Get order by ID
   * @param {string} orderId - Order ID
   * @returns {Promise<Object>} Order with items
   */
  getOrderById: async (orderId) => {
    try {
      // Get order
      const orderQuery = `
        SELECT o.*, 
               json_build_object(
                 'first_name', u.first_name,
                 'last_name', u.last_name,
                 'email', u.email
               ) AS user_info
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.user_id
        WHERE o.order_id = $1
      `;
      
      const orderResult = await db.query(orderQuery, [orderId]);
      
      if (orderResult.rows.length === 0) {
        throw new NotFoundError(`Order not found: ${orderId}`);
      }
      
      const order = orderResult.rows[0];
      
      // Get order items
      const itemsQuery = `
        SELECT * FROM order_items
        WHERE order_id = $1
        ORDER BY created_at
      `;
      
      const itemsResult = await db.query(itemsQuery, [orderId]);
      
      // Get order history
      const historyQuery = `
        SELECT oh.*, 
               json_build_object(
                 'first_name', u.first_name,
                 'last_name', u.last_name
               ) AS user_info
        FROM order_history oh
        LEFT JOIN users u ON oh.created_by = u.user_id
        WHERE oh.order_id = $1
        ORDER BY oh.created_at DESC
      `;
      
      const historyResult = await db.query(historyQuery, [orderId]);
      
      // Get payment details
      const paymentsQuery = `
        SELECT * FROM payments
        WHERE order_id = $1
        ORDER BY created_at DESC
      `;
      
      const paymentsResult = await db.query(paymentsQuery, [orderId]);
      
      return {
        ...order,
        items: itemsResult.rows,
        history: historyResult.rows,
        payments: paymentsResult.rows
      };
    } catch (error) {
      logger.error('Error fetching order', { error: error.message, orderId });
      
      if (error instanceof NotFoundError) {
        throw error;
      }
      
      throw new DatabaseError('Failed to fetch order');
    }
  },
  
  /**
   * Update order status
   * @param {string} orderId - Order ID
   * @param {string} status - New status
   * @param {Object} options - Additional options (comment, userId)
   * @returns {Promise<Object>} Updated order
   */
  updateOrderStatus: async (orderId, status, options = {}) => {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Update order status
      const updateQuery = `
        UPDATE orders
        SET status = $1,
            updated_at = CURRENT_TIMESTAMP,
            completed_at = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
        WHERE order_id = $2
        RETURNING *
      `;
      
      const result = await client.query(updateQuery, [status, orderId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError(`Order not found: ${orderId}`);
      }
      
      // Add order history entry
      await client.query(
        `INSERT INTO order_history (order_id, status, comment, created_by)
         VALUES ($1, $2, $3, $4)`,
        [orderId, status, options.comment || `Status updated to ${status}`, options.userId]
      );
      
      await client.query('COMMIT');
      
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error updating order status', { error: error.message, orderId, status });
      
      if (error instanceof NotFoundError) {
        throw error;
      }
      
      throw new DatabaseError('Failed to update order status');
    } finally {
      client.release();
    }
  },
  
  /**
   * Get orders with filters and pagination
   * @param {Object} filters - Filter criteria
   * @param {Object} options - Sort and pagination options
   * @returns {Promise<Object>} Paginated orders
   */
  getOrders: async (filters = {}, options = {}) => {
    try {
      // Build query with filters
      const whereConditions = [];
      const params = [];
      let paramIndex = 1;
      
      if (filters.user_id) {
        whereConditions.push(`o.user_id = $${paramIndex++}`);
        params.push(filters.user_id);
      }
      
      if (filters.status) {
        whereConditions.push(`o.status = $${paramIndex++}`);
        params.push(filters.status);
      }
      
      if (filters.payment_status) {
        whereConditions.push(`o.payment_status = $${paramIndex++}`);
        params.push(filters.payment_status);
      }
      
      if (filters.created_after) {
        whereConditions.push(`o.created_at >= $${paramIndex++}`);
        params.push(filters.created_after);
      }
      
      if (filters.created_before) {
        whereConditions.push(`o.created_at <= $${paramIndex++}`);
        params.push(filters.created_before);
      }
      
      if (filters.min_total) {
        whereConditions.push(`o.total_amount >= $${paramIndex++}`);
        params.push(filters.min_total);
      }
      
      if (filters.max_total) {
        whereConditions.push(`o.total_amount <= $${paramIndex++}`);
        params.push(filters.max_total);
      }
      
      if (filters.order_number) {
        whereConditions.push(`o.order_number ILIKE $${paramIndex++}`);
        params.push(`%${filters.order_number}%`);
      }
      
      // Build WHERE clause
      const whereClause = whereConditions.length > 0
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';
      
      // Add sort options
      const sortField = options.sortField || 'o.created_at';
      const sortDirection = options.sortDirection || 'DESC';
      
      // Add pagination
      const page = options.page || 1;
      const limit = options.limit || 20;
      const offset = (page - 1) * limit;
      
      // Count total records for pagination
      const countQuery = `
        SELECT COUNT(*) as total
        FROM orders o
        ${whereClause}
      `;
      
      const countResult = await db.query(countQuery, params);
      const total = parseInt(countResult.rows[0].total);
      
      // Query orders with pagination
      const query = `
        SELECT o.*,
               u.first_name || ' ' || u.last_name AS customer_name,
               u.email AS customer_email,
               (SELECT COUNT(*) FROM order_items WHERE order_id = o.order_id) AS item_count
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.user_id
        ${whereClause}
        ORDER BY ${sortField} ${sortDirection}
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;
      
      const queryParams = [...params, limit, offset];
      const result = await db.query(query, queryParams);
      
      return {
        orders: result.rows,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error fetching orders', { error: error.message });
      throw new DatabaseError('Failed to fetch orders');
    }
  },
  
  /**
   * Get order analytics
   * @param {Object} filters - Filter criteria (date range, etc.)
   * @returns {Promise<Object>} Order analytics data
   */
  getOrderAnalytics: async (filters = {}) => {
    try {
      const whereConditions = [];
      const params = [];
      let paramIndex = 1;
      
      // Add date range filters
      if (filters.start_date) {
        whereConditions.push(`o.created_at >= $${paramIndex++}`);
        params.push(filters.start_date);
      }
      
      if (filters.end_date) {
        whereConditions.push(`o.created_at <= $${paramIndex++}`);
        params.push(filters.end_date);
      }
      
      const whereClause = whereConditions.length > 0
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';
      
      // Get analytics data
      const query = `
        WITH order_data AS (
          SELECT
            o.order_id,
            o.created_at,
            o.status,
            o.payment_status,
            o.total_amount,
            DATE_TRUNC('day', o.created_at) AS order_date
          FROM orders o
          ${whereClause}
        )
        SELECT
          -- General stats
          COUNT(order_id) AS total_orders,
          COUNT(DISTINCT CASE WHEN status = 'completed' THEN order_id END) AS completed_orders,
          COUNT(DISTINCT CASE WHEN status = 'cancelled' THEN order_id END) AS cancelled_orders,
          SUM(total_amount) AS total_revenue,
          AVG(total_amount) AS average_order_value,
          
          -- Daily stats
          json_agg(
            json_build_object(
              'date', order_date,
              'orders', COUNT(order_id),
              'revenue', SUM(total_amount)
            )
            ORDER BY order_date
          ) FILTER (WHERE order_date IS NOT NULL) AS daily_orders
          
        FROM order_data
      `;
      
      const result = await db.query(query, params);
      
      // Get top products
      const topProductsQuery = `
        SELECT
          oi.product_id,
          oi.name AS product_name,
          SUM(oi.quantity) AS total_quantity,
          COUNT(DISTINCT oi.order_id) AS order_count,
          SUM(oi.total) AS total_revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.order_id
        ${whereClause}
        GROUP BY oi.product_id, oi.name
        ORDER BY total_quantity DESC
        LIMIT 10
      `;
      
      const topProductsResult = await db.query(topProductsQuery, params);
      
      // Get status breakdown
      const statusQuery = `
        SELECT
          status,
          COUNT(*) AS count,
          SUM(total_amount) AS total_amount
        FROM orders o
        ${whereClause}
        GROUP BY status
        ORDER BY count DESC
      `;
      
      const statusResult = await db.query(statusQuery, params);
      
      return {
        summary: result.rows[0],
        top_products: topProductsResult.rows,
        status_breakdown: statusResult.rows
      };
    } catch (error) {
      logger.error('Error getting order analytics', { error: error.message });
      throw new DatabaseError('Failed to get order analytics');
    }
  },

    applyDiscount: (orderId) => {
    return `
      WITH order_info AS (
        SELECT 
          o.subtotal,
          o.user_id,
          ARRAY_AGG(oi.product_id) AS product_ids,
          ARRAY_AGG(DISTINCT p.category_id) AS category_ids
        FROM orders o
        JOIN order_items oi ON o.order_id = oi.order_id
        JOIN products p ON oi.product_id = p.product_id
        WHERE o.order_id = '${orderId}'
        GROUP BY o.order_id
      )
      UPDATE orders
      SET discount_amount = COALESCE(
        (SELECT MAX(
          CASE 
            WHEN d.type = 'percentage' THEN LEAST(
              oi.subtotal * d.value / 100, 
              d.max_discount_amount
            )
            WHEN d.type = 'fixed_amount' THEN LEAST(
              d.value, 
              oi.subtotal
            )
            ELSE 0
          END
        )
        FROM discounts d
        LEFT JOIN discount_products dp ON d.discount_id = dp.discount_id
        LEFT JOIN discount_categories dc ON d.discount_id = dc.discount_id
        WHERE d.is_active = TRUE
          AND NOW() BETWEEN d.starts_at AND d.ends_at
          AND (
            (dp.product_id IS NULL AND dc.category_id IS NULL) OR
            dp.product_id = ANY(oi.product_ids) OR
            dc.category_id = ANY(oi.category_ids)
          AND (d.usage_limit IS NULL OR d.usage_count < d.usage_limit)
          AND (d.min_purchase_amount IS NULL OR oi.subtotal >= d.min_purchase_amount)
        ), 0),
        total_amount = subtotal + tax_amount + shipping_amount - discount_amount
      FROM order_info oi
      WHERE orders.order_id = '${orderId}'
      RETURNING *;`;
  }
};

module.exports = orderQueries;