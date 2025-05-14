
/**
 * Search Queries
 * Handles product search functionality with advanced filtering
 */
const db = require('../../config/db');
const SqlBuilder = require('../../utils/sqlBuilder');
const logger = require('../../utils/logger');
const { DatabaseError } = require('../../utils/error');

const searchQueries = {
  /**
   * Search products with advanced filtering options
   * @param {Object} params - Search parameters
   * @param {string} params.query - Search query term
   * @param {Object} params.filters - Product filters
   * @param {Array} params.categories - Category IDs to filter by
   * @param {Array} params.tags - Tag IDs to filter by
   * @param {number} params.minPrice - Minimum price
   * @param {number} params.maxPrice - Maximum price
   * @param {Array} params.attributes - Attribute filters
   * @param {string} params.sortBy - Sort field
   * @param {string} params.sortOrder - Sort order (ASC/DESC)
   * @param {number} params.page - Page number
   * @param {number} params.limit - Results per page
   * @returns {Promise<Object>} Search results with pagination
   */
  searchProducts: async (params) => {
    try {
      const {
        query = '',
        filters = {},
        categories = [],
        tags = [],
        minPrice,
        maxPrice,
        attributes = [],
        sortBy = 'created_at',
        sortOrder = 'DESC',
        page = 1,
        limit = 20
      } = params;

      // Build base query
      let sql = `
        WITH filtered_products AS (
          SELECT DISTINCT p.product_id
          FROM products p
          LEFT JOIN product_tags pt ON p.product_id = pt.product_id
          LEFT JOIN product_attributes pa ON p.product_id = pa.product_id
          WHERE p.is_active = TRUE
      `;

      const queryParams = [];
      let paramIndex = 1;

      // Add search term filter
      if (query && query.trim() !== '') {
        sql += `
          AND (
            p.name ILIKE $${paramIndex} 
            OR p.description ILIKE $${paramIndex} 
            OR p.sku ILIKE $${paramIndex}
          )
        `;
        queryParams.push(`%${query.trim()}%`);
        paramIndex++;
      }

      // Add category filter
      if (categories && categories.length > 0) {
        sql += ` AND p.category_id IN (`;
        categories.forEach((categoryId, idx) => {
          sql += idx === 0 ? `$${paramIndex}` : `, $${paramIndex}`;
          queryParams.push(categoryId);
          paramIndex++;
        });
        sql += `)`;
      }

      // Add tag filter
      if (tags && tags.length > 0) {
        sql += ` AND EXISTS (
          SELECT 1 FROM product_tags 
          WHERE product_id = p.product_id AND tag_id IN (`;
        tags.forEach((tagId, idx) => {
          sql += idx === 0 ? `$${paramIndex}` : `, $${paramIndex}`;
          queryParams.push(tagId);
          paramIndex++;
        });
        sql += `))`;
      }

      // Add price range filter
      if (minPrice !== undefined && minPrice !== null) {
        sql += ` AND p.price >= $${paramIndex}`;
        queryParams.push(minPrice);
        paramIndex++;
      }

      if (maxPrice !== undefined && maxPrice !== null) {
        sql += ` AND p.price <= $${paramIndex}`;
        queryParams.push(maxPrice);
        paramIndex++;
      }

      // Add attribute filters
      if (attributes && attributes.length > 0) {
        attributes.forEach(attr => {
          sql += ` AND EXISTS (
            SELECT 1 FROM product_attributes 
            WHERE product_id = p.product_id AND name = $${paramIndex} AND value = $${paramIndex + 1}
          )`;
          queryParams.push(attr.name, attr.value);
          paramIndex += 2;
        });
      }

      // Close the CTE
      sql += `
        )
        SELECT 
          p.product_id,
          p.name,
          p.description,
          p.sku,
          p.price,
          p.compare_price,
          p.category_id,
          c.name AS category_name,
          p.brand,
          p.is_featured,
          p.created_at,
          (
            SELECT json_agg(json_build_object(
              'image_id', pi.image_id,
              'url', pi.url,
              'is_primary', pi.is_primary
            ))
            FROM product_images pi
            WHERE pi.product_id = p.product_id
          ) AS images,
          (
            SELECT json_agg(json_build_object(
              'name', pa.name,
              'value', pa.value
            ))
            FROM product_attributes pa
            WHERE pa.product_id = p.product_id
          ) AS attributes,
          (
            SELECT json_agg(t.name)
            FROM product_tags pt
            JOIN tags t ON pt.tag_id = t.tag_id
            WHERE pt.product_id = p.product_id
          ) AS tags,
          (
            SELECT AVG(pr.rating)
            FROM product_reviews pr
            WHERE pr.product_id = p.product_id AND pr.status = 'approved'
          ) AS avg_rating,
          (
            SELECT COUNT(*)
            FROM product_reviews pr
            WHERE pr.product_id = p.product_id AND pr.status = 'approved'
          ) AS review_count,
          (
            SELECT json_build_object(
              'quantity', i.quantity,
              'in_stock', i.quantity > 0
            )
            FROM inventory i
            WHERE i.product_id = p.product_id
          ) AS inventory
        FROM filtered_products fp
        JOIN products p ON fp.product_id = p.product_id
        LEFT JOIN categories c ON p.category_id = c.category_id
      `;

      // Add sorting
      const validSortFields = ['name', 'price', 'created_at', 'avg_rating'];
      const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
      const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      
      sql += ` ORDER BY p.${sortField} ${order}`;

      // Add pagination
      const offset = (page - 1) * limit;
      sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      queryParams.push(limit, offset);

      // Execute the query
      const result = await db.query(sql, queryParams);

      // Get total count for pagination
      const countSql = `
        SELECT COUNT(DISTINCT p.product_id) as total
        FROM products p
        LEFT JOIN product_tags pt ON p.product_id = pt.product_id
        LEFT JOIN product_attributes pa ON p.product_id = pa.product_id
        WHERE p.is_active = TRUE
      `;

      // Reuse the same WHERE conditions but without ORDER BY, LIMIT and OFFSET
      const countParams = queryParams.slice(0, -2);
      const countResult = await db.query(countSql + sql.split('ORDER BY')[0].split('WITH filtered_products AS')[1], countParams);
      
      const total = parseInt(countResult.rows[0].total, 10);
      const totalPages = Math.ceil(total / limit);

      return {
        products: result.rows,
        pagination: {
          total,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          totalPages
        }
      };
    } catch (error) {
      logger.error('Error searching products', { error: error.message, params });
      throw new DatabaseError('Failed to search products');
    }
  },

  /**
   * Get popular search terms
   * @param {number} limit - Number of terms to return
   * @returns {Promise<Array>} Popular search terms
   */
  getPopularSearchTerms: async (limit = 10) => {
    try {
      const query = `
        SELECT 
          search_term,
          count,
          last_searched_at
        FROM search_terms
        ORDER BY count DESC
        LIMIT $1
      `;
      
      const result = await db.query(query, [limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching popular search terms', { error: error.message });
      throw new DatabaseError('Failed to fetch popular search terms');
    }
  },

  /**
   * Log a search term
   * @param {string} term - Search term
   * @returns {Promise<void>}
   */
  logSearchTerm: async (term) => {
    try {
      const normalized = term.toLowerCase().trim();
      if (!normalized) return;
      
      // Upsert the search term
      const query = `
        INSERT INTO search_terms (search_term, count, last_searched_at)
        VALUES ($1, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (search_term) DO UPDATE
        SET count = search_terms.count + 1, last_searched_at = CURRENT_TIMESTAMP
      `;
      
      await db.query(query, [normalized]);
    } catch (error) {
      logger.error('Error logging search term', { error: error.message, term });
      // Don't throw error for logging - just log it and continue
    }
  },

    fullTextSearch: (searchTerm, filters) => {
    return `
      SELECT p.product_id,
        p.name,
        p.description,
        p.price,
        pi.url AS image_url,
        ts_rank_cd(
          setweight(to_tsvector('english', p.name), 'A') || 
          setweight(to_tsvector('english', p.description), 'B')
        ) AS rank
      FROM products p
      LEFT JOIN product_images pi 
        ON p.product_id = pi.product_id AND pi.is_primary = TRUE
      WHERE 
        p.is_active = TRUE AND
        (p.name ILIKE '%${searchTerm}%' OR
        p.description ILIKE '%${searchTerm}%' OR
        to_tsvector('english', p.name || ' ' || p.description) @@
          plainto_tsquery('english', '${searchTerm}'))
        ${filters.category ? `AND p.category_id = '${filters.category}'` : ''}
        ${filters.minPrice ? `AND p.price >= ${filters.minPrice}` : ''}
        ${filters.maxPrice ? `AND p.price <= ${filters.maxPrice}` : ''}
      ORDER BY rank DESC, p.created_at DESC
      LIMIT ${filters.limit || 25}
      OFFSET ${filters.offset || 0};`;
  },

  relatedProducts: (productId) => {
    return `
      WITH product_categories AS (
        SELECT category_id FROM products WHERE product_id = '${productId}'
      )
      SELECT p.*,
        COUNT(o.product_id) AS total_orders,
        AVG(r.rating) AS avg_rating
      FROM products p
      LEFT JOIN order_items o ON p.product_id = o.product_id
      LEFT JOIN product_reviews r ON p.product_id = r.product_id
      WHERE p.category_id IN (SELECT category_id FROM product_categories)
        AND p.product_id != '${productId}'
        AND p.is_active = TRUE
      GROUP BY p.product_id
      ORDER BY total_orders DESC, avg_rating DESC
      LIMIT 10;`;
  }
};

module.exports = searchQueries;