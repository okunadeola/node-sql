/**
 * Main server entry point
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Import custom modules
const logger = require('./ecommerce/utils/logger');
const routes = require('./ecommerce/routes');
const errorHandler = require('./ecommerce/middleware/errorHandler');
const rateLimiter = require('./ecommerce/middleware/rateLimiter');
const db = require('./ecommerce/config/db');

// Create Express app
const app = express();

// Set up request ID middleware
app.use((req, res, next) => {
  req.id = uuidv4();
  next();
});

// Set up secure headers
app.use(helmet());

// Enable CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key']
}));

// Compression middleware
app.use(compression());

// Request logging
if (process.env.NODE_ENV === 'production') {
  // Create a write stream for access logs
  const accessLogStream = fs.createWriteStream(
    path.join(__dirname, '../logs/access.log'),
    { flags: 'a' }
  );
  
  // Set up morgan logging to file and console
  app.use(morgan('combined', { stream: accessLogStream }));
} else {
  // Development logging
  app.use(morgan('dev'));
}

// Parse JSON request bodies
app.use(express.json({ limit: '1mb' }));

// Parse URL-encoded request bodies
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Apply global rate limiter
app.use(rateLimiter({
  maxRequests: 300,
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: 'global'
}));

// Test database connection
db.query('SELECT NOW()')
  .then(() => logger.info('Database connection successful'))
  .catch((err) => logger.error('Database connection failed', { error: err.message }));

// Mount API routes
app.use('/api', routes);

// Handle 404 errors
app.use((req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
});

// Global error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection', { error: err.message, stack: err.stack });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    db.end();
  });
});

module.exports = server;