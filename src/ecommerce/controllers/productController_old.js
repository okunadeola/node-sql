const { query } = require('../config/db');
const productQueries = require('../db/queries/products');
const { buildPagination } = require('../utils/sqlBuilder');

const getProducts = async (req, res) => {
  try {
    const { page = 1, limit = 25, sort = 'created_at', order = 'desc' } = req.query;
    
    const pagination = buildPagination(page, limit, sort, order);
    const result = await query(
      `SELECT p.*, pi.url as primary_image
       FROM products p
       LEFT JOIN product_images pi ON p.product_id = pi.product_id AND pi.is_primary = TRUE
       WHERE p.is_active = TRUE
       ${pagination.sql}`,
      pagination.params
    );

    res.json({
      status: 'success',
      data: result.rows,
      pagination: {
        page,
        limit,
        total: result.rowCount
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch products'
    });
  }
};

const createProduct = async (req, res) => {
  try {
    const { userId } = req.user;
    const productData = req.body;
    
    const result = await query(
      `INSERT INTO products (
        name, description, price, category_id, seller_id
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        productData.name,
        productData.description,
        productData.price,
        productData.category_id,
        userId
      ]
    );

    res.status(201).json({
      status: 'success',
      data: result.rows[0]
    });
  } catch (error) {
    res.status(400).json({
      status: 'error',
      message: 'Product creation failed'
    });
  }
};

module.exports = {
  getProducts,
  createProduct,
  // Add other product methods
};