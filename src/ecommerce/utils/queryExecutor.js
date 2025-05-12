// utils/queryExecutor.js
const { query } = require('../config/db');
const logger = require('./logger');

const executeQuery = async (sql, params = []) => {
  try {
    logger.debug(`Executing query: ${sql}`);
    const start = Date.now();
    const result = await query(sql, params);
    const duration = Date.now() - start;
    logger.debug(`Query completed in ${duration}ms`);
    return result;
  } catch (error) {
    logger.error(`Query error: ${error.message}`, { sql });
    throw error;
  }
};

module.exports = executeQuery;