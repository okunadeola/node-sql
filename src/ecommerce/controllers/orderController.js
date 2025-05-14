/**
 * Order Controller
 * Handles all order-related operations
 */
const orderQueries = require('../db/queries/orders');
const productQueries = require('../db/queries/products');
const { NotFoundError, ValidationError, ConflictError } = require('../utils/error');
const logger = require('../utils/logger');

/**
 * Get all orders for current user
 */
exports.getUserOrders = async (req, res, next) => {
  try {
    const userId = req.user.user_id;
    const { page = 1, limit = 10, status } = req.query;
    
    const filters = { user_id: userId };
    if (status) filters.status = status;
    
    const orders = await orderQueries.findOrders(filters, {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: 'created_at:desc'
    });
    
    res.status(200).json({
      success: true,
      data: orders.data,
      pagination: orders.pagination
    });
  } catch (error) {
    logger.error('Error fetching user orders', { error: error.message, userId: req.user.user_id });
    next(error);
  }
};

/**
 * Get a single order by ID
 */
exports.getOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.user_id;
    
    // Fetch order with items
    const order = await orderQueries.findOrderById(id, true);
    
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    // Check if user owns this order or is admin
    if (order.user_id !== userId && req.user.role !== 'admin') {
      throw new ValidationError('You do not have permission to view this order');
    }
    
    // Fetch order history
    const history = await orderQueries.getOrderHistory(id);
    
    res.status(200).json({
      success: true,
      data: {
        ...order,
        history
      }
    });
  } catch (error) {
    logger.error('Error fetching order', { error: error.message, orderId: req.params.id });
    next(error);
  }
};

/**
 * Create a new order
 */
exports.createOrder = async (req, res, next) => {
  try {
    const {
      shipping_address,
      billing_address,
      payment_method,
      cart_items,
      notes,
      shipping_method
    } = req.body;
    
    // Validate required fields
    if (!shipping_address || !billing_address || !payment_method || !cart_items || !cart_items.length) {
      throw new ValidationError('Missing required order information');
    }
    
    // Validate product availability and calculate order totals
    const productIds = cart_items.map(item => item.product_id);
    const products = await productQueries.findProductsByIds(productIds);
    
    // Create a map for quick product lookup
    const productMap = {};
    products.forEach(product => {
      productMap[product.product_id] = product;
    });
    
    // Validate and build order items
    const orderItems = [];
    let subtotal = 0;
    
    for (const item of cart_items) {
      const product = productMap[item.product_id];
      
      // Make sure product exists and is active
      if (!product || !product.is_active) {
        throw new ValidationError(`Product ${item.product_id} is not available`);
      }
      
      // Check inventory
      const inventory = await productQueries.getProductInventory(item.product_id);
      if (item.quantity > inventory.quantity) {
        throw new ValidationError(`Insufficient inventory for ${product.name}`);
      }
      
      // Calculate item price
      const itemSubtotal = product.price * item.quantity;
      subtotal += itemSubtotal;
      
      // Build order item
      orderItems.push({
        product_id: item.product_id,
        name: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unit_price: product.price,
        subtotal: itemSubtotal,
        tax_amount: 0, // Will be calculated below
        discount_amount: 0, // Will be calculated if discounts are applied
        total: itemSubtotal, // Will be updated after tax and discounts
        product_data: {
          product_id: product.product_id,
          name: product.name,
          sku: product.sku,
          price: product.price,
          image: product.primary_image
        }
      });
    }
    
    // Calculate taxes and shipping (simplified for now)
    // In a real application, you would likely use a tax service
    const taxRate = 0.08; // 8% tax rate
    const taxAmount = subtotal * taxRate;
    
    // Calculate shipping cost
    let shippingAmount = 0;
    switch (shipping_method) {
      case 'standard':
        shippingAmount = 5.99;
        break;
      case 'express':
        shippingAmount = 12.99;
        break;
      case 'free':
      default:
        shippingAmount = 0;
    }
    
    // Calculate discount (would come from coupons, etc.)
    const discountAmount = 0;
    
    // Calculate final total
    const totalAmount = subtotal + taxAmount + shippingAmount - discountAmount;
    
    // Apply tax to each item proportionally
    orderItems.forEach(item => {
      item.tax_amount = (item.subtotal / subtotal) * taxAmount;
      item.total = item.subtotal + item.tax_amount - item.discount_amount;
    });
    
    // Create the order
    const orderData = {
      user_id: req.user.user_id,
      status: 'pending',
      subtotal,
      tax_amount: taxAmount,
      shipping_amount: shippingAmount,
      discount_amount: discountAmount,
      total_amount: totalAmount,
      shipping_address,
      billing_address,
      payment_method,
      notes,
      items: orderItems
    };
    
    const order = await orderQueries.createOrder(orderData);
    
    // Update inventory
    for (const item of orderItems) {
      await productQueries.updateProductInventory(item.product_id, -item.quantity);
    }
    
    // Clear user's cart if a cart_id was provided
    if (req.body.cart_id) {
      await orderQueries.clearCart(req.body.cart_id);
    }
    
    res.status(201).json({
      success: true,
      data: order
    });
  } catch (error) {
    logger.error('Error creating order', { error: error.message, userId: req.user?.user_id });
    next(error);
  }
};

/**
 * Update an order status (admin or seller only)
 */
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, comment } = req.body;
    
    // Validate user role
    if (req.user.role !== 'admin' && req.user.role !== 'seller') {
      throw new ValidationError('Insufficient permissions to update order status');
    }
    
    // Validate order exists
    const order = await orderQueries.findOrderById(id);
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    // If seller, make sure they own the products in this order
    if (req.user.role === 'seller') {
      const sellerAuthorized = await orderQueries.isOrderOwnedBySeller(id, req.user.user_id);
      if (!sellerAuthorized) {
        throw new ValidationError('You do not have permission to update this order');
      }
    }
    
    // Validate status transition
    const validStatusTransitions = {
      pending: ['processing', 'on_hold', 'cancelled'],
      processing: ['on_hold', 'shipped', 'cancelled'],
      on_hold: ['processing', 'cancelled'],
      shipped: ['delivered', 'returned'],
      delivered: ['returned', 'completed'],
      returned: ['refunded'],
      cancelled: ['refunded']
    };
    
    if (!validStatusTransitions[order.status].includes(status)) {
      throw new ValidationError(`Cannot transition from ${order.status} to ${status}`);
    }
    
    // Update order status
    const updatedOrder = await orderQueries.updateOrderStatus(id, status, comment, req.user.user_id);
    
    // Special handling for inventory based on status changes
    if (status === 'cancelled' || status === 'returned') {
      // Return items to inventory
      const orderItems = await orderQueries.getOrderItems(id);
      for (const item of orderItems) {
        await productQueries.updateProductInventory(item.product_id, item.quantity);
      }
    }
    
    res.status(200).json({
      success: true,
      data: updatedOrder
    });
  } catch (error) {
    logger.error('Error updating order status', { error: error.message, orderId: req.params.id });
    next(error);
  }
};

/**
 * Process order payment (normally handled by payment gateway)
 */
exports.processPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { payment_method, payment_details } = req.body;
    
    // Find the order
    const order = await orderQueries.findOrderById(id);
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    // Ensure user owns this order or is admin
    if (order.user_id !== req.user.user_id && req.user.role !== 'admin') {
      throw new ValidationError('You do not have permission to process payment for this order');
    }
    
    // Make sure order is in pending status
    if (order.status !== 'pending') {
      throw new ValidationError('This order cannot accept payments in its current status');
    }
    
    // Process payment (in a real app, you'd integrate with a payment gateway)
    // This is a simplified mock payment process
    let success = true;
    let transactionId = `tr_${Date.now()}`;
    let paymentStatus = 'completed';
    
    // Mock failure for testing
    if (payment_details.card_number === '4111111111111111') {
      success = false;
      paymentStatus = 'failed';
    }
    
    // Record payment
    const payment = await orderQueries.recordPayment({
      order_id: id,
      amount: order.total_amount,
      payment_method,
      payment_provider: 'mock_provider',
      transaction_id: transactionId,
      status: paymentStatus,
      provider_response: {
        transaction_id: transactionId,
        status: paymentStatus,
        message: success ? 'Payment successful' : 'Payment failed'
      }
    });
    
    // Update order status if payment was successful
    if (success) {
      await orderQueries.updateOrderStatus(
        id, 
        'processing', 
        'Payment received, order being processed', 
        req.user.user_id
      );
    }
    
    res.status(200).json({
      success: true,
      data: {
        payment,
        status: paymentStatus
      }
    });
  } catch (error) {
    logger.error('Error processing payment', { error: error.message, orderId: req.params.id });
    next(error);
  }
};

/**
 * Cancel an order (customer can only cancel pending orders)
 */
exports.cancelOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // Find the order
    const order = await orderQueries.findOrderById(id);
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    // Check permissions
    const isAdmin = req.user.role === 'admin';
    const isOwner = order.user_id === req.user.user_id;
    
    if (!isAdmin && !isOwner) {
      throw new ValidationError('You do not have permission to cancel this order');
    }
    
    // Check if order can be canceled
    if (!isAdmin && !['pending', 'processing'].includes(order.status)) {
      throw new ValidationError('This order cannot be cancelled in its current status');
    }
    
    // Cancel the order
    const updatedOrder = await orderQueries.updateOrderStatus(
      id,
      'cancelled',
      reason || 'Cancelled by customer',
      req.user.user_id
    );
    
    // Return items to inventory
    const orderItems = await orderQueries.getOrderItems(id);
    for (const item of orderItems) {
      await productQueries.updateProductInventory(item.product_id, item.quantity);
    }
    
    res.status(200).json({
      success: true,
      data: updatedOrder,
      message: 'Order successfully cancelled'
    });
  } catch (error) {
    logger.error('Error cancelling order', { error: error.message, orderId: req.params.id });
    next(error);
  }
};






// const { query } = require('../config/db');
// const orderQueries = require('../db/queries/orders_1');

// const createOrder = async (req, res) => {
//   try {
//     const { userId } = req.user;
//     const orderData = req.body;

//     // Use transaction
//     await query('BEGIN');
    
//     // 1. Create order
//     const orderResult = await query(
//       orderQueries.createOrderTransaction(orderData),
//       [userId]
//     );

//     // 2. Update inventory
//     for (const item of orderData.items) {
//       await query(
//         `UPDATE inventory
//          SET reserved_quantity = reserved_quantity - $1
//          WHERE product_id = $2`,
//         [item.quantity, item.productId]
//       );
//     }

//     await query('COMMIT');
    
//     res.status(201).json({
//       status: 'success',
//       data: orderResult.rows[0]
//     });
//   } catch (error) {
//     await query('ROLLBACK');
//     res.status(400).json({
//       status: 'error',
//       message: 'Order creation failed'
//     });
//   }
// };

// module.exports = {
//   createOrder,
//   // Add other order methods
// };