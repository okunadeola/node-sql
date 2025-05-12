const { query } = require('../config/db');
const orderQueries = require('../db/queries/orders');

const createOrder = async (req, res) => {
  try {
    const { userId } = req.user;
    const orderData = req.body;

    // Use transaction
    await query('BEGIN');
    
    // 1. Create order
    const orderResult = await query(
      orderQueries.createOrderTransaction(orderData),
      [userId]
    );

    // 2. Update inventory
    for (const item of orderData.items) {
      await query(
        `UPDATE inventory
         SET reserved_quantity = reserved_quantity - $1
         WHERE product_id = $2`,
        [item.quantity, item.productId]
      );
    }

    await query('COMMIT');
    
    res.status(201).json({
      status: 'success',
      data: orderResult.rows[0]
    });
  } catch (error) {
    await query('ROLLBACK');
    res.status(400).json({
      status: 'error',
      message: 'Order creation failed'
    });
  }
};

module.exports = {
  createOrder,
  // Add other order methods
};