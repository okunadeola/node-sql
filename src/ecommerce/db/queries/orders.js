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
   * Get order by ID
   * @param {string} orderId - Order ID
   * @returns {Promise<Object>} Order with items
   */
  getOrderItems: async (orderId) => {
    try {
      // Get order
      const itemsQuery = `
        SELECT * FROM order_items
        WHERE order_id = $1
        ORDER BY created_at
      `;
      
      const itemsResult = await db.query(itemsQuery, [orderId]);
      
      return  itemsResult.rows;
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

    
    try {
      await db.query('BEGIN');
      
      // Update order status
      const updateQuery = `
        UPDATE orders
        SET status = $1,
            updated_at = CURRENT_TIMESTAMP,
            completed_at = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
        WHERE order_id = $2
        RETURNING *
      `;
      
      const result = await db.query(updateQuery, [status, orderId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError(`Order not found: ${orderId}`);
      }
      
      // Add order history entry
      await db.query(
        `INSERT INTO order_history (order_id, status, comment, created_by)
         VALUES ($1, $2, $3, $4)`,
        [orderId, status, options.comment || `Status updated to ${status}`, options.userId]
      );
      
      await db.query('COMMIT');
      
      return result.rows[0];
    } catch (error) {
      await db.query('ROLLBACK');
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
  },
    /**
   * Get all orders with pagination and filtering
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Orders with pagination info
   */
  getAllOrders: async (options = {}) => {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        fromDate,
        toDate,
        customerId,
        minAmount,
        maxAmount,
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = options;
      
      // Build filters
      const filters = {};
      
      if (status) {
        filters.status = Array.isArray(status) ? { operator: 'IN', value: status } : status;
      }
      
      if (customerId) {
        filters.user_id = customerId;
      }
      
      if (fromDate || toDate) {
        filters.created_at = {};
        if (fromDate) filters.created_at['>='] = fromDate;
        if (toDate) filters.created_at['<='] = toDate;
      }
      
      // Create query with SqlBuilder
      const { query, params, pagination } = SqlBuilder.buildSelectQuery(
        'orders',
        ['*'],
        filters,
        {
          sort: `${sortBy} ${sortOrder}`,
          pagination: { page, limit }
        }
      );
      
      // Execute query
      const result = await db.query(query, params);
      
      // Get total count for pagination
      const countQuery = SqlBuilder.buildCountQuery('orders', filters);
      const countResult = await db.query(countQuery.query, countQuery.params);
      const totalCount = parseInt(countResult.rows[0].total, 10);
      
      return {
        orders: result.rows,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          totalItems: totalCount,
          totalPages: Math.ceil(totalCount / pagination.limit)
        }
      };
    } catch (error) {
      logger.error('Error fetching all orders', { error: error.message });
      throw new DatabaseError('Failed to fetch orders');
    }
  },
  
  /**
   * Get orders for a specific customer
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Orders with pagination info
   */
  getOrdersByUser: async (userId, options = {}) => {
    try {
      const {
        page = 1,
        limit = 10,
        status,
        fromDate,
        toDate,
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = options;
      
      // Build filters
      const filters = { user_id: userId };
      
      if (status) {
        filters.status = Array.isArray(status) ? { operator: 'IN', value: status } : status;
      }
      
      if (fromDate || toDate) {
        filters.created_at = {};
        if (fromDate) filters.created_at['>='] = fromDate;
        if (toDate) filters.created_at['<='] = toDate;
      }
      
      // Create query with SqlBuilder
      const { query, params, pagination } = SqlBuilder.buildSelectQuery(
        'orders',
        ['*'],
        filters,
        {
          sort: `${sortBy} ${sortOrder}`,
          pagination: { page, limit }
        }
      );
      
      // Execute query
      const result = await db.query(query, params);
      
      // Get total count for pagination
      const countQuery = SqlBuilder.buildCountQuery('orders', filters);
      const countResult = await db.query(countQuery.query, countQuery.params);
      const totalCount = parseInt(countResult.rows[0].total, 10);
      
      return {
        orders: result.rows,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          totalItems: totalCount,
          totalPages: Math.ceil(totalCount / pagination.limit)
        }
      };
    } catch (error) {
      logger.error('Error fetching orders by user', { error: error.message, userId });
      throw new DatabaseError('Failed to fetch orders');
    }
  },
  
  /**
   * Get a single order by ID
   * @param {string} orderId - Order ID
   * @returns {Promise<Object>} Order details
   */
  getOrderById2: async (orderId) => {
    try {
      // Get order details
      const orderQuery = `
        SELECT * FROM orders WHERE order_id = $1
      `;
      const orderResult = await db.query(orderQuery, [orderId]);
      
      if (orderResult.rows.length === 0) {
        throw new NotFoundError(`Order not found with ID: ${orderId}`);
      }
      
      // Get order items
      const itemsQuery = `
        SELECT oi.*, p.name as product_name, p.sku as product_sku,
          (SELECT url FROM product_images WHERE product_id = p.product_id AND is_primary = TRUE LIMIT 1) as product_image
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.product_id
        WHERE oi.order_id = $1
      `;
      const itemsResult = await db.query(itemsQuery, [orderId]);
      
      // Get payment information
      const paymentQuery = `
        SELECT * FROM payments WHERE order_id = $1
      `;
      const paymentResult = await db.query(paymentQuery, [orderId]);
      
      // Return complete order details
      return {
        ...orderResult.rows[0],
        items: itemsResult.rows,
        payments: paymentResult.rows
      };
    } catch (error) {
      logger.error('Error fetching order by ID', { error: error.message, orderId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to fetch order details');
    }
  },
  
  /**
   * Create a new order
   * @param {Object} orderData - Order data
   * @param {Array} orderItems - Order items
   * @param {Object} client - DB transaction client
   * @returns {Promise<Object>} Created order
   */
  createOrder2: async (orderData, orderItems, client = db) => {
    try {
      // Prepare order data insertion
      const { query: orderQuery, values: orderValues } = SqlBuilder.buildInsertQuery(
        'orders',
        orderData
      );
      
      // Insert order
      const orderResult = await client.query(orderQuery, orderValues);
      const order = orderResult.rows[0];
      
      // Prepare order items
      const orderItemsPromises = orderItems.map(item => {
        const orderItem = {
          ...item,
          order_id: order.order_id
        };
        
        const { query: itemQuery, values: itemValues } = SqlBuilder.buildInsertQuery(
          'order_items',
          orderItem
        );
        
        return client.query(itemQuery, itemValues);
      });
      
      // Insert order items
      const orderItemsResults = await Promise.all(orderItemsPromises);
      const items = orderItemsResults.map(result => result.rows[0]);
      
      // Create initial order history entry
      const historyEntry = {
        order_id: order.order_id,
        status: order.status,
        comment: 'Order created',
        created_by: orderData.user_id
      };
      
      const { query: historyQuery, values: historyValues } = SqlBuilder.buildInsertQuery(
        'order_history',
        historyEntry
      );
      
      await client.query(historyQuery, historyValues);
      
      return {
        ...order,
        items
      };
    } catch (error) {
      logger.error('Error creating order', { error: error.message });
      throw new DatabaseError('Failed to create order');
    }
  },
  
  /**
   * Update order status
   * @param {string} orderId - Order ID
   * @param {string} status - New status
   * @param {string} comment - Status change comment
   * @param {string} userId - User making the change
   * @returns {Promise<Object>} Updated order
   */
  updateOrderStatus2: async (orderId, status, comment, userId) => {
    // Start a transaction
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Update order status
      const updateQuery = `
        UPDATE orders
        SET 
          status = $1,
          updated_at = CURRENT_TIMESTAMP,
          completed_at = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
        WHERE order_id = $2
        RETURNING *
      `;
      
      const updateResult = await client.query(updateQuery, [status, orderId]);
      
      if (updateResult.rows.length === 0) {
        throw new NotFoundError(`Order not found with ID: ${orderId}`);
      }
      
      // Add order history entry
      const historyInsertQuery = `
        INSERT INTO order_history (order_id, status, comment, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;
      
      await client.query(historyInsertQuery, [orderId, status, comment, userId]);
      
      await client.query('COMMIT');
      
      return updateResult.rows[0];
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
   * Cancel an order
   * @param {string} orderId - Order ID
   * @param {string} userId - User ID cancelling the order
   * @param {string} reason - Cancellation reason
   * @returns {Promise<Object>} Cancelled order
   */
  cancelOrder: async (orderId, userId, reason) => {
    // Start a transaction
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Get current order status
      const orderQuery = `SELECT status FROM orders WHERE order_id = $1`;
      const orderResult = await client.query(orderQuery, [orderId]);
      
      if (orderResult.rows.length === 0) {
        throw new NotFoundError(`Order not found with ID: ${orderId}`);
      }
      
      const currentStatus = orderResult.rows[0].status;
      const nonCancellableStatuses = ['completed', 'cancelled', 'refunded', 'delivered'];
      
      if (nonCancellableStatuses.includes(currentStatus)) {
        throw new ConflictError(`Cannot cancel order with status: ${currentStatus}`);
      }
      
      // Update order status
      const updateQuery = `
        UPDATE orders
        SET 
          status = 'cancelled',
          updated_at = CURRENT_TIMESTAMP
        WHERE order_id = $1
        RETURNING *
      `;
      
      const updateResult = await client.query(updateQuery, [orderId]);
      
      // Add order history entry
      const historyInsertQuery = `
        INSERT INTO order_history (order_id, status, comment, created_by)
        VALUES ($1, 'cancelled', $2, $3)
        RETURNING *
      `;
      
      await client.query(historyInsertQuery, [orderId, reason || 'Order cancelled by user', userId]);
      
      // Return inventory to stock if needed
      const updateInventoryQuery = `
        UPDATE inventory i
        SET 
          quantity = i.quantity + oi.quantity,
          updated_at = CURRENT_TIMESTAMP
        FROM order_items oi
        WHERE oi.order_id = $1 AND i.product_id = oi.product_id
      `;
      
      await client.query(updateInventoryQuery, [orderId]);
      
      await client.query('COMMIT');
      
      return updateResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error cancelling order', { error: error.message, orderId });
      
      if (error instanceof NotFoundError || error instanceof ConflictError) {
        throw error;
      }
      
      throw new DatabaseError('Failed to cancel order');
    } finally {
      client.release();
    }
  },
  
  /**
   * Process refund for an order
   * @param {string} orderId - Order ID
   * @param {Object} refundData - Refund information
   * @param {string} userId - User ID processing the refund
   * @returns {Promise<Object>} Refund details
   */
  refundOrder: async (orderId, refundData, userId) => {
    // Start a transaction
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Check order exists and is in refundable state
      const orderQuery = `SELECT * FROM orders WHERE order_id = $1`;
      const orderResult = await client.query(orderQuery, [orderId]);
      
      if (orderResult.rows.length === 0) {
        throw new NotFoundError(`Order not found with ID: ${orderId}`);
      }
      
      const order = orderResult.rows[0];
      const nonRefundableStatuses = ['refunded', 'cancelled'];
      
      if (nonRefundableStatuses.includes(order.status)) {
        throw new ConflictError(`Cannot refund order with status: ${order.status}`);
      }
      
      // Update order status
      const updateOrderQuery = `
        UPDATE orders
        SET 
          status = 'refunded',
          updated_at = CURRENT_TIMESTAMP
        WHERE order_id = $1
        RETURNING *
      `;
      
      await client.query(updateOrderQuery, [orderId]);
      
      // Record refund in payment table
      const refundPaymentQuery = `
        INSERT INTO payments (
          order_id, amount, payment_method, payment_provider,
          transaction_id, status, provider_response
        )
        VALUES ($1, $2, $3, $4, $5, 'refunded', $6)
        RETURNING *
      `;
      
      const refundPaymentParams = [
        orderId,
        refundData.amount,
        refundData.payment_method || order.payment_method,
        refundData.payment_provider,
        refundData.transaction_id,
        refundData.provider_response || {}
      ];
      
      const refundResult = await client.query(refundPaymentQuery, refundPaymentParams);
      
      // Add order history entry
      const historyInsertQuery = `
        INSERT INTO order_history (order_id, status, comment, created_by)
        VALUES ($1, 'refunded', $2, $3)
        RETURNING *
      `;
      
      await client.query(historyInsertQuery, [
        orderId, 
        refundData.reason || 'Order refunded', 
        userId
      ]);
      
      // Return inventory to stock if needed
      if (refundData.return_to_inventory) {
        const updateInventoryQuery = `
          UPDATE inventory i
          SET 
            quantity = i.quantity + oi.quantity,
            updated_at = CURRENT_TIMESTAMP
          FROM order_items oi
          WHERE oi.order_id = $1 AND i.product_id = oi.product_id
        `;
        
        await client.query(updateInventoryQuery, [orderId]);
      }
      
      await client.query('COMMIT');
      
      return refundResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error processing refund', { error: error.message, orderId });
      
      if (error instanceof NotFoundError || error instanceof ConflictError) {
        throw error;
      }
      
      throw new DatabaseError('Failed to process refund');
    } finally {
      client.release();
    }
  },
  
  /**
   * Update order item
   * @param {string} orderId - Order ID
   * @param {string} itemId - Order item ID
   * @param {Object} itemData - Updated item data
   * @returns {Promise<Object>} Updated order item
   */
  updateOrderItem: async (orderId, itemId, itemData) => {
    try {
      // Check if order is in editable state
      const orderQuery = `SELECT status FROM orders WHERE order_id = $1`;
      const orderResult = await db.query(orderQuery, [orderId]);
      
      if (orderResult.rows.length === 0) {
        throw new NotFoundError(`Order not found with ID: ${orderId}`);
      }
      
      const status = orderResult.rows[0].status;
      const nonEditableStatuses = ['completed', 'cancelled', 'refunded', 'delivered'];
      
      if (nonEditableStatuses.includes(status)) {
        throw new ConflictError(`Cannot edit items for order with status: ${status}`);
      }
      
      // Update order item
      const { query, values } = SqlBuilder.buildUpdateQuery(
        'order_items',
        itemData,
        { order_item_id: itemId, order_id: orderId }
      );
      
      const result = await db.query(query, values);
      
      if (result.rows.length === 0) {
        throw new NotFoundError(`Order item not found with ID: ${itemId}`);
      }
      
      // If quantity changed, update order totals
      if ('quantity' in itemData || 'unit_price' in itemData) {
        await updateOrderTotals(orderId);
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating order item', { error: error.message, orderId, itemId });
      
      if (error instanceof NotFoundError || error instanceof ConflictError) {
        throw error;
      }
      
      throw new DatabaseError('Failed to update order item');
    }
  },
  
  /**
   * Get order history
   * @param {string} orderId - Order ID
   * @returns {Promise<Array>} Order history entries
   */
  getOrderHistory: async (orderId) => {
    try {
      const query = `
        SELECT 
          oh.*,
          u.username as user_username,
          u.first_name as user_first_name,
          u.last_name as user_last_name
        FROM order_history oh
        LEFT JOIN users u ON oh.created_by = u.user_id
        WHERE oh.order_id = $1
        ORDER BY oh.created_at DESC
      `;
      
      const result = await db.query(query, [orderId]);
      
      return result.rows;
    } catch (error) {
      logger.error('Error fetching order history', { error: error.message, orderId });
      throw new DatabaseError('Failed to fetch order history');
    }
  },
  
  /**
   * Add order history entry
   * @param {string} orderId - Order ID
   * @param {Object} historyData - History entry data
   * @returns {Promise<Object>} Created history entry
   */
  addOrderHistoryEntry: async (orderId, historyData) => {
    try {
      // Check if order exists
      const orderQuery = `SELECT order_id FROM orders WHERE order_id = $1`;
      const orderResult = await db.query(orderQuery, [orderId]);
      
      if (orderResult.rows.length === 0) {
        throw new NotFoundError(`Order not found with ID: ${orderId}`);
      }
      
      // Add history entry
      const { query, values } = SqlBuilder.buildInsertQuery(
        'order_history',
        { ...historyData, order_id: orderId }
      );
      
      const result = await db.query(query, values);
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error adding order history entry', { error: error.message, orderId });
      
      if (error instanceof NotFoundError) {
        throw error;
      }
      
      throw new DatabaseError('Failed to add order history entry');
    }
  },
  
  /**
   * Process payment for an order
   * @param {string} orderId - Order ID
   * @param {Object} paymentData - Payment data
   * @returns {Promise<Object>} Payment result
   */
  processPayment: async (orderId, paymentData) => {
    // Start a transaction
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Check order exists and is in payable state
      const orderQuery = `SELECT * FROM orders WHERE order_id = $1`;
      const orderResult = await client.query(orderQuery, [orderId]);
      
      if (orderResult.rows.length === 0) {
        throw new NotFoundError(`Order not found with ID: ${orderId}`);
      }
      
      const order = orderResult.rows[0];
      
      if (order.payment_status === 'paid') {
        throw new ConflictError('Order has already been paid');
      }
      
      // Record payment
      const paymentInsertQuery = `
        INSERT INTO payments (
          order_id, amount, payment_method, payment_provider,
          transaction_id, status, provider_response
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      
      const paymentInsertParams = [
        orderId,
        paymentData.amount,
        paymentData.payment_method,
        paymentData.payment_provider,
        paymentData.transaction_id,
        paymentData.status || 'completed',
        paymentData.provider_response || {}
      ];
      
      const paymentResult = await client.query(paymentInsertQuery, paymentInsertParams);
      
      // Update order payment status
      const updateOrderQuery = `
        UPDATE orders
        SET 
          payment_status = $1,
          status = CASE WHEN status = 'pending' THEN 'processing' ELSE status END,
          updated_at = CURRENT_TIMESTAMP
        WHERE order_id = $2
        RETURNING *
      `;
      
      const paymentStatus = paymentData.status === 'completed' ? 'paid' : paymentData.status;
      await client.query(updateOrderQuery, [paymentStatus, orderId]);
      
      // Add order history entry
      const historyInsertQuery = `
        INSERT INTO order_history (order_id, status, comment, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;
      
      await client.query(historyInsertQuery, [
        orderId, 
        'payment_' + paymentStatus, 
        `Payment processed via ${paymentData.payment_method}`, 
        order.user_id
      ]);
      
      await client.query('COMMIT');
      
      return paymentResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error processing payment', { error: error.message, orderId });
      
      if (error instanceof NotFoundError || error instanceof ConflictError) {
        throw error;
      }
      
      throw new DatabaseError('Failed to process payment');
    } finally {
      client.release();
    }
  },
  
  /**
   * Get payment details for an order
   * @param {string} orderId - Order ID
   * @returns {Promise<Array>} Payment details
   */
  getPaymentDetails: async (orderId) => {
    try {
      const query = `SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC`;
      const result = await db.query(query, [orderId]);
      
      return result.rows;
    } catch (error) {
      logger.error('Error fetching payment details', { error: error.message, orderId });
      throw new DatabaseError('Failed to fetch payment details');
    }
  },
  
  /**
   * Export orders to CSV format
   * @param {Object} filters - Export filters
   * @returns {Promise<Array>} Orders data for CSV export
   */
  exportOrdersData: async (filters = {}) => {
    try {
      const { fromDate, toDate, status } = filters;
      
      // Construct WHERE clause
      let whereClause = '';
      const params = [];
      let paramIndex = 1;
      
      if (fromDate || toDate) {
        if (fromDate) {
          whereClause += `${whereClause ? ' AND ' : ' WHERE '}o.created_at >= $${paramIndex++}`;
          params.push(fromDate);
        }
        
        if (toDate) {
          whereClause += `${whereClause ? ' AND ' : ' WHERE '}o.created_at <= $${paramIndex++}`;
          params.push(toDate);
        }
      }
      
      if (status) {
        whereClause += `${whereClause ? ' AND ' : ' WHERE '}o.status = $${paramIndex++}`;
        params.push(status);
      }
      
      const query = `
        SELECT 
          o.order_id,
          o.order_number,
          o.created_at,
          o.status,
          o.payment_status,
          o.total_amount,
          u.username,
          u.email,
          o.shipping_address->>'first_name' || ' ' || o.shipping_address->>'last_name' as customer_name,
          o.shipping_address->>'address_line1' as shipping_address_line1,
          o.shipping_address->>'city' as shipping_city,
          o.shipping_address->>'country' as shipping_country,
          (SELECT COUNT(*) FROM order_items WHERE order_id = o.order_id) as item_count
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.user_id
        ${whereClause}
        ORDER BY o.created_at DESC
      `;
      
      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error exporting orders data', { error: error.message });
      throw new DatabaseError('Failed to export orders data');
    }
  }
};

/**
 * Helper function to update order totals after item changes
 * @param {string} orderId - Order ID
 * @returns {Promise<void>}
 */
async function updateOrderTotals(orderId) {
  try {
    const updateQuery = `
      UPDATE orders o
      SET
        subtotal = subquery.subtotal,
        total_amount = subquery.subtotal + o.tax_amount + o.shipping_amount - o.discount_amount,
        updated_at = CURRENT_TIMESTAMP
      FROM (
        SELECT 
          order_id,
          SUM(quantity * unit_price) as subtotal
        FROM order_items
        WHERE order_id = $1
        GROUP BY order_id
      ) as subquery
      WHERE o.order_id = subquery.order_id
    `;
    
    await db.query(updateQuery, [orderId]);
  } catch (error) {
    logger.error('Error updating order totals', { error: error.message, orderId });
    throw new DatabaseError('Failed to update order totals');
  }
};

module.exports = orderQueries;