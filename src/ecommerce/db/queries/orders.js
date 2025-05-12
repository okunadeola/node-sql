// db/queries/orders.js
const orderQueries = {
  createOrderTransaction: (orderData) => {
    return `
      BEGIN;
      
      -- Create order
      INSERT INTO orders (
        user_id, order_number, status, subtotal, 
        tax_amount, shipping_amount, discount_amount, 
        total_amount, shipping_address, billing_address, 
        payment_method, payment_status
      ) VALUES (
        '${orderData.userId}',
        '${orderData.orderNumber}',
        'pending',
        ${orderData.subtotal},
        ${orderData.taxAmount},
        ${orderData.shippingAmount},
        ${orderData.discountAmount},
        ${orderData.totalAmount},
        '${JSON.stringify(orderData.shippingAddress)}',
        '${JSON.stringify(orderData.billingAddress)}',
        '${orderData.paymentMethod}',
        'pending'
      ) RETURNING order_id;
      
      -- Insert order items
      ${orderData.items.map(item => `
        INSERT INTO order_items (
          order_id, product_id, name, sku, quantity,
          unit_price, subtotal, tax_amount, discount_amount, total
        ) VALUES (
          (SELECT order_id FROM orders WHERE order_number = '${orderData.orderNumber}'),
          '${item.productId}',
          '${item.name}',
          '${item.sku}',
          ${item.quantity},
          ${item.unitPrice},
          ${item.subtotal},
          ${item.taxAmount},
          ${item.discountAmount},
          ${item.total}
        );
        
        -- Update inventory
        UPDATE inventory
        SET reserved_quantity = reserved_quantity + ${item.quantity}
        WHERE product_id = '${item.productId}';
      `).join('\n')}
      
      -- Create payment record
      INSERT INTO payments (
        order_id, amount, payment_method, payment_provider,
        transaction_id, status
      ) VALUES (
        (SELECT order_id FROM orders WHERE order_number = '${orderData.orderNumber}'),
        ${orderData.totalAmount},
        '${orderData.paymentMethod}',
        '${orderData.paymentProvider}',
        '${orderData.transactionId}',
        'pending'
      );
      
      COMMIT;`;
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