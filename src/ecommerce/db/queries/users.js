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
  updatePassword_old: async (userId, hashedPassword) => {
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
  updateLastLogin_old: async (userId) => {
    try {
      await db.query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1',
        [userId]
      );
    } catch (error) {
      logger.error('Error updating last login', { error: error.message, userId });
      // Non-critical error, we can continue without throwing
    }
  },

  /**
   * Create a new user
   * @param {Object} userData - User registration data
   * @returns {Promise<Object>} Created user record
   */
  createUser2: async (userData) => {
    try {
      // Check if user already exists
      const existingUser = await db.query(
        'SELECT user_id FROM users WHERE email = $1 OR username = $2 LIMIT 1',
        [userData.email, userData.username]
      );

      if (existingUser.rows.length > 0) {
        throw new ConflictError('User with this email or username already exists');
      }

      // Insert new user
      const { query, values } = SqlBuilder.buildInsertQuery('users', {
        username: userData.username,
        email: userData.email,
        password_hash: userData.password_hash,
        first_name: userData.first_name,
        last_name: userData.last_name,
        phone: userData.phone,
        address: userData.address ? JSON.stringify(userData.address) : null,
        role: userData.role || 'customer',
        account_status: userData.account_status || 'active'
      });

      const result = await db.query(query, values);
      return result.rows[0];
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
   * @returns {Promise<Object>} User record
   */
  getUserById2: async (userId) => {
    try {
      const query = `
        SELECT user_id, username, email, first_name, last_name, 
               phone, address, role, account_status, created_at, 
               updated_at, last_login 
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
   * Get user by email
   * @param {string} email - User email
   * @returns {Promise<Object>} User record including password hash
   */
  getUserByEmail: async (email) => {
    try {
      const query = `
        SELECT * FROM users WHERE email = $1
      `;
      
      const result = await db.query(query, [email]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('User not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching user by email', { error: error.message });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to fetch user');
    }
  },

  /**
   * Get user by username
   * @param {string} username - Username
   * @returns {Promise<Object>} User record including password hash
   */
  getUserByUsername: async (username) => {
    try {
      const query = `
        SELECT * FROM users WHERE username = $1
      `;
      
      const result = await db.query(query, [username]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('User not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching user by username', { error: error.message });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to fetch user');
    }
  },

  /**
   * Update user profile
   * @param {string} userId - User ID
   * @param {Object} userData - User data to update
   * @returns {Promise<Object>} Updated user record
   */
  updateUserProfile: async (userId, userData) => {
    try {
      // Check if user exists
      // await userQueries.getUserById(userId);
      
      // Prepare data for update
      const updateData = {};
      const allowedFields = [
        'first_name', 'last_name', 'phone', 'address', 'updated_at, username'
      ];


      console.log(userId, userData)
      
      allowedFields.forEach(field => {
        if (userData[field] !== undefined) {
          if (field === 'address' && userData[field]) {
            updateData[field] = JSON.stringify(userData[field]);
          } else if (field === 'updated_at') {
            updateData[field] = new Date();
          } else {
            updateData[field] = userData[field];
          }
        }
      });
      
      // Always update the timestamp
      if (!updateData.updated_at) {
        updateData.updated_at = new Date();
      }
      console.log(updateData)
      // Update user
      const { query, values } = SqlBuilder.buildUpdateQuery(
        'users',
        updateData,
        { user_id: userId }
      );
      
      const result = await db.query(query, values);
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating user profile', { error: error.message, userId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to update user profile');
    }
  },

  /**
   * Change user password
   * @param {string} userId - User ID
   * @param {string} passwordHash - New password hash
   * @returns {Promise<Object>} Updated user record
   */
  changePassword: async (userId, passwordHash) => {
    try {
      const query = `
        UPDATE users
        SET password_hash = $1, updated_at = NOW()
        WHERE user_id = $2
        RETURNING user_id, email, username, updated_at
      `;
      
      const result = await db.query(query, [passwordHash, userId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('User not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error changing password', { error: error.message, userId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to change password');
    }
  },

  /**
   * Update user's last login timestamp
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Updated user record
   */
  updateLastLogin: async (userId) => {
    try {
      const query = `
        UPDATE users
        SET last_login = NOW()
        WHERE user_id = $1
        RETURNING user_id, last_login
      `;
      
      const result = await db.query(query, [userId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('User not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating last login', { error: error.message, userId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to update last login');
    }
  },

  /**
   * Get all users with pagination and filtering
   * @param {Object} options - Filter and pagination options
   * @returns {Promise<Object>} Paginated user records
   */
  getAllUsers: async (options = {}) => {
    try {
      const {
        page = 1,
        limit = 20,
        role,
        status,
        search,
        sort = 'created_at DESC'
      } = options;
      
      const filters = {};
      const params = [];
      let paramIndex = 1;
      let whereClause = '';
      
      // Build filters
      if (role) {
        filters.role = role;
      }
      
      if (status) {
        filters.account_status = status;
      }
      
      // Build WHERE clause
      if (Object.keys(filters).length > 0) {
        const whereConditions = [];
        
        for (const [key, value] of Object.entries(filters)) {
          whereConditions.push(`${key} = $${paramIndex++}`);
          params.push(value);
        }
        
        whereClause = `WHERE ${whereConditions.join(' AND ')}`;
      }
      
      // Add search condition if provided
      if (search) {
        const searchCondition = `
          (
            username ILIKE $${paramIndex} OR
            email ILIKE $${paramIndex} OR
            first_name ILIKE $${paramIndex} OR
            last_name ILIKE $${paramIndex}
          )
        `;
        
        whereClause = whereClause
          ? `${whereClause} AND ${searchCondition}`
          : `WHERE ${searchCondition}`;
        
        params.push(`%${search}%`);
        paramIndex++;
      }
      
      // Calculate pagination
      const offset = (page - 1) * limit;
      params.push(limit);
      params.push(offset);
      
      // Execute query
      const query = `
        SELECT 
          user_id, username, email, first_name, last_name, 
          phone, role, account_status, created_at, 
          updated_at, last_login
        FROM users
        ${whereClause}
        ORDER BY ${sort}
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;
      
      const countQuery = `
        SELECT COUNT(*) as total
        FROM users
        ${whereClause}
      `;
      
      const [result, countResult] = await Promise.all([
        db.query(query, params),
        db.query(countQuery, params.slice(0, -2))
      ]);
      
      return {
        users: result.rows,
        pagination: {
          total: parseInt(countResult.rows[0].total, 10),
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          pages: Math.ceil(parseInt(countResult.rows[0].total, 10) / limit)
        }
      };
    } catch (error) {
      logger.error('Error fetching all users', { error: error.message });
      throw new DatabaseError('Failed to fetch users');
    }
  },

  /**
   * Update user status (active, suspended, banned)
   * @param {string} userId - User ID
   * @param {string} status - New status
   * @returns {Promise<Object>} Updated user record
   */
  updateUserStatus: async (userId, status) => {
    try {
      const query = `
        UPDATE users
        SET account_status = $1, updated_at = NOW()
        WHERE user_id = $2
        RETURNING user_id, username, email, account_status, updated_at
      `;
      
      const result = await db.query(query, [status, userId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('User not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating user status', { error: error.message, userId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to update user status');
    }
  },

  /**
   * Delete a user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Deleted user record
   */
  deleteUser: async (userId) => {
    try {
      const query = `
        DELETE FROM users
        WHERE user_id = $1
        RETURNING user_id, username, email
      `;
      
      const result = await db.query(query, [userId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('User not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error deleting user', { error: error.message, userId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to delete user');
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
   * Add a new address for a user
   * @param {string} userId - User ID
   * @param {Object} addressData - Address data
   * @returns {Promise<Object>} Created address record
   */
  addUserAddress: async (userId, addressData) => {
    try {
      // Add user_id to address data
      const data = { ...addressData, user_id: userId };
      
      // If this is the default address, unset any existing default
      if (addressData.is_default) {
        await db.query(
          'UPDATE user_addresses SET is_default = FALSE WHERE user_id = $1 AND address_type = $2',
          [userId, addressData.address_type]
        );
      }
      
      // Insert new address
      const { query, values } = SqlBuilder.buildInsertQuery('user_addresses', data);
      const result = await db.query(query, values);
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error adding user address', { error: error.message, userId });
      throw new DatabaseError('Failed to add user address');
    }
  },

  /**
   * Update a user address
   * @param {string} userId - User ID
   * @param {string} addressId - Address ID
   * @param {Object} addressData - Updated address data
   * @returns {Promise<Object>} Updated address record
   */
  updateUserAddress: async (userId, addressId, addressData) => {
    try {
      // If this is the default address, unset any existing default
      if (addressData.is_default) {
        await db.query(
          'UPDATE user_addresses SET is_default = FALSE WHERE user_id = $1 AND address_type = $2 AND address_id != $3',
          [userId, addressData.address_type, addressId]
        );
      }
      
      // Update the address
      const { query, values } = SqlBuilder.buildUpdateQuery(
        'user_addresses',
        { ...addressData, updated_at: new Date() },
        { user_id: userId, address_id: addressId }
      );
      
      const result = await db.query(query, values);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('Address not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating user address', { error: error.message, userId, addressId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to update user address');
    }
  },

  /**
   * Delete a user address
   * @param {string} userId - User ID
   * @param {string} addressId - Address ID
   * @returns {Promise<Object>} Deleted address record
   */
  deleteUserAddress: async (userId, addressId) => {
    try {
      const query = `
        DELETE FROM user_addresses
        WHERE user_id = $1 AND address_id = $2
        RETURNING address_id
      `;
      
      const result = await db.query(query, [userId, addressId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('Address not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error deleting user address', { error: error.message, userId, addressId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to delete user address');
    }
  },

  /**
   * Set an address as default
   * @param {string} userId - User ID
   * @param {string} addressId - Address ID
   * @returns {Promise<Object>} Updated address record
   */
  setDefaultAddress: async (userId, addressId) => {
    try {
      // Get the address type first
      const addressQuery = `
        SELECT address_type FROM user_addresses
        WHERE user_id = $1 AND address_id = $2
      `;
      
      const addressResult = await db.query(addressQuery, [userId, addressId]);
      
      if (addressResult.rows.length === 0) {
        throw new NotFoundError('Address not found');
      }
      
      const addressType = addressResult.rows[0].address_type;
      
      // Unset any existing default of the same type
      await db.query(
        'UPDATE user_addresses SET is_default = FALSE WHERE user_id = $1 AND address_type = $2',
        [userId, addressType]
      );
      
      // Set the new default
      const query = `
        UPDATE user_addresses
        SET is_default = TRUE, updated_at = NOW()
        WHERE user_id = $1 AND address_id = $2
        RETURNING *
      `;
      
      const result = await db.query(query, [userId, addressId]);
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error setting default address', { error: error.message, userId, addressId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to set default address');
    }
  },

  /**
   * Get user wishlists
   * @param {string} userId - User ID
   * @returns {Promise<Array>} User wishlists
   */
  getWishlists: async (userId) => {
    try {
      const query = `
        SELECT * FROM wishlists
        WHERE user_id = $1
        ORDER BY created_at DESC
      `;
      
      const result = await db.query(query, [userId]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching user wishlists', { error: error.message, userId });
      throw new DatabaseError('Failed to fetch wishlists');
    }
  },

  /**
   * Get wishlist with items
   * @param {string} userId - User ID
   * @param {string} wishlistId - Wishlist ID
   * @returns {Promise<Object>} Wishlist with items
   */
  getWishlistWithItems: async (userId, wishlistId) => {
    try {
      // Get wishlist
      const wishlistQuery = `
        SELECT * FROM wishlists
        WHERE user_id = $1 AND wishlist_id = $2
      `;
      
      const wishlistResult = await db.query(wishlistQuery, [userId, wishlistId]);
      
      if (wishlistResult.rows.length === 0) {
        throw new NotFoundError('Wishlist not found');
      }
      
      const wishlist = wishlistResult.rows[0];
      
      // Get wishlist items with product details
      const itemsQuery = `
        SELECT 
          wi.wishlist_item_id,
          wi.added_at,
          wi.notes,
          p.product_id,
          p.name,
          p.price,
          p.sku,
          (
            SELECT url FROM product_images
            WHERE product_id = p.product_id AND is_primary = TRUE
            LIMIT 1
          ) as image_url,
          c.name as category_name
        FROM wishlist_items wi
        JOIN products p ON wi.product_id = p.product_id
        LEFT JOIN categories c ON p.category_id = c.category_id
        WHERE wi.wishlist_id = $1
        ORDER BY wi.added_at DESC
      `;
      
      const itemsResult = await db.query(itemsQuery, [wishlistId]);
      
      return {
        ...wishlist,
        items: itemsResult.rows
      };
    } catch (error) {
      logger.error('Error fetching wishlist with items', { error: error.message, userId, wishlistId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to fetch wishlist with items');
    }
  },

  /**
   * Create a new wishlist
   * @param {string} userId - User ID
   * @param {Object} wishlistData - Wishlist data
   * @returns {Promise<Object>} Created wishlist record
   */
  createWishlist: async (userId, wishlistData) => {
    try {
      const data = {
        ...wishlistData,
        user_id: userId
      };
      
      const { query, values } = SqlBuilder.buildInsertQuery('wishlists', data);
      const result = await db.query(query, values);
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating wishlist', { error: error.message, userId });
      throw new DatabaseError('Failed to create wishlist');
    }
  },

  /**
   * Update a wishlist
   * @param {string} userId - User ID
   * @param {string} wishlistId - Wishlist ID
   * @param {Object} wishlistData - Updated wishlist data
   * @returns {Promise<Object>} Updated wishlist record
   */
  updateWishlist: async (userId, wishlistId, wishlistData) => {
    try {
      const { query, values } = SqlBuilder.buildUpdateQuery(
        'wishlists',
        { ...wishlistData, updated_at: new Date() },
        { user_id: userId, wishlist_id: wishlistId }
      );
      
      const result = await db.query(query, values);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('Wishlist not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating wishlist', { error: error.message, userId, wishlistId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to update wishlist');
    }
  },

  /**
   * get a wishlist
   * @param {string} userId - User ID
   * @param {string} wishlistId - Wishlist ID
   * @returns {Promise<Object>} Deleted wishlist record
   */
  getWishlistById: async (userId, wishlistId) => {
    try {
      const wishlistQuery = `
        SELECT wishlist_id FROM wishlists
        WHERE user_id = $1 AND wishlist_id = $2
      `;
      
      const wishlistResult = await db.query(wishlistQuery, [userId, wishlistId]);
      
      if (wishlistResult.rows.length === 0) {
        throw new NotFoundError('Wishlist not found');
      }
      
      return wishlistResult.rows[0];
    } catch (error) {
      logger.error('Error getting the wishlist', { error: error.message, userId, wishlistId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to get wishlist');
    }
  },
  
  /**
   * Delete a wishlist
   * @param {string} userId - User ID
   * @param {string} wishlistId - Wishlist ID
   * @returns {Promise<Object>} Deleted wishlist record
   */
  deleteWishlist: async (userId, wishlistId) => {
    try {
      const query = `
        DELETE FROM wishlists
        WHERE user_id = $1 AND wishlist_id = $2
        RETURNING wishlist_id, name
      `;
      
      const result = await db.query(query, [userId, wishlistId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('Wishlist not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error deleting wishlist', { error: error.message, userId, wishlistId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to delete wishlist');
    }
  },

  /**
   * Add product to wishlist
   * @param {string} userId - User ID
   * @param {string} wishlistId - Wishlist ID
   * @param {string} productId - Product ID
   * @param {string} [notes] - Optional notes
   * @returns {Promise<Object>} Created wishlist item record
   */
  addProductToWishlist: async (userId, wishlistId, productId, notes) => {
    try {
      // Verify wishlist belongs to user
      const wishlistQuery = `
        SELECT wishlist_id FROM wishlists
        WHERE user_id = $1 AND wishlist_id = $2
      `;
      
      const wishlistResult = await db.query(wishlistQuery, [userId, wishlistId]);
      
      if (wishlistResult.rows.length === 0) {
        throw new NotFoundError('Wishlist not found');
      }
      
      // Check if product already in wishlist
      const existingQuery = `
        SELECT wishlist_item_id FROM wishlist_items
        WHERE wishlist_id = $1 AND product_id = $2
      `;
      
      const existingResult = await db.query(existingQuery, [wishlistId, productId]);
      
      if (existingResult.rows.length > 0) {
        // Product already in wishlist, update notes if provided
        if (notes) {
          const updateQuery = `
            UPDATE wishlist_items
            SET notes = $1
            WHERE wishlist_id = $2 AND product_id = $3
            RETURNING *
          `;
          
          const updateResult = await db.query(updateQuery, [notes, wishlistId, productId]);
          return updateResult.rows[0];
        }
        
        // Return existing record
        return existingResult.rows[0];
      }
      
      // Add product to wishlist
      const insertQuery = `
        INSERT INTO wishlist_items (wishlist_id, product_id, notes)
        VALUES ($1, $2, $3)
        RETURNING *
      `;
      
      const insertResult = await db.query(insertQuery, [wishlistId, productId, notes]);
      return insertResult.rows[0];
    } catch (error) {
      logger.error('Error adding product to wishlist', { 
        error: error.message, userId, wishlistId, productId 
      });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to add product to wishlist');
    }
  },

  /**
   * Remove product from wishlist
   * @param {string} userId - User ID
   * @param {string} wishlistId - Wishlist ID
   * @param {string} productId - Product ID
   * @returns {Promise<Object>} Removed wishlist item record
   */
  removeProductFromWishlist: async (userId, wishlistId, productId) => {
    try {
      // Verify wishlist belongs to user
      const wishlistQuery = `
        SELECT wishlist_id FROM wishlists
        WHERE user_id = $1 AND wishlist_id = $2
      `;
      
      const wishlistResult = await db.query(wishlistQuery, [userId, wishlistId]);
      
      if (wishlistResult.rows.length === 0) {
        throw new NotFoundError('Wishlist not found');
      }
      
      // Remove product from wishlist
      const query = `
        DELETE FROM wishlist_items
        WHERE wishlist_id = $1 AND product_id = $2
        RETURNING wishlist_item_id
      `;
      
      const result = await db.query(query, [wishlistId, productId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('Product not found in wishlist');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error removing product from wishlist', { 
        error: error.message, userId, wishlistId, productId 
      });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to remove product from wishlist');
    }
  },

  /**
   * Get API tokens for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} API tokens
   */
  getApiTokens: async (userId) => {
    try {
      const query = `
        SELECT 
          token
        FROM user_tokens
        WHERE user_id = $1
      `;
      
      const result = await db.query(query, [userId]);

      const { token} =  result.rows[0];

      return { token: token };
    } catch (error) {
      logger.error('Error fetching API tokens', { error: error.message, userId });
      throw new DatabaseError('Failed to fetch API tokens');
    }
  },

  /**
   * Get API tokens for a user
   * @param {string} tokenID - User tokenID ID
   * @returns {Promise<Array>} API tokens
   */
  getApiTokensByToken: async (tokenID) => {
    try {
      const query = `
        SELECT 
          token
        FROM user_tokens
        WHERE token = $1
      `;
      
      const result = await db.query(query, [tokenID]);

      const { token} =  result.rows[0];

      return { token: token };
    } catch (error) {
      logger.error('Error fetching API tokens', { error: error.message, userId });
      throw new DatabaseError('Failed to fetch API tokens');
    }
  },
  
  /**
   * Get API tokens for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} API tokens
   */
  getGuestApiTokens: async (userId) => {
    try {
      const query = `
        SELECT 
          token_id, name, permissions, created_at, 
          last_used_at, expires_at
        FROM api_tokens
        WHERE user_id = $1
        ORDER BY created_at DESC
      `;
      
      const result = await db.query(query, [userId]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching API tokens', { error: error.message, userId });
      throw new DatabaseError('Failed to fetch API tokens');
    }
  },

  /**
   * Create an API token for a user
   * @param {string} userId - User ID
   * @param {Object} tokenData - Token data
   * @returns {Promise<Object>} Created token record
   */
  createApiToken: async (userId, tokenData) => {
    try {
      const data = {
        ...tokenData,
        user_id: userId,
        permissions: JSON.stringify(tokenData.permissions || {})
      };
      
      const { query, values } = SqlBuilder.buildInsertQuery('api_tokens', data);
      const result = await db.query(query, values);
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating API token', { error: error.message, userId });
      throw new DatabaseError('Failed to create API token');
    }
  },

  /**
   * Revoke an API token
   * @param {string} userId - User ID
   * @param {string} tokenId - Token ID
   * @returns {Promise<Object>} Deleted token record
   */
  revokeApiToken: async (userId, tokenId) => {
    try {
      const query = `
        DELETE FROM api_tokens
        WHERE user_id = $1 AND token_id = $2
        RETURNING token_id, name
      `;
      
      const result = await db.query(query, [userId, tokenId]);
      
      if (result.rows.length === 0) {
        throw new NotFoundError('Token not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error revoking API token', { error: error.message, userId, tokenId });
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new DatabaseError('Failed to revoke API token');
    }
  },


    /**
   * Create an API token for a user
   * @param {string} userId - User ID
   * @param {Object} tokenData - Token data
   * @returns {Promise<Object>} Created token record
   */
  createUserToken: async (userId, tokenData) => {
    try {
      const data = {
        ...tokenData,
        user_id: userId,
      };
      
      const { query, values } = SqlBuilder.buildInsertQuery('user_tokens', data);
      const result = await db.query(query, values);
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating API token', { error: error.message, userId });
      throw new DatabaseError('Failed to create API token');
    }
  },








};

module.exports = userQueries;