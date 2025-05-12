const pool = require('../utils/db');


export default class Post {
    // Full-text search with ranking
    static async search(query) {
      const { rows } = await pool.query(`
        SELECT 
          id, title,
          ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) AS rank
        FROM posts
        WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
        ORDER BY rank DESC
      `, [query]);
      return rows;
    }

    static async createWithTags(userId, title, content, tagNames) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
      
          // 1. Insert post
          const postRes = await client.query(
            `INSERT INTO posts (user_id, title, content)
             VALUES ($1, $2, $3) RETURNING id`,
            [userId, title, content]
          );
          const postId = postRes.rows[0].id;
      
          // 2. Insert tags (handle existing ones)
          const tagIds = [];
          for (const tagName of tagNames) {
            const tagRes = await client.query(`
              INSERT INTO tags (name) 
              VALUES ($1)
              ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
              RETURNING id
            `, [tagName]);
            tagIds.push(tagRes.rows[0].id);
          }
      
          // 3. Link tags to post
          await client.query(`
            INSERT INTO post_tags (post_id, tag_id)
            SELECT $1, unnest($2::int[])
          `, [postId, tagIds]);
      
          await client.query('COMMIT');
          return postId;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }


      static async getNestedComments(postId) {
        const { rows } = await pool.query(`
          WITH RECURSIVE comment_tree AS (
            SELECT 
              id, 
              content, 
              user_id, 
              NULL::INT AS parent_id, 
              created_at,
              1 AS depth
            FROM comments
            WHERE post_id = $1 AND parent_id IS NULL
            
            UNION ALL
            
            SELECT 
              c.id, 
              c.content, 
              c.user_id, 
              c.parent_id, 
              c.created_at,
              ct.depth + 1
            FROM comments c
            INNER JOIN comment_tree ct ON c.parent_id = ct.id
          )
          SELECT * FROM comment_tree ORDER BY depth, created_at;
        `, [postId]);
        return rows;
      }

      static async getTopContributors() {
        const { rows } = await pool.query(`
          SELECT
            user_id,
            COUNT(*) AS post_count,
            RANK() OVER (ORDER BY COUNT(*) DESC) AS rank,
            LEAD(COUNT(*)) OVER (ORDER BY COUNT(*) DESC) AS next_user_count
          FROM posts
          GROUP BY user_id
          LIMIT 10
        `);
        return rows;
      }


      static async analyzeQueryPerformance() {
        const { rows } = await pool.query(`
          EXPLAIN ANALYZE 
          SELECT * FROM posts 
          WHERE published = true 
          ORDER BY created_at DESC 
          LIMIT 100;
        `);
        console.log(rows.map(r => r['QUERY PLAN']).join('\n'));
      }
  }