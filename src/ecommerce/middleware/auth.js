/**
 * Authentication Middleware
 * Provides JWT authentication and role-based authorization
 */
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { promisify } = require('util');
const userQueries = require('../db/queries/users');
const { AuthenticationError, AuthorizationError } = require('../utils/error');
const logger = require('../utils/logger');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/environment');

exports.authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) throw new Error('Authentication required');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verify user exists in database
    const { rows } = await pool.query(
      'SELECT user_id, role, account_status FROM users WHERE user_id = $1',
      [decoded.userId]
    );
    
    if (!rows[0]) throw new Error('User not found');
    if (rows[0].account_status !== 'active') throw new Error('Account suspended');

    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      sessionId: decoded.sessionId
    };
    
    next();
  } catch (error) {
    res.status(401).json({
      status: 'fail',
      message: error.message
    });
  }
};

exports.requireRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        status: 'fail',
        message: 'Unauthorized access'
      });
    }
    next();
  };
};






/**
 * Protect routes - Verify JWT token and attach user to request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.protect = async (req, res, next) => {
  try {
    // 1) Get token from authorization header
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new AuthenticationError('You are not logged in. Please log in to get access.', 401, 'AUTH_REQUIRED');
    }

    // 2) Verify token
    const decoded = await promisify(jwt.verify)(token, JWT_SECRET);

    // 3) Check if user still exists
    const currentUser = await userQueries.getUserById(decoded.id);
    if (!currentUser) {
      throw new AuthenticationError('The user associated with this token no longer exists.', 401, 'INVALID_TOKEN');
    }

    // 4) Check if user changed password after token was issued
    if (currentUser.password_changed_at && decoded.iat < parseInt(currentUser.password_changed_at.getTime() / 1000, 10)) {
      throw new AuthenticationError('User recently changed password. Please log in again.', 401, 'PASSWORD_CHANGED');
    }

    // 5) Check if account is active
    if (currentUser.account_status !== 'active') {
      throw new AuthenticationError(`Your account is ${currentUser.account_status}. Please contact support.`, 401, 'ACCOUNT_INACTIVE');
    }

    // Grant access to protected route
    req.user = currentUser;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new AuthenticationError('Invalid token. Please log in again.', 401, 'INVALID_TOKEN'));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new AuthenticationError('Your token has expired. Please log in again.', 401, 'TOKEN_EXPIRED'));
    }
    next(error);
  }
};

/**
 * Restrict routes to specific user roles
 * @param {...string} roles - Allowed roles
 * @returns {Function} Express middleware
 */
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('You must be logged in first', 401, 'AUTH_REQUIRED'));
    }
    
    if (!roles.includes(req.user.role)) {
      return next(new AuthorizationError('You do not have permission to perform this action', 403, 'INSUFFICIENT_PERMISSIONS'));
    }

    next();
  };
};

/**
 * Verify API token middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.verifyApiToken = async (req, res, next) => {
  try {
    // 1) Get API token from header
    const apiToken = req.headers['x-api-key'];
    if (!apiToken) {
      throw new AuthenticationError('API key is required', 401, 'API_KEY_REQUIRED');
    }

    // 2) Check if API token exists and is valid
    const tokenData = await userQueries.getApiToken(apiToken);
    if (!tokenData) {
      throw new AuthenticationError('Invalid API key', 401, 'INVALID_API_KEY');
    }

    // 3) Check if token has expired
    if (tokenData.expires_at && new Date() > new Date(tokenData.expires_at)) {
      throw new AuthenticationError('API key has expired', 401, 'API_KEY_EXPIRED');
    }

    // 4) Check user status
    const user = await userQueries.getUserById(tokenData.user_id);
    if (!user || user.account_status !== 'active') {
      throw new AuthenticationError('User account is inactive', 401, 'ACCOUNT_INACTIVE');
    }

    // 5) Update last used timestamp
    await userQueries.updateApiTokenUsage(tokenData.token_id);

    // 6) Add user and token permissions to request
    req.user = user;
    req.apiToken = tokenData;
    
    // Check if endpoint is allowed in permissions
    if (tokenData.permissions) {
      const endpoint = `${req.method.toLowerCase()}:${req.originalUrl.split('?')[0]}`;
      const hasPermission = checkEndpointPermission(tokenData.permissions, endpoint);
      if (!hasPermission) {
        throw new AuthorizationError('This API key does not have permission for this endpoint', 403, 'INSUFFICIENT_PERMISSIONS');
      }
    }

    next();
  } catch (error) {
    logger.error('API token verification failed', { error: error.message });
    next(error);
  }
};

/**
 * Check if token permissions allow access to an endpoint
 * @param {Object} permissions - Token permissions
 * @param {string} endpoint - Endpoint to check
 * @returns {boolean} Whether access is allowed
 */
function checkEndpointPermission(permissions, endpoint) {
  // If permissions grants all access
  if (permissions.allow_all === true) {
    return true;
  }

  // If specific endpoints are allowed
  if (Array.isArray(permissions.endpoints)) {
    // Check for exact matches
    if (permissions.endpoints.includes(endpoint)) {
      return true;
    }

    // Check for wildcard paths
    return permissions.endpoints.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(endpoint);
      }
      return false;
    });
  }

  return false;
}

/**
 * Creates a JWT token for the user
 * @param {string} userId - User ID
 * @returns {string} JWT token
 */
exports.createToken = (userId) => {
  return jwt.sign({ id: userId }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
};

/**
 * Optional authentication - tries to authenticate but continues if no token or invalid token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(); // Continue without authentication
    }

    const decoded = await promisify(jwt.verify)(token, JWT_SECRET);
    const currentUser = await userQueries.getUserById(decoded.id);
    
    if (currentUser && currentUser.account_status === 'active') {
      req.user = currentUser;
    }
    
    next();
  } catch (error) {
    // Continue without setting req.user
    next();
  }
};