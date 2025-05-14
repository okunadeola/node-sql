/**
 * Error Handler Middleware
 * Provides centralized error handling for the application
 */
const { AppError, DatabaseError } = require('../utils/error');
const logger = require('../utils/logger');
const { NODE_ENV } = require('../config/environment');

/**
 * Format error response for development environment
 * @param {Error} err - Error object
 * @param {Object} res - Express response object
 */
const sendDevError = (err, res) => {
  res.status(err.statusCode || 500).json({
    status: 'error',
    error: {
      code: err.errorCode || 'INTERNAL_ERROR',
      message: err.message,
      details: err.details || null,
      stack: err.stack
    },
    timestamp: new Date().toISOString()
  });
};

/**
 * Format error response for production environment
 * @param {Error} err - Error object
 * @param {Object} res - Express response object
 */
const sendProdError = (err, res) => {
  // For operational errors, send detailed error message
  if (err.isOperational) {
    return res.status(err.statusCode || 500).json({
      status: 'error',
      error: {
        code: err.errorCode || 'INTERNAL_ERROR',
        message: err.message,
        details: err.details || null
      },
      timestamp: new Date().toISOString()
    });
  }
  
  // For programming errors, don't leak error details
  logger.error('Unexpected error', { error: err });
  
  res.status(500).json({
    status: 'error',
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong'
    },
    timestamp: new Date().toISOString()
  });
};

/**
 * Handle specific PostgreSQL errors
 * @param {Error} err - PostgreSQL error
 * @returns {AppError} Formatted application error
 */
const handlePostgresError = (err) => {
  // Unique violation
  if (err.code === '23505') {
    const field = err.detail.match(/\((.*?)\)/)?.[1] || 'field';
    return new DatabaseError(`A record with this ${field} already exists`, 409, 'RESOURCE_CONFLICT');
  }
  
  // Foreign key constraint violation
  if (err.code === '23503') {
    return new DatabaseError('Referenced resource not found', 404, 'RESOURCE_NOT_FOUND');
  }
  
  // Not null constraint violation
  if (err.code === '23502') {
    const field = err.column || 'field';
    return new DatabaseError(`Missing required field: ${field}`, 400, 'VALIDATION_ERROR');
  }
  
  // Check constraint violation
  if (err.code === '23514') {
    return new DatabaseError('Data validation constraint failed', 400, 'VALIDATION_ERROR');
  }
  
  return new DatabaseError('Database error', 500, 'DATABASE_ERROR');
};

/**
 * Handle MongoDB duplicate key error
 * @param {Error} err - MongoDB error
 * @returns {AppError} Formatted application error
 */
const handleMongoDBDuplicateKeyError = (err) => {
  const field = Object.keys(err.keyValue)[0];
  return new DatabaseError(
    `A record with this ${field} already exists: ${err.keyValue[field]}`, 
    409, 
    'RESOURCE_CONFLICT'
  );
};

/**
 * Handle MongoDB validation error
 * @param {Error} err - MongoDB error
 * @returns {AppError} Formatted application error
 */
const handleMongoDBValidationError = (err) => {
  const errors = Object.values(err.errors).map(val => ({
    field: val.path,
    message: val.message
  }));
  
  return new DatabaseError(
    'Validation failed', 
    400, 
    'VALIDATION_ERROR',
    errors
  );
};

/**
 * Handle invalid JWT token error
 * @returns {AppError} Formatted application error
 */
const handleJWTError = () => {
  return new AppError(
    'Invalid authentication token. Please log in again.', 
    401, 
    'INVALID_TOKEN'
  );
};

/**
 * Handle expired JWT token error
 * @returns {AppError} Formatted application error
 */
const handleJWTExpiredError = () => {
  return new AppError(
    'Your authentication token has expired. Please log in again.', 
    401, 
    'TOKEN_EXPIRED'
  );
};

/**
 * Central error handling middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  
  // Log all errors
  const logLevel = err.statusCode >= 500 ? 'error' : 'warn';
  logger[logLevel]('Request error', {
    method: req.method,
    url: req.originalUrl,
    error: err.message,
    stack: err.stack,
    body: req.body,
    params: req.params,
    query: req.query,
    userId: req.user?.user_id
  });
  
  // Different error handling based on environment
  if (NODE_ENV === 'development') {
    sendDevError(err, res);
  } else {
    let error = { ...err };
    error.message = err.message;
    error.name = err.name;
    
    // PostgreSQL errors
    if (err.code && typeof err.code === 'string' && err.code.startsWith('22') || err.code.startsWith('23')) {
      error = handlePostgresError(err);
    }
    
    // MongoDB errors
    if (err.name === 'ValidationError') error = handleMongoDBValidationError(err);
    if (err.code === 11000) error = handleMongoDBDuplicateKeyError(err);
    
    // JWT errors
    if (err.name === 'JsonWebTokenError') error = handleJWTError();
    if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();
    
    sendProdError(error, res);
  }
};

/**
 * Catch async errors in route handlers
 * @param {Function} fn - Async function
 * @returns {Function} Express middleware
 */
exports.catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

/**
 * Handle 404 Not Found errors for undefined routes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.notFound = (req, res, next) => {
  const err = new AppError(`Cannot find ${req.method} ${req.originalUrl} on this server`, 404, 'RESOURCE_NOT_FOUND');
  next(err);
};