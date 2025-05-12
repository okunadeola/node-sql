// server/src/db/queries/products.js
const db = require('../../config/db');
const SqlBuilder = require('../../utils/sqlBuilder');
const logger = require('../../utils/logger');
const { NotFoundError, DatabaseError } = require('../../utils/error');

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
   * @returns {Promise<Object>} Created product
   */
  createProduct: async (productData) => {
    const client = await db.beginTransaction();
    
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
      
      await db.commitTransaction(client);
      return product;
    } catch (error) {
      await db.rollbackTransaction(client);
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
  }

};

module.exports = productQueries;