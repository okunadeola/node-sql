// db/queries/search.js
const searchQueries = {
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