// server/src/utils/error.js
/**
 * Custom error classes for the application
 */

/**
 * Base application error
 */
class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true; // Operational errors are expected and can be handled gracefully
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Database error
 */
class DatabaseError extends AppError {
  constructor(message = 'Database error occurred', details = null) {
    super(message, 500, 'DATABASE_ERROR');
    this.details = details;
  }
}

/**
 * Not found error
 */
class NotFoundError extends AppError {
  constructor(message = 'Resource not found', resource = null) {
    super(message, 404, 'NOT_FOUND');
    this.resource = resource;
  }
}

/**
 * Validation error
 */
class ValidationError extends AppError {
  constructor(message = 'Validation failed', errors = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

/**
 * Authentication error
 */
class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/**
 * Authorization error
 */
class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

/**
 * Conflict error
 */
class ConflictError extends AppError {
  constructor(message = 'Resource already exists', resource = null) {
    super(message, 409, 'CONFLICT_ERROR');
    this.resource = resource;
  }
}

/**
 * Rate limit error
 */
class RateLimitError extends AppError {
  constructor(message = 'Too many requests', retryAfter = null) {
    super(message, 429, 'RATE_LIMIT_ERROR');
    this.retryAfter = retryAfter;
  }
}

/**
 * Bad request error
 */
class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, 400, 'BAD_REQUEST');
  }
}

/**
 * External service error
 */
class ExternalServiceError extends AppError {
  constructor(message = 'External service error', service = null) {
    super(message, 502, 'EXTERNAL_SERVICE_ERROR');
    this.service = service;
  }
}

/**
 * Format error for consistent API response
 * @param {Error} error - Error object
 * @returns {Object} Formatted error response
 */
const formatError = (error) => {
  // Default error structure for unhandled errors
  const formattedError = {
    status: 'error',
    code: error.errorCode || 'INTERNAL_ERROR',
    message: error.message || 'An unexpected error occurred',
  };

  // Add additional details for operational errors
  if (error.isOperational) {
    if (error instanceof ValidationError && error.errors) {
      formattedError.errors = error.errors;
    }
    
    if (error instanceof NotFoundError && error.resource) {
      formattedError.resource = error.resource;
    }
    
    if (error instanceof ConflictError && error.resource) {
      formattedError.resource = error.resource;
    }
    
    if (error instanceof RateLimitError && error.retryAfter) {
      formattedError.retryAfter = error.retryAfter;
    }
    
    if (error instanceof ExternalServiceError && error.service) {
      formattedError.service = error.service;
    }
    
    if (error instanceof DatabaseError && error.details) {
      formattedError.details = error.details;
    }
  }

  return formattedError;
};

module.exports = {
  AppError,
  DatabaseError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  RateLimitError,
  BadRequestError,
  ExternalServiceError,
  formatError
};