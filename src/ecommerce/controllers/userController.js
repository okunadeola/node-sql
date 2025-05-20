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
const { generateToken, verifyToken, generateRandomToken } = require('../utils/jwt');

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
      const { username, email, password, firstName, lastName, phone, role } = req.body;
      
      // Validate required fields
      if (!username || !email || !password) {
        throw new ValidationError('Username, email, and password are required');
      }
      
      // Check if user already exists
      const existingUser = await userQueries.getUserByEmailOrUsername(email, username);
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
        role: role || 'customer', // Default role
        account_status:  'active'
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
  },



  /**
 * User registration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
  registe: async (req, res, next) => {
  try {
    const { username, email, password, first_name, last_name } = req.body;
    
    // Check if user already exists
    const existingUser = await userQueries.getUserByEmailOrUsername(email, username);
    if (existingUser) {
      throw new ValidationError('Username or email already in use');
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Create verification token
    const verificationToken = generateRandomToken();
    
    // Create user
    const user = await userQueries.createUser({
      username,
      email,
      password_hash: hashedPassword,
      first_name,
      last_name,
      verification_token: verificationToken,
      is_verified: false,
      account_status: 'pending'
    });
    
    // Send verification email
    await emailService.sendVerificationEmail(user.email, user.first_name, verificationToken);
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please verify your email.',
      userId: user.user_id
    });
  } catch (error) {
    next(error);
  }
},

/**
 * User login
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
logi: async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    // Find user by email
    const user = await userQueries.findUserByEmail(email);
    if (!user) {
      throw new AuthenticationError('Invalid email or password');
    }
    
    // Check account status
    if (user.account_status !== 'active') {
      throw new AuthenticationError(
        user.account_status === 'pending' 
          ? 'Please verify your email to activate your account' 
          : 'Your account is not active'
      );
    }
    
    // Validate password
      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new AuthenticationError('Invalid email or password');
    }
    
    // Generate tokens
    const accessToken = generateToken({
      userId: user.user_id,
      role: user.role
    }, '24h');
    
    const refreshToken = generateToken({
      userId: user.user_id
    }, '7d');
    
    // Save refresh token to database
    await userQueries.createApiToken(user.user_id, {token:refreshToken, name:user.email });
    
    // Update last login time
    await userQueries.updateLastLogin(user.user_id);
    
    res.status(200).json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        userId: user.user_id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
},

/**
 * User logout
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
  logout: async (req, res, next) => {
  try {
    const { refreshToken, userId } = req.body;
    
    if (refreshToken) {
      // Invalidate refresh token
      await userQueries.revokeApiToken(userId, refreshToken);
    }
    
    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Refresh access token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
  refreshToken: async (req, res, next) => {
  try {
    const { refreshToken, userId } = req.body;
    
    if (!refreshToken) {
      throw new AuthenticationError('Refresh token is required');
    }
    
    // Verify token
    const decoded = verifyToken(refreshToken);
    
    // Check if token exists and is valid
    const {token_id} = await tokenQueries.getApiTokens(userId);
    if (!token_id || !decoded) {
      throw new AuthenticationError('Invalid refresh token');
    }
    
    // Get user
    const user = await userQueries.getUserById(decoded.userId);
    if (!user || user.account_status !== 'active') {
      throw new AuthenticationError('User not found or inactive');
    }
    
    // Generate new access token
    const newAccessToken = generateToken({
      userId: user.user_id,
      role: user.role
    }, '24h');
    
    res.status(200).json({
      success: true,
      accessToken: newAccessToken
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Request password reset
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
// NOTE  --> password reset token and reset_token_expires to be add to users table (Migration)
forgotPassword: async (req, res, next) => {
  try {
    const { email } = req.body;
    
    // Find user by email
    const user = await userQueries.getUserByEmail(email);
    
    // Even if user doesn't exist, send a success response to prevent email enumeration
    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent'
      });
    }
    
    // Generate reset token
    const resetToken = generateRandomToken();
    const resetExpires = new Date(Date.now() + 3600000); // 1 hour from now
    
    // Save reset token
    // await userQueries.savePasswordResetToken(user.user_id, resetToken, resetExpires);
    
    // Send password reset email
    // await emailService.sendPasswordResetEmail(user.email, user.first_name, resetToken);
    
    res.status(200).json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent'
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Reset password with token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
// NOTE  --> password reset token and reset_token_expires to be add to users table (Migration)
resetPassword: async (req, res, next) => {
  try {
    const { token, password } = req.body;
    
    // Find user by reset token
    const user = await userQueries.getUserByEmail(token);
    
    if (!user || user.reset_token_expires < new Date()) {
      throw new ValidationError('Invalid or expired password reset token');
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Update password and clear reset token
    await userQueries.changePassword(user.user_id, hashedPassword);
    
    // Invalidate all refresh tokens for the user
    // await tokenQueries.invalidateAllUserTokens(user.user_id);
    
    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully'
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
getUserProfile: async (req, res, next) => {
  try {
    const userId = req.user.userId;
    
    const user = await userQueries.getUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Remove sensitive information
    const userProfile = {
      userId: user.user_id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      address: user.address,
      role: user.role,
      createdAt: user.created_at,
      lastLogin: user.last_login
    };
    
    res.status(200).json({
      success: true,
      user: userProfile
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
updateUserProfile : async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { firstName, lastName, phone, address } = req.body;
    
    // Update user profile
    const updatedUser = await userQueries.updateUserProfile(userId, {
      first_name: firstName,
      last_name: lastName,
      phone,
      address
    });
    
    if (!updatedUser) {
      throw new NotFoundError('User not found');
    }
    
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        userId: updatedUser.user_id,
        username: updatedUser.username,
        email: updatedUser.email,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        phone: updatedUser.phone,
        address: updatedUser.address
      }
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Change password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
  changePassword : async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;
    
    // Get user
    const user = await userQueries.getUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Verify current password
      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new ValidationError('Current password is incorrect');
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Update password
    await userQueries.changePassword(userId, hashedPassword);
    
    // Invalidate all refresh tokens except current one
    // if (req.body.logoutOtherDevices) {
    //   await tokenQueries.invalidateAllUserTokensExceptCurrent(userId, req.body.refreshToken);
    // }
    
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
getUserAddresses : async (req, res, next) => {
  try {
    const userId = req.user.userId;
    
    const addresses = await userQueries.getUserAddresses(userId);
    
    res.status(200).json({
      success: true,
      addresses
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Add user address
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
  addUserAddress: async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const addressData = {
      user_id: userId,
      first_name: req.body.firstName,
      last_name: req.body.lastName,
      address_line1: req.body.addressLine1,
      address_line2: req.body.addressLine2,
      city: req.body.city,
      state: req.body.state,
      postal_code: req.body.postalCode,
      country: req.body.country,
      phone: req.body.phone,
      address_type: req.body.addressType,
      is_default: req.body.isDefault || false
    };
    
    // If this is the first address or marked as default, update existing default
    if (addressData.is_default) {
      // await userQueries.default(userId, addressData.address_type);
    }
    
    const address = await userQueries.addUserAddress(userId, addressData);
    
    res.status(201).json({
      success: true,
      message: 'Address added successfully',
      address
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Update user address
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
updateUserAddress : async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { addressId } = req.params;
    
    const addressData = {
      first_name: req.body.firstName,
      last_name: req.body.lastName,
      address_line1: req.body.addressLine1,
      address_line2: req.body.addressLine2,
      city: req.body.city,
      state: req.body.state,
      postal_code: req.body.postalCode,
      country: req.body.country,
      phone: req.body.phone,
      address_type: req.body.addressType,
      is_default: req.body.isDefault || false
    };
    
    // // If marked as default, update existing default
    // if (addressData.is_default) {
    //   await addressQueries.clearDefaultAddress(userId, addressData.address_type);
    // }
    
    const updatedAddress = await userQueries.updateUserAddress(userId, addressId, addressData);
    
    res.status(200).json({
      success: true,
      message: 'Address updated successfully',
      address: updatedAddress
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Delete user address
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
deleteUserAddress : async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { addressId } = req.params;
    

    await userQueries.deleteUserAddress(userId, addressId);
    
    res.status(200).json({
      success: true,
      message: 'Address deleted successfully'
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Set default address
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
setDefaultAddress : async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { addressId } = req.params;

    // // Clear existing default address
    // await addressQueries.clearDefaultAddress(userId, address.address_type);
    
    // Set new default address
    const updatedAddress = await userQueries.setDefaultAddress(userId, addressId);
    
    res.status(200).json({
      success: true,
      message: 'Default address updated successfully',
      address: updatedAddress
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Get user wishlists
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
getWishlists : async (req, res, next) => {
  try {
    const userId = req.user.userId;
    
    const wishlists = await userQueries.getWishlists(userId);
    
    res.status(200).json({
      success: true,
      wishlists
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Create wishlist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
createWishlist : async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name, isPublic } = req.body;
    
    const wishlist = await userQueries.createWishlist(userId, {
      user_id: userId,
      name,
      is_public: isPublic || false
    });
    
    res.status(201).json({
      success: true,
      message: 'Wishlist created successfully',
      wishlist
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Update wishlist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
updateWishlist : async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { wishlistId } = req.params;
    const { name, isPublic } = req.body;
    
    // Check if wishlist belongs to user
    const existingWishlist = await userQueries.getWishlistById(userId, wishlistId);
    if (!existingWishlist || existingWishlist.user_id !== userId) {
      throw new NotFoundError('Wishlist not found');
    }
    
    const updatedWishlist = await userQueries.updateWishlist(userId, wishlistId, {
      name,
      is_public: isPublic
    });
    
    res.status(200).json({
      success: true,
      message: 'Wishlist updated successfully',
      wishlist: updatedWishlist
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Delete wishlist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
deleteWishlist : async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { wishlistId } = req.params;
    
    // Check if wishlist belongs to user
    const existingWishlist = await userQueries.getWishlistById(userId, wishlistId);
    if (!existingWishlist || existingWishlist.user_id !== userId) {
      throw new NotFoundError('Wishlist not found');
    }
    
    await userQueries.deleteWishlist(userId, wishlistId);
    
    res.status(200).json({
      success: true,
      message: 'Wishlist deleted successfully'
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Add product to wishlist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
addProductToWishlist : async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { wishlistId, productId } = req.params;
    const { notes } = req.body;
    
    // // Check if product already in wishlist
    // const existingItem = await userQueries.getWishlistItem(wishlistId, productId);
    // if (existingItem) {
    //   return res.status(200).json({
    //     success: true,
    //     message: 'Product already in wishlist',
    //     wishlistItem: existingItem
    //   });
    // }
    
    const wishlistItem = await userQueries.addProductToWishlist(userId, wishlistId, productId, notes);
    
    res.status(201).json({
      success: true,
      message: 'Product added to wishlist',
      wishlistItem
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Remove product from wishlist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
removeProductFromWishlist : async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { wishlistId, productId } = req.params;
    
    await userQueries.removeProductFromWishlist(userId, wishlistId, productId);
    
    res.status(200).json({
      success: true,
      message: 'Product removed from wishlist'
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Get all users (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
getAllUsers : async (req, res, next) => {
  try {
    const { page = 1, limit = 20, role, status, search } = req.query;
    
    const filters = {};
    if (role) filters.role = role;
    if (status) filters.account_status = status;
    
    const users = await userQueries.getAllUsers({
      page: parseInt(page),
      limit: parseInt(limit),
      filters,
      search
    });
    
    res.status(200).json({
      success: true,
      ...users
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Get user by ID (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
getUserById : async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    const user = await userQueries.getUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Get user addresses
    const addresses = await userQueries.getUserAddresses(userId);
    
    // Get user orders stats
    // const orderStats = await userQueries.getUserOrderStats(userId);
    
    res.status(200).json({
      success: true,
      user: {
        userId: user.user_id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        role: user.role,
        accountStatus: user.account_status,
        createdAt: user.created_at,
        lastLogin: user.last_login,
        addresses,
        // orderStats
      }
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Update user (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
updateUser : async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { firstName, lastName, email, phone, role } = req.body;
    
    // Check if user exists
    const existingUser = await userQueries.getUserById(userId);
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }
    
    // Update user
    const updatedUser = await userQueries.updateUser(userId, {
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      role
    });
    
    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user: {
        userId: updatedUser.user_id,
        username: updatedUser.username,
        email: updatedUser.email,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        phone: updatedUser.phone,
        role: updatedUser.role,
        accountStatus: updatedUser.account_status
      }
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Update user status (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
updateUserStatus : async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;
    
    // Check if user exists
    const existingUser = await userQueries.getUserById(userId);
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }
    
    // Don't allow changing own status
    if (userId === req.user.userId) {
      throw new ValidationError('Cannot change your own account status');
    }
    
    // Update user status
    const updatedUser = await userQueries.updateUserStatus(userId, status);
    
    // Invalidate all user tokens if banned or suspended
    if (status === 'banned' || status === 'suspended') {
      // await tokenQueries.invalidateAllUserTokens(userId);
    }
    
    res.status(200).json({
      success: true,
      message: `User status updated to ${status}`,
      user: {
        userId: updatedUser.user_id,
        username: updatedUser.username,
        email: updatedUser.email,
        accountStatus: updatedUser.account_status
      }
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Delete user (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
deleteUser : async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    // Check if user exists
    const existingUser = await userQueries.getUserById(userId);
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }
    
    // Don't allow deleting own account
    if (userId === req.user.userId) {
      throw new ValidationError('Cannot delete your own account');
    }
    
    // Check if user is admin
    if (existingUser.role === 'admin') {
      throw new ValidationError('Cannot delete admin accounts');
    }
    
    // Delete user
    await userQueries.deleteUser(userId);
    
    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Email verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
verifyEmail : async (req, res, next) => {
  try {
    const { token } = req.body;
    
    // Find user by verification token
    const user = {} // await userQueries.findUserByVerificationToken(token);
    
    if (!user) {
      throw new ValidationError('Invalid or expired verification token');
    }
    
    // Update user verification status
    // await userQueries.verifyUser(user.user_id);
    
    res.status(200).json({
      success: true,
      message: 'Email verified successfully'
    });
  } catch (error) {
    next(error);
  }
},

/**
 * Resend verification email
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
resendVerificationEmail : async (req, res, next) => {
  try {
    const { email } = req.body;
    
    // Find user by email
    const user = await userQueries.getUserByEmail(email);
    
    // Even if user doesn't exist, send a success response
    if (!user || user.is_verified) {
      res.status(200).json({
      success: true,
      message: 'Email verification sent successfully'
    });
    }
  } catch (error) {
    next(error);
  }
  }
};

module.exports = userController;