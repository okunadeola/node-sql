/**
 * Database Initialization Script
 * Initializes the database schema, creates indexes, and applies constraints
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const logger = require('../utils/logger');
// const config = require('../config/db');
const db = require('../config/db');

/**
 * Execute SQL file contents
 * @param {string} filePath - Path to SQL file
 * @returns {Promise<void>}
 */
async function executeSqlFile(filePath) {
  let client; // Declare client at function scope
  
  try {
    const sql = fs.readFileSync(filePath, 'utf8');
    logger.info(`Executing SQL file: ${path.basename(filePath)}`);
    
    // Split file by semicolons but keep them in the statements
    // This is a simple approach - for more complex SQL files with functions/triggers,
    // a more sophisticated parser might be needed
    const statements = sql.split(';').filter(stmt => stmt.trim().length > 0).map(stmt => stmt + ';');
    
    try {
      // Start a transaction
      client = await db.pool.connect(); // Assign to the function-scoped variable
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
      if (client) {
        await client.query('ROLLBACK');
      }
      logger.error(`Error executing ${path.basename(filePath)}:`, error);
      throw error;
    } finally {
      // Release the client back to the pool
      if (client) {
        client.release();
      }
    }
  } catch (error) {
    logger.error(`Failed to execute SQL file ${filePath}:`, error);
    throw error;
  }
}

/**
 * Initialize the database schema
 */
async function initializeDatabase(cleanStart = false) {
  const schemaDir = path.join(__dirname, 'schema');
  
  try {
    logger.info('Starting database initialization...');

    // Option 1: Clean start - drop everything first
    if (cleanStart) {
      await dropAllTables();
    }
    
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
    await db.pool.end();
  }
}



async function dropAllTables() {
  let client;
  
  try {
    client = await db.pool.connect();
    logger.info('Dropping all existing tables and functions...');
    
    // Get all table names in the current schema
    const tablesResult = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
    `);
    
    // Drop all tables with CASCADE to handle foreign keys
    for (const row of tablesResult.rows) {
      const tableName = row.tablename;
      await client.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
      logger.info(`Dropped table: ${tableName}`);
    }
    
    // Get all functions and procedures
    const functionsResult = await client.query(`
      SELECT proname, prokind
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
      AND prokind IN ('f', 'p')
    `);
    
    // Drop all functions and procedures
    for (const row of functionsResult.rows) {
      const funcName = row.proname;
      const funcType = row.prokind === 'f' ? 'FUNCTION' : 'PROCEDURE';
      await client.query(`DROP ${funcType} IF EXISTS "${funcName}" CASCADE`);
      logger.info(`Dropped ${funcType.toLowerCase()}: ${funcName}`);
    }
    
    // Drop all sequences that might be orphaned
    const sequencesResult = await client.query(`
      SELECT sequencename 
      FROM pg_sequences 
      WHERE schemaname = 'public'
    `);
    
    for (const row of sequencesResult.rows) {
      const seqName = row.sequencename;
      await client.query(`DROP SEQUENCE IF EXISTS "${seqName}" CASCADE`);
      logger.info(`Dropped sequence: ${seqName}`);
    }
    
    logger.info('Successfully dropped all existing database objects');
    
  } catch (error) {
    logger.error('Error dropping database objects:', error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
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