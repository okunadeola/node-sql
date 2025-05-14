/**
 * Database Initialization Script
 * Initializes the database schema, creates indexes, and applies constraints
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const logger = require('../utils/logger');
const config = require('../config/db');

// Initialize database connection
const pool = new Pool(config.pgConfig);

/**
 * Execute SQL file contents
 * @param {string} filePath - Path to SQL file
 * @returns {Promise<void>}
 */
async function executeSqlFile(filePath) {
  try {
    const sql = fs.readFileSync(filePath, 'utf8');
    logger.info(`Executing SQL file: ${path.basename(filePath)}`);
    
    // Split file by semicolons but keep them in the statements
    // This is a simple approach - for more complex SQL files with functions/triggers,
    // a more sophisticated parser might be needed
    const statements = sql.split(';').filter(stmt => stmt.trim().length > 0).map(stmt => stmt + ';');
    
    // Get a client from the pool
    const client = await pool.connect();
    
    try {
      // Start a transaction
      await client.query('BEGIN');
      
      // Execute each statement
      for (const statement of statements) {
        if (statement.trim().length > 0) {
          await client.query(statement);
        }
      }
      
      // Commit the transaction
      await client.query('COMMIT');
      logger.info(`Successfully executed ${path.basename(filePath)}`);
    } catch (error) {
      // Roll back the transaction on error
      await client.query('ROLLBACK');
      logger.error(`Error executing ${path.basename(filePath)}:`, error);
      throw error;
    } finally {
      // Release the client back to the pool
      client.release();
    }
  } catch (error) {
    logger.error(`Failed to execute SQL file ${filePath}:`, error);
    throw error;
  }
}

/**
 * Initialize the database schema
 */
async function initializeDatabase() {
  const schemaDir = path.join(__dirname, 'schema');
  
  try {
    logger.info('Starting database initialization...');
    
    // Execute schema files in specific order
    // 1. First create tables
    await executeSqlFile(path.join(schemaDir, 'tables.sql'));
    
    // 2. Then create indexes
    await executeSqlFile(path.join(schemaDir, 'indexes.sql'));
    
    // 3. Finally add constraints (if separated from tables)
    const constraintsPath = path.join(schemaDir, 'constraints.sql');
    if (fs.existsSync(constraintsPath)) {
      await executeSqlFile(constraintsPath);
    }
    
    logger.info('Database initialization completed successfully!');
  } catch (error) {
    logger.error('Database initialization failed:', error);
    throw error;
  } finally {
    // Close the pool
    await pool.end();
  }
}

// Execute if this script is run directly
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      logger.info('Database setup complete');
      process.exit(0);
    })
    .catch(err => {
      logger.error('Database setup failed', err);
      process.exit(1);
    });
}

module.exports = { initializeDatabase, executeSqlFile };