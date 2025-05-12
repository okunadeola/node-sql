const pool = require('../utils/db');

export default class User {
  // Create user
  static async create(username, email) {
    const { rows } = await pool.query(
      `INSERT INTO users (username, email) 
       VALUES ($1, $2) RETURNING *`,
      [username, email]
    );
    return rows[0];
  }

  // Get user by ID with posts (1:M relationship)
  static async findById(id) {
    const { rows } = await pool.query(`
      SELECT 
        users.*,
        json_agg(posts.*) AS posts
      FROM users
      LEFT JOIN posts ON posts.user_id = users.id
      WHERE users.id = $1
      GROUP BY users.id
    `, [id]);
    return rows[0];
  }
}