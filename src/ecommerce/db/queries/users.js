/**
 * User Queries
 * Handles all database operations related to users
 */
const db = require('../../config/db');
const SqlBuilder = require('../../utils/sqlBuilder');
const logger = require('../../utils/logger');
const { NotFoundError, DatabaseError, ConflictError } = require('../../utils/error');

const userQueries = {
  /**
   * Create a new user
   * @param {Object} userData - User details
   * @returns {Promise<Object>} Created user
   */
  createUser: async (userData) => {
    try {
      // Check if user with email or username already exists
      const existingUser = await db.query(
        'SELECT user_id FROM users WHERE email = $1 OR username = $2',
        [userData.email, userData.username]
      );
      
      if (existingUser.rows.length > 0) {
        throw new ConflictError('User with that email or username already exists');
      }
      
      const { query, values } = SqlBuilder.buildInsertQuery('users', userData);
      const result = await db.query(query, values);
      
      // Remove password from returned user object
      const user = result.rows[0];
      delete user.password_hash;
      
      return user;
    } catch (error) {
      logger.error('Error creating user', { error: error.message });
      if (error instanceof ConflictError) {
        throw error;
      }
      throw new DatabaseError('Failed to create user');
    }
  },
  
  /**
   * Get user by ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User
   */
  getUserById: async (userId) => {
    try {
      const query = `
        SELECT 
          user_id, username, email, first_name, last_name, 
          phone, address, role, account_status, 
          created_at, updated_at, last_login
        FROM users
        WHERE user_id = $1
      `;
      
      const result = await db.query(query, [userId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('User not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching user by ID', { error: error.message, userId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to fetch user');
    }
  },
  
  /**
   * Get user by email or username
   * @param {string} identifier - Email or username
   * @returns {Promise<Object>} User with password for authentication
   */
  getUserByEmailOrUsername: async (identifier) => {
    try {
      const query = `
        SELECT * FROM users
        WHERE email = $1 OR username = $1
      `;
      
      const result = await db.query(query, [identifier]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('User not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching user by email/username', { 
        error: error.message, 
        identifier: identifier.includes('@') ? 'email' : 'username' 
      });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to fetch user');
    }
  },
  
  /**
   * Update user information
   * @param {string} userId - User ID
   * @param {Object} userData - Updated user data
   * @returns {Promise<Object>} Updated user
   */
  updateUser: async (userId, userData) => {
    try {
      // Prevent updating email or username to existing ones
      if (userData.email || userData.username) {
        const checkQuery = `
          SELECT user_id FROM users 
          WHERE (email = $1 OR username = $2) AND user_id != $3
        `;
        
        const checkParams = [
          userData.email || '', 
          userData.username || '', 
          userId
        ];
        
        const existingCheck = await db.query(checkQuery, checkParams);
        if (existingCheck.rows.length > 0) {
          throw new ConflictError('Email or username already in use');
        }
      }
      
      const { query, values } = SqlBuilder.buildUpdateQuery(
        'users',
        userData,
        { user_id: userId }
      );
      
      const result = await db.query(query, values);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('User not found');
      }
      
      // Remove password from returned user object
      const user = result.rows[0];
      delete user.password_hash;
      
      return user;
    } catch (error) {
      logger.error('Error updating user', { error: error.message, userId });
      if (error instanceof NotFoundError || error instanceof ConflictError) {
        throw error;
      }
      throw new DatabaseError('Failed to update user');
    }
  },
  
  /**
   * Update user password
   * @param {string} userId - User ID
   * @param {string} hashedPassword - New hashed password
   * @returns {Promise<boolean>} Success status
   */
  updatePassword: async (userId, hashedPassword) => {
    try {
      const query = `
        UPDATE users
        SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2
        RETURNING user_id
      `;
      
      const result = await db.query(query, [hashedPassword, userId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('User not found');
      }
      
      return true;
    } catch (error) {
      logger.error('Error updating password', { error: error.message, userId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to update password');
    }
  },
  
  /**
   * Get user addresses
   * @param {string} userId - User ID
   * @returns {Promise<Array>} User addresses
   */
  getUserAddresses: async (userId) => {
    try {
      const query = `
        SELECT * FROM user_addresses
        WHERE user_id = $1
        ORDER BY is_default DESC, created_at DESC
      `;
      
      const result = await db.query(query, [userId]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching user addresses', { error: error.message, userId });
      throw new DatabaseError('Failed to fetch user addresses');
    }
  },
  
  /**
   * Update user's last login timestamp
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  updateLastLogin: async (userId) => {
    try {
      await db.query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1',
        [userId]
      );
    } catch (error) {
      logger.error('Error updating last login', { error: error.message, userId });
      // Non-critical error, we can continue without throwing
    }
  }
};

module.exports = userQueries;