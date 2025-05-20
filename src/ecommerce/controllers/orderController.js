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
    
    const orders = await orderQueries.getOrdersByUser(userId, {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: 'created_at:desc',
      ...filters
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
    const order = await orderQueries.getOrderById(id);
    
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
    let products = [];
    const productIds = cart_items.map(item => item.product_id);

      for (let i = 0; i < productIds.length; i++) {
        const element = productIds[i];

        const val = await productQueries.getProductById(element);
        products.push(val)
        
      }
    
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
      await productQueries.updateProductInventory(item.product_id, {quantity : -item.quantity});
    }
    
    // Clear user's cart if a cart_id was provided
    
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
    const order = await orderQueries.getOrderById(id);
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    // If seller, make sure they own the products in this order
    // if (req.user.role === 'seller') {
    //   const sellerAuthorized = await orderQueries.isOrderOwnedBySeller(id, req.user.user_id);
    //   if (!sellerAuthorized) {
    //     throw new ValidationError('You do not have permission to update this order');
    //   }
    // }
    
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
    const updatedOrder = await orderQueries.updateOrderStatus(id, status, {comment, user_id: req.user.user_id});
    
    // Special handling for inventory based on status changes
    if (status === 'cancelled' || status === 'returned') {
      // Return items to inventory
      const orderItems = await orderQueries.getOrderItems(id);
      for (const item of orderItems) {
        await productQueries.updateProductInventory(item.product_id, {quantity: item.quantity});
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
    const order = await orderQueries.getOrderById(id);
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
    // const payment = await orderQueries.recordPayment({
    //   order_id: id,
    //   amount: order.total_amount,
    //   payment_method,
    //   payment_provider: 'mock_provider',
    //   transaction_id: transactionId,
    //   status: paymentStatus,
    //   provider_response: {
    //     transaction_id: transactionId,
    //     status: paymentStatus,
    //     message: success ? 'Payment successful' : 'Payment failed'
    //   }
    // });
    
    // Update order status if payment was successful
    if (success) {
      await orderQueries.updateOrderStatus(
        id, 
        {
          comment:   'Payment received, order being processed' ,
          status: 'processing',
          user_id:req.user.user_id
        }
      
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
    const order = await orderQueries.getOrderById(id);
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
            {
          comment:   reason || 'Cancelled by customer',
          status: 'cancelled',
          user_id:req.user.user_id
        },

    );
    
    // Return items to inventory
    const orderItems = await orderQueries.getOrderItems(id);
    for (const item of orderItems) {
      await productQueries.updateProductInventory(item.product_id, {quantity: item.quantity});
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

exports.getAllOrders = async (req, res, next) => {
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
    } = req.query;
    
    // Convert string values to appropriate types
    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      status,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      customerId,
      minAmount: minAmount ? parseFloat(minAmount) : undefined,
      maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
      sortBy,
      sortOrder: sortOrder.toUpperCase()
    };
    
    const result = await orderQueries.getAllOrders(options);
    
    res.status(200).json({
      success: true,
      data: result.orders,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get orders for authenticated user
 */
exports.getMyOrders = async (req, res, next) => {
  try {
    const userId = req.user.user_id;
    const {
      page = 1,
      limit = 10,
      status,
      fromDate,
      toDate,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = req.query;
    
    // Convert string values to appropriate types
    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      status,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      sortBy,
      sortOrder: sortOrder.toUpperCase()
    };
    
    const result = await orderQueries.getOrdersByUser(userId, options);
    
    res.status(200).json({
      success: true,
      data: result.orders,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific order by ID for authenticated user
 */
exports.getMyOrderById = async (req, res, next) => {
  try {
    const userId = req.user.user_id;
    const { orderId } = req.params;
    
    const order = await orderQueries.getOrdersByUser(userId);
    
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific order by ID (admin/seller)
 */
exports.getOrderById = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    
    const order = await orderQueries.getOrderById(orderId);
    
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update order status (admin/seller)
 */
exports.updateOrderStatus2 = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status, comment } = req.body;
    const userId = req.user.user_id;
    
    // Get the order
    const order = await orderQueries.getOrderById(orderId);
    
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    // Validate status transition
    const validTransitions = {
      pending: ['processing', 'on_hold', 'cancelled'],
      processing: ['on_hold', 'shipped', 'cancelled'],
      on_hold: ['processing', 'cancelled'],
      shipped: ['delivered', 'returned'],
      delivered: ['returned', 'completed'],
      returned: ['refunded'],
      // Terminal states
      completed: [],
      cancelled: ['processing'], // Allow reactivation only by admin
      refunded: []
    };
    
    if (!validTransitions[order.status].includes(status)) {
      throw new BadRequestError(`Cannot change order status from '${order.status}' to '${status}'`);
    }
    

    
    try {
      // Update order status
      await orderQueries.updateOrderStatus(orderId, status);
      
      // Handle inventory for certain status changes
      if (status === 'cancelled' && ['pending', 'processing', 'on_hold'].includes(order.status)) {
        // Release inventory on cancellation
        const orderItems = await orderQueries.getOrderItems(orderId);
        for (const item of orderItems) {
          await inventoryQueries.releaseInventory(item.product_id, item.quantity);
        }
      } else if (status === 'processing' && order.status === 'cancelled') {
        // Reserve inventory again on reactivation
        const orderItems = await orderQueries.getOrderItems(orderId);
        for (const item of orderItems) {
          await inventoryQueries.updateInventoryForOrder(item.product_id, item.quantity);
        }
      } else if (status === 'completed') {
        // Update order completion date
        await orderQueries.updateOrderCompletionDate(orderId);
      }
      
      // Add to order history
      await orderQueries.addOrderHistory(orderId, status, comment || `Order status updated to ${status}`, userId);
      
      // Commit transaction
      await orderQueries.commitTransaction();
      
      res.status(200).json({
        success: true,
        message: `Order status updated to ${status} successfully`
      });
    } catch (error) {
      // Rollback transaction on error
      await orderQueries.rollbackTransaction();
      throw error;
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Process refund for an order (admin only)
 */
exports.refundOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { amount, reason, items } = req.body;
    const userId = req.user.user_id;
    
    // Get the order
    const order = await orderQueries.getOrderById(orderId);
    
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    // Check if order can be refunded
    const refundableStatuses = ['completed', 'delivered', 'shipped', 'returned'];
    if (!refundableStatuses.includes(order.status)) {
      throw new BadRequestError('This order cannot be refunded');
    }
    
    // Check payment status
    if (order.payment_status !== 'paid') {
      throw new BadRequestError('Cannot refund an unpaid order');
    }
    
    // Validate refund amount
    if (!amount || amount <= 0 || amount > order.total_amount) {
      throw new BadRequestError('Invalid refund amount');
    }
    
    try {
      // Process refund with payment provider
      // This would connect to a payment gateway in a real application
      const refundResult = {
        success: true,
        transaction_id: `refund_${Date.now()}`
      };
      
      if (!refundResult.success) {
        throw new BadRequestError('Failed to process refund with payment provider');
      }
      
      // Update order status if it's a full refund
      const isFullRefund = Math.abs(amount - order.total_amount) < 0.01;
      const newStatus = isFullRefund ? 'refunded' : 'partially_refunded';
      
      await orderQueries.updateOrderStatus(orderId, isFullRefund ? 'refunded' : order.status);
      // await orderQueries.updatePaymentStatus(orderId, newStatus);
      
      // Record the refund transaction
      // await paymentQueries.createPaymentTransaction({
      //   order_id: orderId,
      //   amount: -amount, // Negative to indicate refund
      //   payment_method: order.payment_method,
      //   payment_provider: 'system', // Would be the actual provider in a real app
      //   transaction_id: refundResult.transaction_id,
      //   status: 'completed',
      //   provider_response: { refund: true, reason }
      // });
      
      // Handle inventory for refunded items if specific items are provided
      // if (items && items.length > 0) {
      //   for (const item of items) {
      //     // Return items to inventory if they're physical products
      //     const product = await productQueries.getProductById(item.product_id);
      //     if (product && product.is_physical) {
      //       await inventoryQueries.addInventory(item.product_id, item.quantity);
      //     }
      //   }
      // }
      
      // Add to order history
      await orderQueries.addOrderHistory(
        orderId, 
        newStatus, 
        `Order ${isFullRefund ? 'refunded' : 'partially refunded'}: ${reason || 'No reason provided'}`, 
        userId
      );
      
      // Commit transaction
      await orderQueries.commitTransaction();
      
      res.status(200).json({
        success: true,
        message: `Order ${isFullRefund ? 'refunded' : 'partially refunded'} successfully`,
        data: {
          refund_amount: amount,
          transaction_id: refundResult.transaction_id,
          new_status: newStatus
        }
      });
    } catch (error) {
      // Rollback transaction on error
      await orderQueries.rollbackTransaction();
      throw error;
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Update an order item (admin only)
 */
exports.updateOrderItem = async (req, res, next) => {
  try {
    const { orderId, itemId } = req.params;
    const { quantity, price } = req.body;
    const userId = req.user.user_id;
    
    // Get the order
    const order = await orderQueries.getOrderById(orderId);
    
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    // Check if order can be modified
    const modifiableStatuses = ['pending', 'processing', 'on_hold'];
    if (!modifiableStatuses.includes(order.status)) {
      throw new BadRequestError('This order cannot be modified');
    }
    
    // Get the order item
    const item = await orderQueries.getOrderItemById(itemId);
    
    if (!item || item.order_id !== orderId) {
      throw new NotFoundError('Order item not found');
    }
    
    // Begin transaction
    await orderQueries.beginTransaction();
    
    try {
      const originalQuantity = item.quantity;
      
      // Update item
      const updatedItem = await orderQueries.updateOrderItem(itemId, {
        quantity: quantity !== undefined ? quantity : item.quantity,
        unit_price: price !== undefined ? price : item.unit_price
      });
      
      // Recalculate item totals
      const subtotal = updatedItem.quantity * updatedItem.unit_price;
      const taxAmount = subtotal * 0.1; // Simplified tax calculation
      const total = subtotal + taxAmount;
      
      await orderQueries.updateOrderItemTotals(itemId, {
        subtotal,
        tax_amount: taxAmount,
        total
      });
      
      // Update inventory if quantity changed
      if (quantity !== undefined && quantity !== originalQuantity) {
        const quantityDiff = quantity - originalQuantity;
        
        if (quantityDiff > 0) {
          // More items requested, reserve additional inventory
          await inventoryQueries.updateInventoryForOrder(item.product_id, quantityDiff);
        } else if (quantityDiff < 0) {
          // Fewer items requested, release inventory
          await inventoryQueries.releaseInventory(item.product_id, Math.abs(quantityDiff));
        }
      }
      
      // Recalculate order totals
      await orderQueries.recalculateOrderTotals(orderId);
      
      // Add to order history
      await orderQueries.addOrderHistory(
        orderId, 
        order.status, 
        `Order item updated: ${item.name}`, 
        userId
      );
      
      // Commit transaction
      await orderQueries.commitTransaction();
      
      // Get updated order
      const updatedOrder = await orderQueries.getOrderById(orderId);
      
      res.status(200).json({
        success: true,
        message: 'Order item updated successfully',
        data: {
          item: updatedItem,
          order: updatedOrder
        }
      });
    } catch (error) {
      // Rollback transaction on error
      await orderQueries.rollbackTransaction();
      throw error;
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Get order history
 */
exports.getOrderHistory = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    
    // Check if order exists
    const order = await orderQueries.getOrderById(orderId);
    
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    // Get order history
    const history = await orderQueries.getOrderHistory(orderId);
    
    res.status(200).json({
      success: true,
      data: history
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Add order history entry (admin/seller)
 */
exports.addOrderHistoryEntry = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status, comment } = req.body;
    const userId = req.user.user_id;
    
    // Check if order exists
    const order = await orderQueries.getOrderById(orderId);
    
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    // Add history entry
    const historyEntry = await orderQueries.addOrderHistory(orderId, status || order.status, comment, userId);
    
    // If status is provided and different, update order status
    if (status && status !== order.status) {
      await orderQueries.updateOrderStatus(orderId, status);
    }
    
    res.status(201).json({
      success: true,
      data: historyEntry,
      message: 'Order history entry added successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Process payment for an order
 */
exports.processPayment = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { payment_method, payment_provider, token } = req.body;
    const userId = req.user.user_id;
    
    // Get the order
    const order = await orderQueries.getOrderById(orderId);
    
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    // Verify user owns this order (unless admin)
    if (order.user_id !== userId && req.user.role !== 'admin') {
      throw new AuthorizationError('You do not have permission to process payment for this order');
    }
    
    // Check if order can be paid
    if (order.payment_status !== 'pending') {
      throw new BadRequestError('This order has already been paid or cannot be paid');
    }
    
    // Begin transaction
    await orderQueries.beginTransaction();
    
    try {
      // Process payment with payment provider
      // This would connect to a payment gateway in a real application
      // For the example, we'll simulate a successful payment
      const paymentResult = {
        success: true,
        transaction_id: `transaction_${Date.now()}`,
        amount: order.total_amount,
        provider_response: { status: 'approved', code: '00' }
      };
      
      if (!paymentResult.success) {
        throw new BadRequestError('Payment processing failed');
      }
      
      // Update order payment status
      await orderQueries.updatePaymentStatus(orderId, 'paid');
      
      // Update order status if it was pending
      if (order.status === 'pending') {
        await orderQueries.updateOrderStatus(orderId, 'processing');
      }
      
      // Record the payment transaction
      await paymentQueries.createPaymentTransaction({
        order_id: orderId,
        amount: order.total_amount,
        payment_method,
        payment_provider,
        transaction_id: paymentResult.transaction_id,
        status: 'completed',
        provider_response: paymentResult.provider_response
      });
      
      // Add to order history
      await orderQueries.addOrderHistory(
        orderId, 
        'processing', 
        `Payment processed successfully. Transaction ID: ${paymentResult.transaction_id}`, 
        userId
      );
      
      // Commit transaction
      await orderQueries.commitTransaction();
      
      res.status(200).json({
        success: true,
        message: 'Payment processed successfully',
        data: {
          transaction_id: paymentResult.transaction_id,
          amount: order.total_amount,
          status: 'paid'
        }
      });
    } catch (error) {
      // Rollback transaction on error
      await orderQueries.rollbackTransaction();
      throw error;
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Get payment details for an order
 */
exports.getPaymentDetails = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.user_id;
    
    // Get the order
    let order;
    if (req.user.role === 'admin' || req.user.role === 'seller') {
      order = await orderQueries.getOrderById(orderId);
    } else {
      order = await orderQueries.getOrderByIdForUser(orderId, userId);
    }
    
    if (!order) {
      throw new NotFoundError('Order not found');
    }
    
    // Get payment transactions
    const payments = await paymentQueries.getPaymentsByOrderId(orderId);
    
    res.status(200).json({
      success: true,
      data: {
        order_id: order.order_id,
        order_number: order.order_number,
        total_amount: order.total_amount,
        payment_status: order.payment_status,
        payment_method: order.payment_method,
        transactions: payments
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Export orders to CSV (admin only)
 */
exports.exportOrdersCSV = async (req, res, next) => {
  try {
    const {
      fromDate,
      toDate,
      status,
      customerId
    } = req.query;
    
    // Prepare filter options
    const options = {
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      status,
      customerId,
      // Export all orders, no pagination
      exportAll: true
    };
    
    // Get orders
    const { orders } = await orderQueries.getAllOrders(options);
    
    if (!orders || orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No orders found for the specified criteria'
      });
    }
    
    // Create CSV stringifier
    const csvStringifier = createCsvStringifier({
      header: [
        { id: 'order_number', title: 'Order Number' },
        { id: 'created_at', title: 'Date' },
        { id: 'status', title: 'Status' },
        { id: 'payment_status', title: 'Payment Status' },
        { id: 'customer_name', title: 'Customer' },
        { id: 'customer_email', title: 'Email' },
        { id: 'subtotal', title: 'Subtotal' },
        { id: 'tax_amount', title: 'Tax' },
        { id: 'shipping_amount', title: 'Shipping' },
        { id: 'discount_amount', title: 'Discount' },
        { id: 'total_amount', title: 'Total' },
        { id: 'items_count', title: 'Items Count' }
      ]
    });
    
    // Format orders for CSV
    const formattedOrders = orders.map(order => ({
      order_number: order.order_number,
      created_at: new Date(order.created_at).toISOString().split('T')[0],
      status: order.status,
      payment_status: order.payment_status,
      customer_name: `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim(),
      customer_email: order.customer?.email || '',
      subtotal: order.subtotal.toFixed(2),
      tax_amount: order.tax_amount.toFixed(2),
      shipping_amount: order.shipping_amount.toFixed(2),
      discount_amount: order.discount_amount.toFixed(2),
      total_amount: order.total_amount.toFixed(2),
      items_count: order.items_count || 0
    }));
    
    // Generate CSV
    const csvHeader = csvStringifier.getHeaderString();
    const csvRows = csvStringifier.stringifyRecords(formattedOrders);
    const csvContent = csvHeader + csvRows;
    
    // Set response headers
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=orders-export-${Date.now()}.csv`);
    
    // Send CSV response
    res.status(200).send(csvContent);
  } catch (error) {
    next(error);
  }
}