// server/src/config/db.js
const { Pool } = require('pg');
const logger = require('../utils/logger');
const { db: dbConfig } = require('./environment');

// Create PostgreSQL connection pool
const pool = new Pool({
  user: dbConfig.user,
  host: dbConfig.host,
  database: dbConfig.database,
  password: dbConfig.password,
  port: dbConfig.port,
  // Connection pool settings
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 2000, // How long to wait for a connection
});

// Test the connection
pool.on('connect', () => {
  logger.info('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Execute SQL query with optional parameters
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @param {Object} options - Additional options (transaction client, etc.)
 * @returns {Promise<Object>} Query result
 */
const query = async (text, params, options = {}) => {
  const start = Date.now();
  const client = options.client || pool;
  
  try {
    const result = await client.query(text, params);
    const duration = Date.now() - start;
    
    // Log the query for debugging/performance monitoring
    logger.debug('Executed query', { 
      text, 
      duration, 
      rows: result.rowCount,
      // Don't log params in production as they may contain sensitive data
      ...(process.env.NODE_ENV !== 'production' && { params })
    });
    
    return result;
  } catch (error) {
    logger.error('Database query error', { 
      text, 
      error: error.message,
      code: error.code
    });
    throw error;
  }
};

/**
 * Begin a database transaction
 * @returns {Promise<Object>} Client with transaction
 */
const beginTransaction = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return client;
  } catch (error) {
    client.release();
    throw error;
  }
};

/**
 * Commit a database transaction
 * @param {Object} client - Client with active transaction
 */
const commitTransaction = async (client) => {
  try {
    await client.query('COMMIT');
  } finally {
    client.release();
  }
};

/**
 * Rollback a database transaction
 * @param {Object} client - Client with active transaction
 */
const rollbackTransaction = async (client) => {
  try {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
};

/**
 * Execute queries within a transaction
 * @param {Function} callback - Function that receives transaction client and executes queries
 * @returns {Promise<*>} Result from the callback function
 */
const withTransaction = async (callback) => {
  const client = await beginTransaction();
  try {
    const result = await callback(client);
    await commitTransaction(client);
    return result;
  } catch (error) {
    await rollbackTransaction(client);
    throw error;
  }
};

module.exports = {
  pool,
  query,
  withTransaction,
  beginTransaction,
  commitTransaction,
  rollbackTransaction
};