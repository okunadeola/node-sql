/**
 * User Controller
 * Handles user-related operations including authentication, profile management, and addresses
 */
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const userQueries = require('../db/queries/users');
const { ValidationError, NotFoundError, AuthenticationError, ConflictError } = require('../utils/error');
const logger = require('../utils/logger');

// Number of salt rounds for password hashing
const SALT_ROUNDS = 10;

const userController = {
  /**
   * Register a new user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  register: async (req, res, next) => {
    try {
      const { username, email, password, firstName, lastName, phone } = req.body;
      
      // Validate required fields
      if (!username || !email || !password) {
        throw new ValidationError('Username, email, and password are required');
      }
      
      // Check if user already exists
      const existingUser = await userQueries.findByEmailOrUsername(email, username);
      if (existingUser) {
        throw new ConflictError('User with this email or username already exists');
      }
      
      // Hash password
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      
      // Create user object
      const newUser = {
        user_id: uuidv4(),
        username,
        email,
        password_hash: passwordHash,
        first_name: firstName || null,
        last_name: lastName || null,
        phone: phone || null,
        role: 'customer', // Default role
        account_status: 'active'
      };
      
      // Save user to database
      const user = await userQueries.createUser(newUser);
      
      // Create JWT token
      const token = jwt.sign(
        { 
          userId: user.user_id,
          email: user.email,
          role: user.role
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      // Return user data (excluding sensitive information)
      const { password_hash, ...userData } = user;
      
      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: userData,
          token
        }
      });
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Authenticate a user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  login: async (req, res, next) => {
    try {
      const { email, password } = req.body;
      
      // Validate required fields
      if (!email || !password) {
        throw new ValidationError('Email and password are required');
      }
      
      // Find user by email
      const user = await userQueries.findByEmail(email);
      if (!user) {
        throw new AuthenticationError('Invalid email or password');
      }
      
      // Check if account is active
      if (user.account_status !== 'active') {
        throw new AuthenticationError('Your account is not active. Please contact support.');
      }
      
      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        throw new AuthenticationError('Invalid email or password');
      }
      
      // Update last login timestamp
      await userQueries.updateLastLogin(user.user_id);
      
      // Create JWT token
      const token = jwt.sign(
        { 
          userId: user.user_id,
          email: user.email,
          role: user.role
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      // Return user data (excluding sensitive information)
      const { password_hash, ...userData } = user;
      
      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          user: userData,
          token
        }
      });
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Get user profile
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  getProfile: async (req, res, next) => {
    try {
      const userId = req.user.userId;
      
      // Get user profile
      const user = await userQueries.findById(userId);
      if (!user) {
        throw new NotFoundError('User not found');
      }
      
      // Remove sensitive information
      const { password_hash, ...userData } = user;
      
      res.status(200).json({
        success: true,
        data: userData
      });
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Update user profile
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  updateProfile: async (req, res, next) => {
    try {
      const userId = req.user.userId;
      const { firstName, lastName, phone, address } = req.body;
      
      // Get current user data
      const currentUser = await userQueries.findById(userId);
      if (!currentUser) {
        throw new NotFoundError('User not found');
      }
      
      // Prepare update data
      const updateData = {
        first_name: firstName !== undefined ? firstName : currentUser.first_name,
        last_name: lastName !== undefined ? lastName : currentUser.last_name,
        phone: phone !== undefined ? phone : currentUser.phone,
        address: address !== undefined ? address : currentUser.address,
        updated_at: new Date()
      };
      
      // Update user
      const updatedUser = await userQueries.updateUser(userId, updateData);
      
      // Remove sensitive information
      const { password_hash, ...userData } = updatedUser;
      
      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: userData
      });
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Change user password
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  changePassword: async (req, res, next) => {
    try {
      const userId = req.user.userId;
      const { currentPassword, newPassword } = req.body;
      
      // Validate required fields
      if (!currentPassword || !newPassword) {
        throw new ValidationError('Current password and new password are required');
      }
      
      // Get user
      const user = await userQueries.findById(userId);
      if (!user) {
        throw new NotFoundError('User not found');
      }
      
      // Verify current password
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isPasswordValid) {
        throw new ValidationError('Current password is incorrect');
      }
      
      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
      
      // Update password
      await userQueries.updatePassword(userId, newPasswordHash);
      
      res.status(200).json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Get user addresses
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  getAddresses: async (req, res, next) => {
    try {
      const userId = req.user.userId;
      
      // Get user addresses
      const addresses = await userQueries.getUserAddresses(userId);
      
      res.status(200).json({
        success: true,
        data: addresses
      });
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Add a new address
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  addAddress: async (req, res, next) => {
    try {
      const userId = req.user.userId;
      const { 
        addressType, firstName, lastName, addressLine1,
        addressLine2, city, state, postalCode, country, phone, isDefault
      } = req.body;
      
      // Validate required fields
      if (!addressType || !firstName || !lastName || !addressLine1 || !city || !postalCode || !country) {
        throw new ValidationError('Please provide all required address fields');
      }
      
      // Prepare address data
      const addressData = {
        address_id: uuidv4(),
        user_id: userId,
        address_type: addressType,
        first_name: firstName,
        last_name: lastName,
        address_line1: addressLine1,
        address_line2: addressLine2 || null,
        city,
        state: state || null,
        postal_code: postalCode,
        country,
        phone: phone || null,
        is_default: isDefault === true
      };
      
      // If setting as default, update other addresses of the same type
      if (isDefault === true) {
        await userQueries.clearDefaultAddress(userId, addressType);
      }
      
      // Save address
      const address = await userQueries.createAddress(addressData);
      
      res.status(201).json({
        success: true,
        message: 'Address added successfully',
        data: address
      });
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Update an address
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  updateAddress: async (req, res, next) => {
    try {
      const userId = req.user.userId;
      const addressId = req.params.addressId;
      const { 
        addressType, firstName, lastName, addressLine1,
        addressLine2, city, state, postalCode, country, phone, isDefault
      } = req.body;
      
      // Check if address exists and belongs to user
      const existingAddress = await userQueries.getAddressById(addressId);
      if (!existingAddress || existingAddress.user_id !== userId) {
        throw new NotFoundError('Address not found');
      }
      
      // Prepare update data
      const updateData = {
        address_type: addressType || existingAddress.address_type,
        first_name: firstName || existingAddress.first_name,
        last_name: lastName || existingAddress.last_name,
        address_line1: addressLine1 || existingAddress.address_line1,
        address_line2: addressLine2 !== undefined ? addressLine2 : existingAddress.address_line2,
        city: city || existingAddress.city,
        state: state !== undefined ? state : existingAddress.state,
        postal_code: postalCode || existingAddress.postal_code,
        country: country || existingAddress.country,
        phone: phone !== undefined ? phone : existingAddress.phone,
        is_default: isDefault !== undefined ? isDefault : existingAddress.is_default,
        updated_at: new Date()
      };
      
      // If setting as default, update other addresses of the same type
      if (isDefault === true && !existingAddress.is_default) {
        await userQueries.clearDefaultAddress(userId, updateData.address_type);
      }
      
      // Update address
      const updatedAddress = await userQueries.updateAddress(addressId, updateData);
      
      res.status(200).json({
        success: true,
        message: 'Address updated successfully',
        data: updatedAddress
      });
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Delete an address
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  deleteAddress: async (req, res, next) => {
    try {
      const userId = req.user.userId;
      const addressId = req.params.addressId;
      
      // Check if address exists and belongs to user
      const existingAddress = await userQueries.getAddressById(addressId);
      if (!existingAddress || existingAddress.user_id !== userId) {
        throw new NotFoundError('Address not found');
      }
      
      // Delete address
      await userQueries.deleteAddress(addressId);
      
      res.status(200).json({
        success: true,
        message: 'Address deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Admin: Get all users (with pagination)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  getAllUsers: async (req, res, next) => {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        throw new Error('Access denied');
      }
      
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const search = req.query.search || '';
      const role = req.query.role || null;
      const status = req.query.status || null;
      
      // Prepare filters
      const filters = {};
      if (search) {
        filters.search = search;
      }
      if (role) {
        filters.role = role;
      }
      if (status) {
        filters.account_status = status;
      }
      
      // Get users with pagination
      const result = await userQueries.getAllUsers(filters, page, limit);
      
      res.status(200).json({
        success: true,
        data: result.users,
        pagination: {
          total: result.total,
          page,
          limit,
          pages: Math.ceil(result.total / limit)
        }
      });
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Admin: Update user status
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  updateUserStatus: async (req, res, next) => {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        throw new Error('Access denied');
      }
      
      const userId = req.params.userId;
      const { status } = req.body;
      
      // Validate status
      if (!status || !['active', 'suspended', 'banned'].includes(status)) {
        throw new ValidationError('Invalid status value');
      }
      
      // Update user status
      const updatedUser = await userQueries.updateUserStatus(userId, status);
      if (!updatedUser) {
        throw new NotFoundError('User not found');
      }
      
      // Remove sensitive information
      const { password_hash, ...userData } = updatedUser;
      
      res.status(200).json({
        success: true,
        message: `User status updated to ${status}`,
        data: userData
      });
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Admin: Update user role
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  updateUserRole: async (req, res, next) => {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        throw new Error('Access denied');
      }
      
      const userId = req.params.userId;
      const { role } = req.body;
      
      // Validate role
      if (!role || !['customer', 'admin', 'seller'].includes(role)) {
        throw new ValidationError('Invalid role value');
      }
      
      // Update user role
      const updatedUser = await userQueries.updateUserRole(userId, role);
      if (!updatedUser) {
        throw new NotFoundError('User not found');
      }
      
      // Remove sensitive information
      const { password_hash, ...userData } = updatedUser;
      
      res.status(200).json({
        success: true,
        message: `User role updated to ${role}`,
        data: userData
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = userController;