// server/src/db/queries/products.js
const db = require('../../config/db');
const SqlBuilder = require('../../utils/sqlBuilder');
const logger = require('../../utils/logger');
const { NotFoundError, DatabaseError, ValidationError } = require('../../utils/error');

/**
 * Product Queries
 */
const productQueries = {
  /**
   * Get product by ID with complete details
   * @param {string} productId - UUID of the product
   * @returns {Promise<Object>} Product with all related details
   */
  getProductById: async (productId) => {
    try {
      // Main product query with detailed information
      const productQuery = `
        SELECT 
          p.*,
          c.name AS category_name,
          COALESCE(i.quantity, 0) AS stock_quantity,
          COALESCE(i.reserved_quantity, 0) AS reserved_quantity,
          COALESCE(r.avg_rating, 0) AS average_rating,
          COALESCE(r.review_count, 0) AS review_count,
          s.username AS seller_username,
          s.email AS seller_email
        FROM 
          products p
        LEFT JOIN 
          categories c ON p.category_id = c.category_id
        LEFT JOIN 
          inventory i ON p.product_id = i.product_id
        LEFT JOIN (
          SELECT 
            product_id, 
            ROUND(AVG(rating), 1) AS avg_rating,
            COUNT(*) AS review_count
          FROM 
            product_reviews
          WHERE 
            status = 'approved'
          GROUP BY 
            product_id
        ) r ON p.product_id = r.product_id
        LEFT JOIN
          users s ON p.seller_id = s.user_id
        WHERE 
          p.product_id = $1
      `;

      const productResult = await db.query(productQuery, [productId]);
      
      if (productResult.rows.length === 0) {
        throw new NotFoundError(`Product with ID ${productId} not found`);
      }
      
      const product = productResult.rows[0];
      
      // Get product images
      const imagesQuery = `
        SELECT 
          image_id, url, alt_text, is_primary, display_order
        FROM 
          product_images
        WHERE 
          product_id = $1
        ORDER BY 
          is_primary DESC, display_order ASC
      `;
      
      const imagesResult = await db.query(imagesQuery, [productId]);
      product.images = imagesResult.rows;
      
      // Get product attributes
      const attributesQuery = `
        SELECT 
          attribute_id, name, value
        FROM 
          product_attributes
        WHERE 
          product_id = $1
      `;
      
      const attributesResult = await db.query(attributesQuery, [productId]);
      product.attributes = attributesResult.rows;
      
      // Get product tags
      const tagsQuery = `
        SELECT 
          t.tag_id, t.name, t.slug
        FROM 
          tags t
        JOIN 
          product_tags pt ON t.tag_id = pt.tag_id
        WHERE 
          pt.product_id = $1
      `;
      
      const tagsResult = await db.query(tagsQuery, [productId]);
      product.tags = tagsResult.rows;
      
      // Get active discounts for this product
      const discountsQuery = `
        SELECT 
          d.discount_id, d.code, d.type, d.value, 
          d.min_purchase_amount, d.max_discount_amount,
          d.starts_at, d.ends_at
        FROM 
          discounts d
        JOIN 
          discount_products dp ON d.discount_id = dp.discount_id
        WHERE 
          dp.product_id = $1
          AND d.is_active = TRUE
          AND d.starts_at <= NOW()
          AND d.ends_at > NOW()
          AND (d.usage_limit IS NULL OR d.usage_count < d.usage_limit)
      `;
      
      const discountsResult = await db.query(discountsQuery, [productId]);
      product.discounts = discountsResult.rows;
      
      return product;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      logger.error('Error fetching product details', { 
        error: error.message, 
        productId 
      });
      throw new DatabaseError('Failed to retrieve product details');
    }
  },

  /**
   * Search products with advanced filtering, sorting and pagination
   * @param {Object} filters - Search and filter parameters
   * @param {Object} options - Sorting and pagination options
   * @returns {Promise<Object>} Products matching criteria and pagination metadata
   */
  searchProducts: async (filters = {}, options = {}) => {
    try {
      const {
        query: text,
        category_id,
        price_min,
        price_max,
        brand,
        tags,
        attributes,
        in_stock,
        rating_min,
        seller_id,
        is_featured,
        created_after,
        created_before,
        sort = 'created_at DESC',
        page = 1,
        limit = 20
      } = filters;
      
      // Base selection columns
      const selectColumns = `
        p.product_id, p.name, p.description, p.price, p.compare_price,
        p.brand, p.is_featured, p.created_at,
        c.name AS category_name,
        COALESCE(i.quantity, 0) AS stock_quantity,
        COALESCE(r.avg_rating, 0) AS average_rating,
        COALESCE(r.review_count, 0) AS review_count,
        (
          SELECT pi.url 
          FROM product_images pi 
          WHERE pi.product_id = p.product_id AND pi.is_primary = TRUE 
          LIMIT 1
        ) AS primary_image
      `;
      
      // Base query with JOINs
      let baseQuery = `
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN inventory i ON p.product_id = i.product_id
        LEFT JOIN (
          SELECT 
            product_id, 
            ROUND(AVG(rating), 1) AS avg_rating,
            COUNT(*) AS review_count
          FROM 
            product_reviews
          WHERE 
            status = 'approved'
          GROUP BY 
            product_id
        ) r ON p.product_id = r.product_id
      `;
      
      // Track query parameters
      const queryParams = [];
      const whereClauses = ['p.is_active = TRUE'];
      let paramIndex = 1;
      
      // Text search on product name and description
      if (text && text.trim()) {
        whereClauses.push(`(
          p.name ILIKE $${paramIndex} 
          OR p.description ILIKE $${paramIndex} 
          OR p.sku ILIKE $${paramIndex}
        )`);
        queryParams.push(`%${text.trim()}%`);
        paramIndex++;
      }
      
      // Category filter
      if (category_id) {
        // Include child categories in search
        baseQuery += `
          LEFT JOIN (
            WITH RECURSIVE category_tree AS (
              SELECT category_id FROM categories WHERE category_id = $${paramIndex}
              UNION ALL
              SELECT c.category_id FROM categories c
              JOIN category_tree ct ON c.parent_id = ct.category_id
            )
            SELECT category_id FROM category_tree
          ) ct ON p.category_id = ct.category_id
        `;
        whereClauses.push(`ct.category_id IS NOT NULL`);
        queryParams.push(category_id);
        paramIndex++;
      }
      
      // Price range
      if (price_min !== undefined && price_min !== null) {
        whereClauses.push(`p.price >= $${paramIndex}`);
        queryParams.push(price_min);
        paramIndex++;
      }
      
      if (price_max !== undefined && price_max !== null) {
        whereClauses.push(`p.price <= $${paramIndex}`);
        queryParams.push(price_max);
        paramIndex++;
      }
      
      // Brand filter
      if (brand) {
        if (Array.isArray(brand)) {
          const placeholders = brand.map((_, idx) => `$${paramIndex + idx}`).join(', ');
          whereClauses.push(`p.brand IN (${placeholders})`);
          queryParams.push(...brand);
          paramIndex += brand.length;
        } else {
          whereClauses.push(`p.brand = $${paramIndex}`);
          queryParams.push(brand);
          paramIndex++;
        }
      }
      
      // Tags filter
      if (tags && Array.isArray(tags) && tags.length > 0) {
        baseQuery += `
          JOIN (
            SELECT pt.product_id
            FROM product_tags pt
            JOIN tags t ON pt.tag_id = t.tag_id
            WHERE t.name = ANY($${paramIndex}::varchar[])
            GROUP BY pt.product_id
            HAVING COUNT(DISTINCT t.name) = $${paramIndex + 1}
          ) matching_tags ON p.product_id = matching_tags.product_id
        `;
        queryParams.push(tags, tags.length);
        paramIndex += 2;
      }
      
      // Attributes filter
      if (attributes && typeof attributes === 'object') {
        const attrEntries = Object.entries(attributes);
        if (attrEntries.length > 0) {
          attrEntries.forEach(([key, value], idx) => {
            baseQuery += `
              JOIN product_attributes pa${idx} ON p.product_id = pa${idx}.product_id
              AND pa${idx}.name = $${paramIndex} AND pa${idx}.value = $${paramIndex + 1}
            `;
            queryParams.push(key, value);
            paramIndex += 2;
          });
        }
      }
      
      // Stock availability
      if (in_stock === true) {
        whereClauses.push(`(i.quantity > i.reserved_quantity OR p.is_physical = FALSE)`);
      }
      
      // Minimum rating
      if (rating_min !== undefined && rating_min !== null) {
        whereClauses.push(`r.avg_rating >= $${paramIndex}`);
        queryParams.push(rating_min);
        paramIndex++;
      }
      
      // Seller filter
      if (seller_id) {
        whereClauses.push(`p.seller_id = $${paramIndex}`);
        queryParams.push(seller_id);
        paramIndex++;
      }
      
      // Featured products
      if (is_featured !== undefined) {
        whereClauses.push(`p.is_featured = $${paramIndex}`);
        queryParams.push(is_featured);
        paramIndex++;
      }
      
      // Creation date range
      if (created_after) {
        whereClauses.push(`p.created_at >= $${paramIndex}`);
        queryParams.push(created_after);
        paramIndex++;
      }
      
      if (created_before) {
        whereClauses.push(`p.created_at <= $${paramIndex}`);
        queryParams.push(created_before);
        paramIndex++;
      }
      
      // Construct WHERE clause
      const whereClause = whereClauses.length > 0 
        ? `WHERE ${whereClauses.join(' AND ')}` 
        : '';
      
      // Construct ORDER BY clause
      let orderClause;
      const validSortFields = [
        'name', 'price', 'created_at', 'average_rating',
        'stock_quantity', 'review_count'
      ];
      
      if (typeof sort === 'string') {
        const [field, direction] = sort.split(' ');
        const validField = validSortFields.includes(field) ? field : 'created_at';
        const validDirection = ['ASC', 'DESC'].includes(direction?.toUpperCase()) 
          ? direction.toUpperCase() 
          : 'DESC';
          
        // Handle special fields that require NULLS LAST
        if (['average_rating', 'review_count'].includes(validField)) {
          orderClause = `ORDER BY ${validField} ${validDirection} NULLS LAST`;
        } else {
          orderClause = `ORDER BY ${validField} ${validDirection}`;
        }
      } else {
        orderClause = `ORDER BY created_at DESC`;
      }
      
      // Pagination
      const offset = (parseInt(page) - 1) * parseInt(limit);
      const paginationClause = `LIMIT ${parseInt(limit)} OFFSET ${offset}`;
      
      // Construct final queries
      const countQuery = `
        SELECT COUNT(DISTINCT p.product_id) AS total
        ${baseQuery}
        ${whereClause}
      `;
      
      const searchQuery = `
        SELECT ${selectColumns}
        ${baseQuery}
        ${whereClause}
        GROUP BY p.product_id, c.name, i.quantity, r.avg_rating, r.review_count
        ${orderClause}
        ${paginationClause}
      `;
      
      // Execute queries in parallel
      const [countResult, productsResult] = await Promise.all([
        db.query(countQuery, queryParams),
        db.query(searchQuery, queryParams)
      ]);
      
      const total = parseInt(countResult.rows[0].total || '0');
      const totalPages = Math.ceil(total / limit);
      
      return {
        products: productsResult.rows,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages
        }
      };
    } catch (error) {
      logger.error('Error searching products', { error: error.message });
      throw new DatabaseError('Failed to search products', error.message);
    }
  },

  /**
   * Create a new product with inventory and attributes
   * @param {Object} productData - Product information
   * @param {Object} client - DB client
   * @returns {Promise<Object>} Created product
   */
  createProduct: async (productData, client) => {    
    try {
      const {
        name,
        description,
        sku,
        price,
        compare_price,
        cost_price,
        category_id,
        seller_id,
        brand,
        weight,
        dimensions,
        is_physical,
        is_active,
        is_featured,
        attributes,
        tags,
        inventory,
        images
      } = productData;
      
      // Insert product
      const insertProductQuery = `
        INSERT INTO products (
          name, description, sku, price, compare_price, cost_price,
          category_id, seller_id, brand, weight, dimensions,
          is_physical, is_active, is_featured
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        )
        RETURNING *
      `;
      
      const productValues = [
        name,
        description,
        sku,
        price,
        compare_price || null,
        cost_price || null,
        category_id,
        seller_id,
        brand || null,
        weight || null,
        dimensions ? JSON.stringify(dimensions) : null,
        is_physical !== undefined ? is_physical : true,
        is_active !== undefined ? is_active : true,
        is_featured !== undefined ? is_featured : false
      ];
      
      const productResult = await client.query(insertProductQuery, productValues);
      const product = productResult.rows[0];
      
      // Create inventory record
      if (inventory) {
        const { quantity, warehouse_location, low_stock_threshold } = inventory;
        
        const insertInventoryQuery = `
          INSERT INTO inventory (
            product_id, quantity, warehouse_location, low_stock_threshold
          )
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `;
        
        const inventoryValues = [
          product.product_id,
          quantity || 0,
          warehouse_location || null,
          low_stock_threshold || 5
        ];
        
        const inventoryResult = await client.query(insertInventoryQuery, inventoryValues);
        product.inventory = inventoryResult.rows[0];
      }
      
      // Create product attributes
      if (attributes && attributes.length > 0) {
        const attributeValues = attributes.map(attr => [
          product.product_id, 
          attr.name, 
          attr.value
        ]);
        
        const attributePlaceholders = attributeValues.map((_, idx) => 
          `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3})`
        ).join(', ');
        
        const insertAttributesQuery = `
          INSERT INTO product_attributes (product_id, name, value)
          VALUES ${attributePlaceholders}
          RETURNING *
        `;
        
        const flatAttributeValues = attributeValues.flat();
        const attributesResult = await client.query(insertAttributesQuery, flatAttributeValues);
        product.attributes = attributesResult.rows;
      }
      
      // Handle product tags
      if (tags && tags.length > 0) {
        // First get or create tags
        const tagIds = [];
        
        for (const tagName of tags) {
          // Try to find existing tag
          const findTagQuery = `
            SELECT tag_id FROM tags WHERE name = $1
          `;
          const tagResult = await client.query(findTagQuery, [tagName]);
          
          let tagId;
          if (tagResult.rows.length > 0) {
            tagId = tagResult.rows[0].tag_id;
          } else {
            // Create new tag
            const slug = tagName.toLowerCase().replace(/\s+/g, '-');
            const insertTagQuery = `
              INSERT INTO tags (name, slug)
              VALUES ($1, $2)
              RETURNING tag_id
            `;
            const newTagResult = await client.query(insertTagQuery, [tagName, slug]);
            tagId = newTagResult.rows[0].tag_id;
          }
          
          tagIds.push(tagId);
        }
        
        // Associate tags with product
        if (tagIds.length > 0) {
          const tagValues = tagIds.map(tagId => [product.product_id, tagId]);
          const tagPlaceholders = tagValues.map((_, idx) => 
            `($${idx * 2 + 1}, $${idx * 2 + 2})`
          ).join(', ');
          
          const insertProductTagsQuery = `
            INSERT INTO product_tags (product_id, tag_id)
            VALUES ${tagPlaceholders}
          `;
          
          const flatTagValues = tagValues.flat();
          await client.query(insertProductTagsQuery, flatTagValues);
          
          // Fetch the complete tag information
          const getProductTagsQuery = `
            SELECT t.tag_id, t.name, t.slug
            FROM tags t
            JOIN product_tags pt ON t.tag_id = pt.tag_id
            WHERE pt.product_id = $1
          `;
          const productTagsResult = await client.query(getProductTagsQuery, [product.product_id]);
          product.tags = productTagsResult.rows;
        }
      }
      
      // Handle product images
      if (images && images.length > 0) {
        const imageValues = images.map((img, idx) => [
          product.product_id,
          img.url,
          img.alt_text || null,
          img.is_primary === true,
          img.display_order || idx
        ]);
        
        const imagePlaceholders = imageValues.map((_, idx) => 
          `($${idx * 5 + 1}, $${idx * 5 + 2}, $${idx * 5 + 3}, $${idx * 5 + 4}, $${idx * 5 + 5})`
        ).join(', ');
        
        const insertImagesQuery = `
          INSERT INTO product_images (product_id, url, alt_text, is_primary, display_order)
          VALUES ${imagePlaceholders}
          RETURNING *
        `;
        
        const flatImageValues = imageValues.flat();
        const imagesResult = await client.query(insertImagesQuery, flatImageValues);
        product.images = imagesResult.rows;
      }
 
      return product;
    } catch (error) {
      logger.error('Error creating product', { error: error.message });
      throw new DatabaseError('Failed to create product', error.message);
    }
  },
  
  /**
   * Get related products based on shared categories, tags, and attributes
   * @param {string} productId - Product ID
   * @param {number} limit - Number of related products to return
   * @returns {Promise<Array>} Related products
   */
  getRelatedProducts: async (productId, limit = 6) => {
    try {
      const query = `
        WITH product_info AS (
          SELECT 
            category_id,
            (
              SELECT ARRAY_AGG(tag_id) 
              FROM product_tags 
              WHERE product_id = $1
            ) AS tag_ids,
            (
              SELECT ARRAY_AGG(name) 
              FROM product_attributes 
              WHERE product_id = $1
            ) AS attribute_names
        FROM 
          products
        WHERE 
          product_id = $1
        ),
        related_score AS (
          SELECT 
            p.product_id,
            p.name,
            p.price,
            p.brand,
            (
              SELECT url 
              FROM product_images 
              WHERE product_id = p.product_id AND is_primary = TRUE 
              LIMIT 1
            ) AS primary_image,
            CASE WHEN p.category_id = (SELECT category_id FROM product_info) THEN 3 ELSE 0 END +
            (
              SELECT COUNT(*) 
              FROM product_tags pt 
              WHERE pt.product_id = p.product_id 
                AND pt.tag_id = ANY((SELECT tag_ids FROM product_info))
            ) * 2 +
            (
              SELECT COUNT(*) 
              FROM product_attributes pa 
              WHERE pa.product_id = p.product_id 
                AND pa.name = ANY((SELECT attribute_names FROM product_info))
            ) AS relevance_score
          FROM 
            products p
          WHERE 
            p.product_id != $1
            AND p.is_active = TRUE
        )
        SELECT * FROM related_score
        WHERE relevance_score > 0
        ORDER BY relevance_score DESC, name
        LIMIT $2
      `;
      
      const result = await db.query(query, [productId, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching related products', { error: error.message, productId });
      throw new DatabaseError('Failed to fetch related products');
    }
  },
  
  /**
   * Get trending products based on views, orders, and ratings
   * @param {Object} options - Filter options and limits
   * @returns {Promise<Array>} Trending products
   */
  getTrendingProducts: async ({ timeframe = '7 days', categoryId = null, limit = 10 }) => {
    try {
      const params = [timeframe];
      let categoryFilter = '';
      
      if (categoryId) {
        categoryFilter = 'AND p.category_id = $2';
        params.push(categoryId);
      }
      
      params.push(limit);
      
      const query = `
        WITH recent_orders AS (
          SELECT 
            oi.product_id,
            COUNT(*) AS order_count,
            SUM(oi.quantity) AS total_quantity_ordered
          FROM 
            order_items oi
          JOIN 
            orders o ON oi.order_id = o.order_id
          WHERE 
            o.created_at >= NOW() - $1::INTERVAL
            AND o.status NOT IN ('cancelled', 'refunded', 'failed')
          GROUP BY 
            oi.product_id
        ),
        recent_reviews AS (
          SELECT 
            product_id,
            COUNT(*) AS review_count,
            AVG(rating) AS avg_recent_rating
          FROM 
            product_reviews
          WHERE 
            created_at >= NOW() - $1::INTERVAL
            AND status = 'approved'
          GROUP BY 
            product_id
        ),
        trending_score AS (
          SELECT 
            p.product_id,
            p.name,
            p.price,
            p.brand,
            c.name AS category_name,
            (
              SELECT url 
              FROM product_images 
              WHERE product_id = p.product_id AND is_primary = TRUE 
              LIMIT 1
            ) AS primary_image,
            COALESCE(ro.order_count, 0) * 10 +
            COALESCE(ro.total_quantity_ordered, 0) * 2 +
            COALESCE(rr.review_count, 0) * 5 +
            COALESCE(rr.avg_recent_rating, 0) * 3 AS trend_score
          FROM 
            products p
          LEFT JOIN 
            recent_orders ro ON p.product_id = ro.product_id
          LEFT JOIN 
            recent_reviews rr ON p.product_id = rr.product_id
          LEFT JOIN
            categories c ON p.category_id = c.category_id
          WHERE 
            p.is_active = TRUE
            ${categoryFilter}
        )
        SELECT * FROM trending_score
        WHERE trend_score > 0
        ORDER BY trend_score DESC, name
        LIMIT $${params.length}
      `;
      
      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching trending products', { error: error.message });
      throw new DatabaseError('Failed to fetch trending products');
    }
  },
  
  /**
   * Get low stock products for inventory management
   * @returns {Promise<Array>} Low stock products
   */
  getLowStockProducts: async () => {
    try {
      const query = `
        SELECT 
          p.product_id,
          p.name,
          p.sku,
          p.price,
          p.brand,
          i.quantity,
          i.reserved_quantity,
          i.low_stock_threshold,
          (i.quantity - i.reserved_quantity) AS available_quantity,
          c.name AS category_name,
          (
            SELECT COUNT(*) 
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.order_id
            WHERE oi.product_id = p.product_id
            AND o.created_at >= NOW() - INTERVAL '30 days'
          ) AS monthly_sales,
          CASE
            WHEN i.quantity <= 0 THEN 'out_of_stock'
            WHEN i.quantity <= i.low_stock_threshold THEN 'low_stock'
            ELSE 'normal'
          END AS stock_status
        FROM 
          products p
        JOIN 
          inventory i ON p.product_id = i.product_id
        LEFT JOIN
          categories c ON p.category_id = c.category_id
        WHERE 
          p.is_active = TRUE
          AND p.is_physical = TRUE
          AND i.quantity <= i.low_stock_threshold
        ORDER BY 
          (i.quantity - i.reserved_quantity) ASC,
          monthly_sales DESC
      `;
      
      const result = await db.query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching low stock products', { error: error.message });
      throw new DatabaseError('Failed to fetch low stock products');
    }
  },
  
  /**
   * Get products with best profit margins
   * @returns {Promise<Array>} Products with profit margin data
   */
  getProductProfitMargins: async ({ minMargin = 0, limit = 20 }) => {
    try {
      const query = `
        SELECT 
          p.product_id,
          p.name,
          p.sku,
          p.price,
          p.cost_price,
          p.brand,
          c.name AS category_name,
          (p.price - COALESCE(p.cost_price, 0)) AS profit_amount,
          CASE 
            WHEN COALESCE(p.cost_price, 0) > 0 
            THEN ROUND(((p.price - p.cost_price) / p.cost_price * 100)::numeric, 2)
            ELSE 100
          END AS profit_margin_percentage,
          (
            SELECT COUNT(*) 
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.order_id
            WHERE oi.product_id = p.product_id
            AND o.created_at >= NOW() - INTERVAL '30 days'
          ) AS monthly_sales,
          (
            SELECT SUM((oi.unit_price - COALESCE(p.cost_price, 0)) * oi.quantity)
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.order_id
            WHERE oi.product_id = p.product_id
            AND o.created_at >= NOW() - INTERVAL '30 days'
          ) AS monthly_profit
        FROM 
          products p
        LEFT JOIN
          categories c ON p.category_id = c.category_id
        WHERE 
          p.is_active = TRUE
          AND CASE 
            WHEN COALESCE(p.cost_price, 0) > 0 
            THEN ((p.price - p.cost_price) / p.cost_price * 100) >= $1
            ELSE TRUE
          END
        ORDER BY 
          profit_margin_percentage DESC,
          monthly_profit DESC NULLS LAST
        LIMIT $2
      `;
      
      const result = await db.query(query, [minMargin, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching product profit margins', { error: error.message });
      throw new DatabaseError('Failed to fetch product profit margins');
    }
  },



  inventoryManagement: () => {
    return `
      SELECT 
        p.product_id,
        p.name,
        p.sku,
        i.quantity,
        i.reserved_quantity,
        (i.quantity - i.reserved_quantity) AS available_stock,
        COALESCE(SUM(oi.quantity) OVER (
          PARTITION BY oi.product_id
          ORDER BY o.created_at
          ROWS BETWEEN 7 PRECEDING AND CURRENT ROW
        ), 0) AS weekly_sales,
        CASE 
          WHEN (i.quantity - i.reserved_quantity) <= i.low_stock_threshold 
          THEN 'Reorder Needed'
          ELSE 'In Stock' 
        END AS stock_status
      FROM products p
      JOIN inventory i ON p.product_id = i.product_id
      LEFT JOIN order_items oi ON p.product_id = oi.product_id
      LEFT JOIN orders o ON oi.order_id = o.order_id
        AND o.status IN ('processing', 'completed')
      WHERE p.is_active = TRUE
      GROUP BY p.product_id, i.inventory_id, oi.product_id, o.created_at
      ORDER BY available_stock ASC;`;
  },

  priceOptimization: () => {
    return `
      WITH price_changes AS (
        SELECT 
          product_id,
          price,
          LAG(price) OVER (PARTITION BY product_id ORDER BY updated_at) AS previous_price,
          updated_at
        FROM products
        WHERE updated_at > CURRENT_DATE - INTERVAL '6 months'
      )
      SELECT 
        pc.product_id,
        p.name,
        pc.previous_price,
        pc.price AS current_price,
        (pc.price - pc.previous_price) AS price_difference,
        pc.updated_at AS change_date,
        COALESCE(
          (SELECT SUM(quantity)
           FROM order_items
           WHERE product_id = pc.product_id
             AND created_at BETWEEN pc.updated_at - INTERVAL '7 days' 
             AND pc.updated_at
          ), 0) AS sales_before,
        COALESCE(
          (SELECT SUM(quantity)
           FROM order_items 
           WHERE product_id = pc.product_id
             AND created_at BETWEEN pc.updated_at 
             AND pc.updated_at + INTERVAL '7 days'
          ), 0) AS sales_after
      FROM price_changes pc
      JOIN products p ON pc.product_id = p.product_id
      WHERE pc.previous_price IS NOT NULL
      ORDER BY price_difference DESC;`;
  },

    /**
   * Get all products with filters and pagination
   * @param {Object} filters - Filter conditions
   * @param {Object} options - Pagination and sorting options
   * @returns {Promise<Object>} Products with pagination info
   */
  getAllProducts: async (filters = {}, options = {}) => {
    try {
      // Set default options
      const defaultOptions = {
        page: 1,
        limit: 20,
        sort: 'created_at DESC'
      };
      
      const queryOptions = { ...defaultOptions, ...options };
      
      // Build the select query
      const { query: selectQuery, params: selectParams, pagination } = 
        SqlBuilder.buildSelectQuery(
          'products',
          [
            'p.product_id',
            'p.name',
            'p.description',
            'p.price',
            'p.compare_price',
            'p.sku',
            'p.brand',
            'p.is_active',
            'p.is_featured',
            'p.created_at',
            'p.updated_at',
            'c.name AS category_name',
            'c.category_id',
            'i.quantity AS stock_quantity'
          ],
          filters,
          {
            pagination: {
              page: queryOptions.page,
              limit: queryOptions.limit
            },
            sort: queryOptions.sort
          }
        );

      // Add table aliases and joins
      const finalSelectQuery = selectQuery
        .replace('FROM products', 'FROM products p')
        .replace('WHERE', `
          LEFT JOIN categories c ON p.category_id = c.category_id
          LEFT JOIN inventory i ON p.product_id = i.product_id
          WHERE`);

      // Get products
      const productsResult = await db.query(finalSelectQuery, selectParams);
      
      // Get total count for pagination
      const { query: countQuery, params: countParams } = SqlBuilder.buildCountQuery('products', filters);
      const countResult = await db.query(countQuery, countParams);
      
      const total = parseInt(countResult.rows[0].total, 10);
      const totalPages = Math.ceil(total / queryOptions.limit);
      
      // Get primary images for each product
      if (productsResult.rows.length > 0) {
        const productIds = productsResult.rows.map(p => p.product_id);
        const { inClause, params: imageParams } = SqlBuilder.generateInClause(productIds);
        
        const imagesQuery = `
          SELECT product_id, url 
          FROM product_images 
          WHERE product_id IN ${inClause} AND is_primary = TRUE
        `;
        
        const imagesResult = await db.query(imagesQuery, imageParams);
        
        // Map images to products
        const imageMap = imagesResult.rows.reduce((acc, img) => {
          acc[img.product_id] = img.url;
          return acc;
        }, {});
        
        // Add image URLs to products
        productsResult.rows.forEach(product => {
          product.primary_image = imageMap[product.product_id] || null;
        });
      }
      
      return {
        products: productsResult.rows,
        pagination: {
          total,
          totalPages,
          currentPage: queryOptions.page,
          limit: queryOptions.limit
        }
      };
    } catch (error) {
      logger.error('Error getting all products', { error: error.message });
      throw new DatabaseError('Failed to retrieve products');
    }
  },

  /**
   * Get a product by ID with all related data
   * @param {string} productId - Product UUID
   * @returns {Promise<Object>} Product with related data
   */
  getProductById2: async (productId) => {
    try {
      // Get basic product info
      const productQuery = `
        SELECT 
          p.*,
          c.name AS category_name,
          c.category_id,
          i.quantity AS stock_quantity,
          i.reserved_quantity,
          COALESCE(AVG(pr.rating), 0) AS average_rating,
          COUNT(pr.review_id) AS review_count
        FROM 
          products p
        LEFT JOIN 
          categories c ON p.category_id = c.category_id
        LEFT JOIN 
          inventory i ON p.product_id = i.product_id
        LEFT JOIN 
          product_reviews pr ON p.product_id = pr.product_id AND pr.status = 'approved'
        WHERE 
          p.product_id = $1
        GROUP BY 
          p.product_id, c.name, c.category_id, i.quantity, i.reserved_quantity
      `;
      
      const productResult = await db.query(productQuery, [productId]);
      
      if (productResult.rows.length === 0) {
        throw new NotFoundError(`Product with ID ${productId} not found`);
      }
      
      const product = productResult.rows[0];
      
      // Get product images
      const imagesQuery = `
        SELECT image_id, url, alt_text, is_primary, display_order
        FROM product_images
        WHERE product_id = $1
        ORDER BY is_primary DESC, display_order ASC
      `;
      
      const imagesResult = await db.query(imagesQuery, [productId]);
      product.images = imagesResult.rows;
      
      // Get product attributes
      const attributesQuery = `
        SELECT attribute_id, name, value
        FROM product_attributes
        WHERE product_id = $1
      `;
      
      const attributesResult = await db.query(attributesQuery, [productId]);
      product.attributes = attributesResult.rows;
      
      // Get related products from same category
      const relatedQuery = `
        SELECT 
          p.product_id, 
          p.name, 
          p.price,
          (SELECT url FROM product_images WHERE product_id = p.product_id AND is_primary = TRUE LIMIT 1) AS primary_image
        FROM 
          products p
        WHERE 
          p.category_id = $1
          AND p.product_id != $2
          AND p.is_active = TRUE
        LIMIT 5
      `;
      
      const relatedResult = await db.query(relatedQuery, [product.category_id, productId]);
      product.related_products = relatedResult.rows;
      
      return product;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      logger.error('Error getting product by ID', { error: error.message, productId });
      throw new DatabaseError(`Failed to retrieve product with ID ${productId}`);
    }
  },

  /**
   * Create a new product
   * @param {Object} productData - Product data
   * @returns {Promise<Object>} Created product
   */
  createProduct2: async (productData) => {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Create product
      const { query, values } = SqlBuilder.buildInsertQuery('products', productData);
      const result = await client.query(query, values);
      const product = result.rows[0];
      
      // Create initial inventory record if this is a physical product
      if (productData.is_physical) {
        const inventoryData = {
          product_id: product.product_id,
          quantity: productData.initial_quantity || 0,
          reserved_quantity: 0,
          low_stock_threshold: productData.low_stock_threshold || 5
        };
        
        const { query: invQuery, values: invValues } = SqlBuilder.buildInsertQuery('inventory', inventoryData);
        await client.query(invQuery, invValues);
      }
      
      await client.query('COMMIT');
      return product;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error creating product', { error: error.message });
      throw new DatabaseError('Failed to create product: ' + error.message);
    } finally {
      client.release();
    }
  },

  /**
   * Update a product
   * @param {string} productId - Product UUID
   * @param {Object} productData - Updated product data
   * @returns {Promise<Object>} Updated product
   */
  updateProduct: async (productId, productData) => {
    const client =  await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Update the product
      const { query, values } = SqlBuilder.buildUpdateQuery(
        'products',
        { ...productData, updated_at: 'NOW()' },
        { product_id: productId }
      );
      
      const result = await client.query(query, values);
      
      if (result.rows.length === 0) {
        throw new NotFoundError(`Product with ID ${productId} not found`);
      }
      
      // Update inventory if quantity is provided
      if (productData.hasOwnProperty('quantity')) {
        const updateInventoryQuery = `
          INSERT INTO inventory (product_id, quantity, low_stock_threshold)
          VALUES ($1, $2, $3)
          ON CONFLICT (product_id) 
          DO UPDATE SET 
            quantity = $2, 
            low_stock_threshold = $3,
            updated_at = NOW()
        `;
        
        await client.query(
          updateInventoryQuery, 
          [productId, productData.quantity, productData.low_stock_threshold || 5]
        );
      }
      
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      
      if (error instanceof NotFoundError) {
        throw error;
      }
      
      logger.error('Error updating product', { error: error.message, productId });
      throw new DatabaseError(`Failed to update product with ID ${productId}`);
    } finally {
      client.release();
    }
  },

  /**
   * Delete a product
   * @param {string} productId - Product UUID
   * @returns {Promise<boolean>} Success indicator
   */
  deleteProduct: async (productId) => {
    try {
      const query = `
        DELETE FROM products
        WHERE product_id = $1
        RETURNING product_id
      `;
      
      const result = await db.query(query, [productId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError(`Product with ID ${productId} not found`);
      }
      
      return true;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      
      logger.error('Error deleting product', { error: error.message, productId });
      throw new DatabaseError(`Failed to delete product with ID ${productId}`);
    }
  },



  /**
   * Get products that are low in stock
   * @returns {Promise<Array>} Low stock products
   */
  getLowStockProducts2: async () => {
    try {
      const query = `
        SELECT 
          p.product_id,
          p.name,
          p.sku,
          i.quantity,
          i.low_stock_threshold,
          i.reserved_quantity,
          (SELECT url FROM product_images WHERE product_id = p.product_id AND is_primary = TRUE LIMIT 1) AS primary_image
        FROM 
          products p
        JOIN 
          inventory i ON p.product_id = i.product_id
        WHERE 
          i.quantity <= i.low_stock_threshold
          AND p.is_active = TRUE
        ORDER BY 
          (i.quantity / NULLIF(i.low_stock_threshold, 0)) ASC
      `;
      
      const result = await db.query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error getting low stock products', { error: error.message });
      throw new DatabaseError('Failed to retrieve low stock products');
    }
  },

  /**
   * Get trending products based on views, orders, and ratings
   * @param {Object} options - Filter options and limits
   * @returns {Promise<Array>} Trending products
   */
  getTrendingProducts2: async ({ timeframe = '7 days', categoryId = null, limit = 10 }) => {
    try {
      const params = [timeframe];
      let categoryFilter = '';
      
      if (categoryId) {
        categoryFilter = 'AND p.category_id = $2';
        params.push(categoryId);
      }
      
      params.push(limit);
      
      const query = `
        WITH recent_orders AS (
          SELECT 
            oi.product_id,
            COUNT(*) AS order_count,
            SUM(oi.quantity) AS total_quantity_ordered
          FROM 
            order_items oi
          JOIN 
            orders o ON oi.order_id = o.order_id
          WHERE 
            o.created_at >= NOW() - $1::INTERVAL
            AND o.status NOT IN ('cancelled', 'refunded', 'failed')
          GROUP BY 
            oi.product_id
        ),
        recent_reviews AS (
          SELECT 
            product_id,
            COUNT(*) AS review_count,
            AVG(rating) AS avg_recent_rating
          FROM 
            product_reviews
          WHERE 
            created_at >= NOW() - $1::INTERVAL
            AND status = 'approved'
          GROUP BY 
            product_id
        ),
        trending_score AS (
          SELECT 
            p.product_id,
            p.name,
            p.price,
            p.brand,
            c.name AS category_name,
            (
              SELECT url 
              FROM product_images 
              WHERE product_id = p.product_id AND is_primary = TRUE 
              LIMIT 1
            ) AS primary_image,
            COALESCE(ro.order_count, 0) * 10 +
            COALESCE(ro.total_quantity_ordered, 0) * 2 +
            COALESCE(rr.review_count, 0) * 5 +
            COALESCE(rr.avg_recent_rating, 0) * 3 AS trend_score
          FROM 
            products p
          LEFT JOIN 
            recent_orders ro ON p.product_id = ro.product_id
          LEFT JOIN 
            recent_reviews rr ON p.product_id = rr.product_id
          LEFT JOIN
            categories c ON p.category_id = c.category_id
          WHERE 
            p.is_active = TRUE
            ${categoryFilter}
        )
        SELECT * FROM trending_score
        WHERE trend_score > 0
        ORDER BY trend_score DESC, name
        LIMIT $${params.length}
      `;
      
      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching trending products', { error: error.message });
      throw new DatabaseError('Failed to fetch trending products');
    }
  },

  /**
   * Get featured products
   * @param {number} limit - Maximum number of products to return
   * @returns {Promise<Array>} Featured products
   */
  getFeaturedProducts: async (limit = 8) => {
    try {
      const query = `
        SELECT 
          p.product_id,
          p.name,
          p.description,
          p.price,
          p.compare_price,
          c.name AS category_name,
          (
            SELECT url 
            FROM product_images 
            WHERE product_id = p.product_id AND is_primary = TRUE 
            LIMIT 1
          ) AS primary_image
        FROM 
          products p
        LEFT JOIN 
          categories c ON p.category_id = c.category_id
        WHERE 
          p.is_featured = TRUE
          AND p.is_active = TRUE
        ORDER BY 
          p.updated_at DESC
        LIMIT $1
      `;
      
      const result = await db.query(query, [limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching featured products', { error: error.message });
      throw new DatabaseError('Failed to fetch featured products');
    }
  },

  /**
   * Add product images
   * @param {string} productId - Product UUID
   * @param {Array} images - Array of image objects
   * @returns {Promise<Array>} Created images
   */
  addProductImages: async (productId, images) => {
    const client =  await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Check if product exists
      const productCheck = await client.query('SELECT product_id FROM products WHERE product_id = $1', [productId]);
      
      if (productCheck.rows.length === 0) {
        throw new NotFoundError(`Product with ID ${productId} not found`);
      }
      
      const createdImages = [];
      
      // If there's a primary image, update existing primary images
      if (images.some(img => img.is_primary)) {
        await client.query(
          'UPDATE product_images SET is_primary = FALSE WHERE product_id = $1',
          [productId]
        );
      }
      
      // Insert each image
      for (const image of images) {
        const { query, values } = SqlBuilder.buildInsertQuery('product_images', {
          product_id: productId,
          url: image.url,
          alt_text: image.alt_text || '',
          is_primary: image.is_primary || false,
          display_order: image.display_order || 0
        });
        
        const result = await client.query(query, values);
        createdImages.push(result.rows[0]);
      }
      
      await client.query('COMMIT');
      return createdImages;
    } catch (error) {
      await client.query('ROLLBACK');
      
      if (error instanceof NotFoundError) {
        throw error;
      }
      
      logger.error('Error adding product images', { error: error.message, productId });
      throw new DatabaseError(`Failed to add images to product ${productId}`);
    } finally {
      client.release();
    }
  },

    /**
   * Get images for a specific product
   * @param {string} imageId - Image ID
   * @returns {Promise<Array>} Product images
   */
  getProductImageById: async (productId) => {
    try {
      const query = `
        SELECT 
          ip.image_id,
          ip.url,
          ip.alt_text,
          ip.is_primary,
          ip.display_order,
          ip.created_at,
          p.product_id
        FROM 
          product_images  ip
        JOIN products p
        ON ip.product_id = p.product_id
        WHERE 
          image_id = $1
        ORDER BY 
          is_primary DESC,
          display_order ASC,
          created_at ASC
      `;
      
      const result = await db.query(query, [imageId]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching product images', { 
        error: error.message, 
        productId 
      });
      throw new DatabaseError('Failed to fetch product images');
    }
  },


    /**
   * Get images for a specific product
   * @param {string} productId - Product ID
   * @returns {Promise<Array>} Product images
   */
  getProductImages: async (productId) => {
    try {
      const query = `
        SELECT 
          image_id,
          url,
          alt_text,
          is_primary,
          display_order,
          created_at
        FROM 
          product_images
        WHERE 
          product_id = $1
        ORDER BY 
          is_primary DESC,
          display_order ASC,
          created_at ASC
      `;
      
      const result = await db.query(query, [productId]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching product images', { 
        error: error.message, 
        productId 
      });
      throw new DatabaseError('Failed to fetch product images');
    }
  },


  /**
   * Delete a product image
   * @param {string} imageId - Image UUID
   * @returns {Promise<boolean>} Success indicator
   */
  deleteProductImage: async (imageId) => {
    try {
      const query = `
        DELETE FROM product_images
        WHERE image_id = $1
        RETURNING image_id
      `;
      
      const result = await db.query(query, [imageId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError(`Image with ID ${imageId} not found`);
      }
      
      return true;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      
      logger.error('Error deleting product image', { error: error.message, imageId });
      throw new DatabaseError(`Failed to delete image with ID ${imageId}`);
    }
  },


    /**
   * Set primary image for a product
   * @param {UUID} productId - Product ID
   * @param {UUID} imageId - Image ID to set as primary
   * @returns {Promise<Object>} Updated image information
   */
  setPrimaryImage: async (productId, imageId) => {
    const client = await db.pool.connect();
    
    try {
      // Begin transaction
      await client.query('BEGIN');
      
      // First, check if the image exists and belongs to the product
      const checkQuery = `
        SELECT image_id FROM product_images
        WHERE image_id = $1 AND product_id = $2
      `;
      
      const checkResult = await client.query(checkQuery, [imageId, productId]);
      
      if (checkResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundError(`Image not found or doesn't belong to the product`);
      }
      
      // Remove primary flag from all images of this product
      const resetQuery = `
        UPDATE product_images
        SET is_primary = FALSE
        WHERE product_id = $1
      `;
      
      await client.query(resetQuery, [productId]);
      
      // Set the selected image as primary
      const updateQuery = `
        UPDATE product_images
        SET is_primary = TRUE
        WHERE image_id = $1
        RETURNING *
      `;
      
      const result = await client.query(updateQuery, [imageId]);
      
      // Commit transaction
      await client.query('COMMIT');
      
      return result.rows[0];
    } catch (error) {
      // Rollback transaction on error
      await client.query('ROLLBACK');
      
      if (error instanceof NotFoundError) {
        throw error;
      }
      logger.error('Error setting primary product image', { error: error.message, productId, imageId });
      throw new DatabaseError('Failed to set primary product image');
    }finally{
      client.release();
    }
  }  ,

    /**
   * Get attributes for a specific product
   * @param {string} productId - Product ID
   * @returns {Promise<Array>} Product attributes
   */
  getProductAttributes: async (productId) => {
    try {
      const query = `
        SELECT 
          attribute_id,
          name,
          value,
          created_at
        FROM 
          product_attributes
        WHERE 
          product_id = $1
        ORDER BY 
          name ASC
      `;
      
      const result = await db.query(query, [productId]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching product attributes', { 
        error: error.message, 
        productId 
      });
      throw new DatabaseError('Failed to fetch product attributes');
    }
  },

  /**
   * Get products by category ID
   * @param {UUID} categoryId - The category ID
   * @param {Object} options - Filter and pagination options
   * @returns {Promise<Object>} Products and pagination info
   */
  getProductsByCategory: async (categoryId, options = {}) => {
    try {
      const {
        page = 1,
        limit = 20,
        sort = 'created_at DESC',
        includeInactive = false,
        priceMin,
        priceMax,
        brand,
        search
      } = options;
      
      // Build filters
      const filters = { category_id: categoryId };
      if (!includeInactive) {
        filters.is_active = true;
      }
      
      // Add price range filter if provided
      const additionalWhereConditions = [];
      const additionalParams = [];
      let paramCounter = 1;
      
      if (priceMin !== undefined && priceMin !== null) {
        additionalWhereConditions.push(`price >= $${paramCounter++}`);
        additionalParams.push(parseFloat(priceMin));
      }
      
      if (priceMax !== undefined && priceMax !== null) {
        additionalWhereConditions.push(`price <= $${paramCounter++}`);
        additionalParams.push(parseFloat(priceMax));
      }
      
      if (brand) {
        additionalWhereConditions.push(`brand = $${paramCounter++}`);
        additionalParams.push(brand);
      }
      
      if (search) {
        additionalWhereConditions.push(`(name ILIKE $${paramCounter} OR description ILIKE $${paramCounter})`);
        additionalParams.push(`%${search}%`);
        paramCounter++;
      }
      
      // Build pagination
      const offset = (page - 1) * limit;
      
      // Build full query
      const { whereClause, params } = SqlBuilder.buildWhereClause(filters);
      
      const whereConditions = whereClause ? 
        whereClause + (additionalWhereConditions.length > 0 ? ` AND ${additionalWhereConditions.join(' AND ')}` : '') :
        (additionalWhereConditions.length > 0 ? `WHERE ${additionalWhereConditions.join(' AND ')}` : '');
      
      const query = `
        SELECT 
          p.product_id,
          p.name,
          p.description,
          p.price,
          p.compare_price,
          p.brand,
          p.is_featured,
          p.is_active,
          p.created_at,
          c.name AS category_name,
          (
            SELECT json_build_object(
              'image_id', pi.image_id,
              'url', pi.url,
              'is_primary', pi.is_primary
            )
            FROM product_images pi
            WHERE pi.product_id = p.product_id AND pi.is_primary = TRUE
            LIMIT 1
          ) AS primary_image,
          (
            SELECT COALESCE(AVG(pr.rating), 0)
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
              'reserved_quantity', i.reserved_quantity
            )
            FROM inventory i
            WHERE i.product_id = p.product_id
          ) AS inventory
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.category_id
        ${whereConditions}
        ORDER BY ${SqlBuilder.buildOrderByClause(sort, 'p.created_at DESC').replace('ORDER BY ', '')}
        LIMIT ${limit} OFFSET ${offset}
      `;
      
      // Count query for pagination
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM products p
        ${whereConditions}
      `;
      
      // Execute both queries
      const [productsResult, countResult] = await Promise.all([
        db.query(query, [...params, ...additionalParams]),
        db.query(countQuery, [...params, ...additionalParams])
      ]);
      
      const totalProducts = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(totalProducts / limit);
      
      return {
        products: productsResult.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalProducts,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      logger.error('Error fetching products by category', { error: error.message, categoryId });
      throw new DatabaseError('Failed to fetch products by category');
    }
  },
  
  /**
   * Get product inventory
   * @param {UUID} productId - Product ID
   * @returns {Promise<Object>} Inventory information
   */
  getProductInventory: async (productId) => {
    try {
      const query = `
        SELECT
          inventory_id,
          product_id,
          quantity,
          reserved_quantity,
          warehouse_location,
          low_stock_threshold,
          last_restock_date,
          next_restock_date,
          created_at,
          updated_at
        FROM inventory
        WHERE product_id = $1
      `;
      
      const result = await db.query(query, [productId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError(`Inventory not found for product ID: ${productId}`);
      }
      
      return result.rows[0];
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      logger.error('Error fetching product inventory', { error: error.message, productId });
      throw new DatabaseError('Failed to fetch product inventory');
    }
  },

    /**
   * Update product inventory
   * @param {string} productId - Product UUID
   * @param {number} quantity - New quantity
   * @param {number} [lowStockThreshold] - New low stock threshold
   * @returns {Promise<Object>} Updated inventory
   */
  updateInventory: async (productId, quantity, lowStockThreshold) => {
    try {
      // Check if product exists
      const productCheck = await db.query('SELECT product_id FROM products WHERE product_id = $1', [productId]);
      
      if (productCheck.rows.length === 0) {
        throw new NotFoundError(`Product with ID ${productId} not found`);
      }
      
      const query = `
        INSERT INTO inventory (product_id, quantity, low_stock_threshold)
        VALUES ($1, $2, $3)
        ON CONFLICT (product_id) 
        DO UPDATE SET 
          quantity = $2, 
          low_stock_threshold = COALESCE($3, inventory.low_stock_threshold),
          updated_at = NOW()
        RETURNING *
      `;
      
      const result = await db.query(query, [productId, quantity, lowStockThreshold]);
      return result.rows[0];
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      
      logger.error('Error updating inventory', { error: error.message, productId });
      throw new DatabaseError(`Failed to update inventory for product ${productId}`);
    }
  },

    /**
   * Get product reviews
   * @param {string} reviewId - reviewId UUID
   * @returns {Promise<boolean>} Reviews with pagination info
   */
  getReviewById: async ( reviewId) => {
    try {
      // Build reviews query
      let params = [reviewId];      
      
      const reviewsQuery = `
        SELECT *
        FROM 
          product_reviews pr
        WHERE 
          pr.review_id = $1 
      `;
      
      const reviewsResult = await db.query(reviewsQuery, params);
      return reviewsResult.rows?.length > 0;
    } catch (error) {
      logger.error('Error getting product reviews', { error: error.message, productId });
      throw new DatabaseError(`Failed to retrieve reviews for product ${productId}`);
    }
  },



    /**
   * Get product reviews
   * @param {string} userId - user UUID
   * @param {string} productId - Product UUID
   * @param {Object} options - Filter and pagination options
   * @returns {Promise<boolean>} Reviews with pagination info
   */
  getProductUserReview: async ( userId, productId, options = {}) => {
    try {

      
      // Build reviews query
      let params = [userId, productId];      
      
      const reviewsQuery = `
        SELECT 
          pr.review_id,
          pr.rating,
          pr.title,
          pr.content,
          pr.created_at,
          pr.is_verified_purchase,
          u.username,
          u.first_name,
          u.last_name
        FROM 
          product_reviews pr
        JOIN 
          users u ON pr.user_id = u.user_id
        WHERE 
          pr.user_id = $1 
          AND
          pr.product_id = $2 
      `;
      
      const reviewsResult = await db.query(reviewsQuery, params);
      return reviewsResult.rows?.length > 0;
    } catch (error) {
      logger.error('Error getting product reviews', { error: error.message, productId });
      throw new DatabaseError(`Failed to retrieve reviews for product ${productId}`);
    }
  },




    /**
   * Get product reviews
   * @param {string} productId - Product UUID
   * @param {Object} options - Filter and pagination options
   * @returns {Promise<Object>} Reviews with pagination info
   */
  getProductReviews: async (productId, options = {}) => {
    try {
      const defaultOptions = {
        page: 1,
        limit: 10,
        sort: 'created_at DESC',
        status: 'approved'
      };
      
      const queryOptions = { ...defaultOptions, ...options };
      const offset = (queryOptions.page - 1) * queryOptions.limit;
      
      // Build reviews query
      let params = [productId, queryOptions.limit, offset];
      let statusFilter = '';
      
      if (queryOptions.status) {
        statusFilter = 'AND pr.status = $4';
        params.push(queryOptions.status);
      }
      
      const reviewsQuery = `
        SELECT 
          pr.review_id,
          pr.rating,
          pr.title,
          pr.content,
          pr.created_at,
          pr.is_verified_purchase,
          u.username,
          u.first_name,
          u.last_name
        FROM 
          product_reviews pr
        JOIN 
          users u ON pr.user_id = u.user_id
        WHERE 
          pr.product_id = $1
          ${statusFilter}
        ORDER BY 
          pr.created_at DESC
        LIMIT $2 OFFSET $3
      `;
      
      const reviewsResult = await db.query(reviewsQuery, params);
      
      // Get total count for pagination
      const countParams = [productId];
      let countStatusFilter = '';
      
      if (queryOptions.status) {
        countStatusFilter = 'AND status = $2';
        countParams.push(queryOptions.status);
      }
      
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM product_reviews
        WHERE product_id = $1 ${countStatusFilter}
      `;
      
      const countResult = await db.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].total, 10);
      const totalPages = Math.ceil(total / queryOptions.limit);
      
      return {
        reviews: reviewsResult.rows,
        pagination: {
          total,
          totalPages,
          currentPage: queryOptions.page,
          limit: queryOptions.limit
        }
      };
    } catch (error) {
      logger.error('Error getting product reviews', { error: error.message, productId });
      throw new DatabaseError(`Failed to retrieve reviews for product ${productId}`);
    }
  },
  
  /**
   * Update product inventory
   * @param {UUID} productId - Product ID
   * @param {Object} data - Inventory data to update
   * @returns {Promise<Object>} Updated inventory
   */
  updateProductInventory: async (productId, data) => {
    try {
      // First check if inventory exists
      const checkQuery = `SELECT inventory_id, quantity FROM inventory WHERE product_id = $1`;
      const checkResult = await db.query(checkQuery, [productId]);
      
      if (checkResult.rows.length === 0) {
        // Create new inventory if it doesn't exist
        const createQuery = `
          INSERT INTO inventory (
            product_id,
            quantity,
            reserved_quantity,
            warehouse_location,
            low_stock_threshold
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `;
        
        const createParams = [
          productId,
          data.quantity || 0,
          data.reserved_quantity || 0,
          data.warehouse_location || null,
          data.low_stock_threshold || 5
        ];
        
        const createResult = await db.query(createQuery, createParams);
        return createResult.rows[0];
      }
      
      // Update existing inventory
      const updateColumns = [];
      const updateParams = [productId];
      let paramCounter = 2;
      
      // Dynamically build the update query based on provided fields
      if (data.quantity !== undefined) {
        updateColumns.push(`quantity = $${paramCounter++}`);
        const initialQuantity = checkResult.rows[0].quantity;
        const newQuantity = initialQuantity - data.quantity;
        updateParams.push(newQuantity);
      }
      
      if (data.reserved_quantity !== undefined) {
        updateColumns.push(`reserved_quantity = $${paramCounter++}`);
        updateParams.push(data.reserved_quantity);
      }
      
      if (data.warehouse_location !== undefined) {
        updateColumns.push(`warehouse_location = $${paramCounter++}`);
        updateParams.push(data.warehouse_location);
      }
      
      if (data.low_stock_threshold !== undefined) {
        updateColumns.push(`low_stock_threshold = $${paramCounter++}`);
        updateParams.push(data.low_stock_threshold);
      }
      
      if (data.next_restock_date !== undefined) {
        updateColumns.push(`next_restock_date = $${paramCounter++}`);
        updateParams.push(data.next_restock_date);
      }
      
      // Always update the updated_at timestamp
      updateColumns.push(`updated_at = CURRENT_TIMESTAMP`);
      
      if (updateColumns.length === 0) {
        // No fields to update
        return await productQueries.getProductInventory(productId);
      }
      
      const updateQuery = `
        UPDATE inventory
        SET ${updateColumns.join(', ')}
        WHERE product_id = $1
        RETURNING *
      `;
      
      const result = await db.query(updateQuery, updateParams);
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating product inventory', { error: error.message, productId });
      throw new DatabaseError('Failed to update product inventory');
    }
  },
  
  /**
   * Add a product review
   * @param {Object} reviewData - Review data
   * @returns {Promise<Object>} Created review
   */
  addProductReview: async (reviewData) => {
    try {
      const { product_id, user_id, rating, title, content } = reviewData;
      
      // Check if the user has already reviewed this product
      const checkQuery = `
        SELECT review_id FROM product_reviews
        WHERE product_id = $1 AND user_id = $2
      `;
      
      const checkResult = await db.query(checkQuery, [product_id, user_id]);
      
      if (checkResult.rows.length > 0) {
        throw new ValidationError('You have already reviewed this product');
      }
      
      // Check if this is a verified purchase
      const verifiedQuery = `
        SELECT COUNT(*) as purchase_count
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.order_id
        WHERE oi.product_id = $1 AND o.user_id = $2 AND o.status = 'completed'
      `;
      
      const verifiedResult = await db.query(verifiedQuery, [product_id, user_id]);
      const isVerifiedPurchase = parseInt(verifiedResult.rows[0].purchase_count) > 0;
      
      // Insert the review
      const insertQuery = `
        INSERT INTO product_reviews (
          product_id,
          user_id,
          rating,
          title,
          content,
          is_verified_purchase,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      
      // Default status is 'pending' unless auto-approval is enabled for verified purchases
      const status = isVerifiedPurchase ? 'approved' : 'pending';
      
      const insertParams = [
        product_id,
        user_id,
        rating,
        title || null,
        content || null,
        isVerifiedPurchase,
        status
      ];
      
      const result = await db.query(insertQuery, insertParams);
      return result.rows[0];
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      logger.error('Error adding product review', { error: error.message });
      throw new DatabaseError('Failed to add product review');
    }
  },
  
  /**
   * Update a product review
   * @param {UUID} reviewId - Review ID
   * @param {Object} reviewData - Review data to update
   * @param {UUID} userId - User ID (for authorization)
   * @returns {Promise<Object>} Updated review
   */
  updateProductReview: async (reviewId, reviewData, userId) => {
    try {
      // First check if the review exists and belongs to the user
      const checkQuery = `
        SELECT review_id, user_id FROM product_reviews
        WHERE review_id = $1
      `;
      
      const checkResult = await db.query(checkQuery, [reviewId]);
      
      if (checkResult.rows.length === 0) {
        throw new NotFoundError(`Review not found with ID: ${reviewId}`);
      }
      
      if (checkResult.rows[0].user_id !== userId) {
        throw new ValidationError('You can only update your own reviews');
      }
      
      const updateColumns = [];
      const updateParams = [reviewId];
      let paramCounter = 2;
      
      // Dynamically build the update query based on provided fields
      if (reviewData.rating !== undefined) {
        updateColumns.push(`rating = $${paramCounter++}`);
        updateParams.push(reviewData.rating);
      }
      
      if (reviewData.title !== undefined) {
        updateColumns.push(`title = $${paramCounter++}`);
        updateParams.push(reviewData.title);
      }
      
      if (reviewData.content !== undefined) {
        updateColumns.push(`content = $${paramCounter++}`);
        updateParams.push(reviewData.content);
      }
      
      // Reset status to pending if content was updated
      if (reviewData.rating !== undefined || reviewData.title !== undefined || reviewData.content !== undefined) {
        updateColumns.push(`status = 'pending'`);
      }
      
      // Always update the updated_at timestamp
      updateColumns.push(`updated_at = CURRENT_TIMESTAMP`);
      
      if (updateColumns.length === 0) {
        // No fields to update
        return checkResult.rows[0];
      }
      
      const updateQuery = `
        UPDATE product_reviews
        SET ${updateColumns.join(', ')}
        WHERE review_id = $1
        RETURNING *
      `;
      
      const result = await db.query(updateQuery, updateParams);
      return result.rows[0];
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }
      logger.error('Error updating product review', { error: error.message, reviewId });
      throw new DatabaseError('Failed to update product review');
    }
  },
  
  /**
   * Delete a product review
   * @param {UUID} reviewId - Review ID
   * @param {UUID} userId - User ID (for authorization)
   * @returns {Promise<Boolean>} Success status
   */
  deleteProductReview: async (reviewId, userId) => {
    try {
      // First check if the review exists and belongs to the user
      const checkQuery = `
        SELECT review_id, user_id FROM product_reviews
        WHERE review_id = $1
      `;
      
      const checkResult = await db.query(checkQuery, [reviewId]);
      
      if (checkResult.rows.length === 0) {
        throw new NotFoundError(`Review not found with ID: ${reviewId}`);
      }
      
      if (checkResult.rows[0].user_id !== userId) {
        throw new ValidationError('You can only delete your own reviews');
      }
      
      const deleteQuery = `
        DELETE FROM product_reviews
        WHERE review_id = $1
      `;
      
      await db.query(deleteQuery, [reviewId]);
      return true;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }
      logger.error('Error deleting product review', { error: error.message, reviewId });
      throw new DatabaseError('Failed to delete product review');
    }
  },


   /**
   * Check if a user has purchased a specific product
   * @param {string} userId - User ID
   * @param {string} productId - Product ID
   * @returns {Promise<boolean>} Whether the user has purchased the product
   */
  hasUserPurchasedProduct: async (userId, productId) => {
    try {
      const query = `
        SELECT EXISTS(
          SELECT 1
          FROM orders o
          JOIN order_items oi ON o.order_id = oi.order_id
          WHERE o.user_id = $1
            AND oi.product_id = $2
            AND o.status IN ('completed', 'shipped', 'delivered')
        ) AS has_purchased
      `;
      
      const result = await db.query(query, [userId, productId]);
      return result.rows[0].has_purchased;
    } catch (error) {
      logger.error('Error checking if user has purchased product', { 
        error: error.message, 
        userId, 
        productId 
      });
      throw new DatabaseError('Failed to check purchase history');
    }
  },
  



};

module.exports = productQueries;
// getProductsByCategory


