// server/src/config/environment.js
require('dotenv').config();

module.exports = {
  // Server configuration
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    apiPrefix: process.env.API_PREFIX || '/api/v1',
  },
  
  // Database configuration
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'ecommerce',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: process.env.DB_SSL === 'true',
  },
  
  // JWT Authentication
  jwt: {
    secret: process.env.JWT_SECRET || 'supersecretkey', // Change in production
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  
  // Security configurations
  security: {
    saltRounds: parseInt(process.env.SALT_ROUNDS || '10'),
    corsOrigin: process.env.CORS_ORIGIN || '*',
  },
  
  // Pagination default settings
  pagination: {
    defaultLimit: parseInt(process.env.DEFAULT_LIMIT || '20'),
    maxLimit: parseInt(process.env.MAX_LIMIT || '100'),
  },
  
  // Redis cache configuration (if used)
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || '',
    ttl: parseInt(process.env.REDIS_TTL || '3600'),
  },
  
  // Logger configuration
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    prettyPrint: process.env.NODE_ENV !== 'production',
  },
  
  // Payment gateway configurations
  payment: {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
    paypalSecret: process.env.PAYPAL_SECRET || '',
    paypalMode: process.env.PAYPAL_MODE || 'sandbox',
  },
  
  // Email service configuration
  email: {
    from: process.env.EMAIL_FROM || 'no-reply@ecommerce.com',
    host: process.env.EMAIL_HOST || '',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER || '',
      pass: process.env.EMAIL_PASS || '',
    },
  },
};