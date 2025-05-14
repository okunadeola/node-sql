/**
 * Database Migration Manager
 * Handles executing and tracking migrations for the database
 */
const fs = require('fs').promises;
const path = require('path');
const db = require('../config/db');
const logger = require('../utils/logger');

class MigrationManager {
  /**
   * Initialize the migration manager
   */
  async init() {
    await this._createMigrationsTable();
  }

  /**
   * Create the migrations table if it doesn't exist
   * @private
   */
  async _createMigrationsTable() {
    try {
      const query = `
        CREATE TABLE IF NOT EXISTS migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await db.query(query);
      logger.info('Migrations table checked/created');
    } catch (error) {
      logger.error('Failed to create migrations table', { error: error.message });
      throw error;
    }
  }

  /**
   * Get list of applied migrations
   * @returns {Promise<Array>} List of applied migration names
   * @private
   */
  async _getAppliedMigrations() {
    try {
      const query = 'SELECT name FROM migrations ORDER BY id ASC';
      const result = await db.query(query);
      return result.rows.map(row => row.name);
    } catch (error) {
      logger.error('Failed to get applied migrations', { error: error.message });
      throw error;
    }
  }

  /**
   * Get list of available migration files
   * @returns {Promise<Array>} List of available migration file paths
   * @private
   */
  async _getAvailableMigrations() {
    try {
      const migrationsDir = path.join(__dirname, 'migrations');
      const files = await fs.readdir(migrationsDir);
      return files
        .filter(file => file.endsWith('.sql'))
        .sort(); // Sort to ensure migrations run in order
    } catch (error) {
      logger.error('Failed to get available migrations', { error: error.message });
      throw error;
    }
  }

  /**
   * Record a migration as applied
   * @param {string} migrationName - Name of the migration file
   * @returns {Promise<void>}
   * @private
   */
  async _recordMigration(migrationName) {
    try {
      const query = 'INSERT INTO migrations (name) VALUES ($1)';
      await db.query(query, [migrationName]);
      logger.info('Recorded migration', { migrationName });
    } catch (error) {
      logger.error('Failed to record migration', { migrationName, error: error.message });
      throw error;
    }
  }

  /**
   * Apply a migration
   * @param {string} migrationFile - Migration file name
   * @returns {Promise<void>}
   * @private
   */
  async _applyMigration(migrationFile) {
    const client = await db.getClient();
    
    try {
      // Start transaction
      await client.query('BEGIN');
      
      // Read and execute the migration file
      const migrationPath = path.join(__dirname, 'migrations', migrationFile);
      const sql = await fs.readFile(migrationPath, 'utf8');
      
      await client.query(sql);
      
      // Record the migration
      await client.query('INSERT INTO migrations (name) VALUES ($1)', [migrationFile]);
      
      // Commit transaction
      await client.query('COMMIT');
      
      logger.info('Applied migration', { migrationFile });
    } catch (error) {
      // Rollback on error
      await client.query('ROLLBACK');
      logger.error('Failed to apply migration', { migrationFile, error: error.message });
      throw error;
    } finally {
      // Release client back to pool
      client.release();
    }
  }

  /**
   * Run pending migrations
   * @returns {Promise<Array>} List of applied migrations
   */
  async runMigrations() {
    try {
      // Ensure migrations table exists
      await this.init();
      
      const appliedMigrations = await this._getAppliedMigrations();
      const availableMigrations = await this._getAvailableMigrations();
      
      const pendingMigrations = availableMigrations.filter(
        migration => !appliedMigrations.includes(migration)
      );
      
      if (pendingMigrations.length === 0) {
        logger.info('No pending migrations');
        return [];
      }
      
      logger.info(`Found ${pendingMigrations.length} pending migrations`);
      
      const appliedList = [];
      
      for (const migration of pendingMigrations) {
        await this._applyMigration(migration);
        appliedList.push(migration);
      }
      
      return appliedList;
    } catch (error) {
      logger.error('Migration process failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Create a new migration file
   * @param {string} name - Migration name
   * @returns {Promise<string>} Path to the created migration file
   */
  async createMigration(name) {
    try {
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      const fileName = `${timestamp}_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.sql`;
      const filePath = path.join(__dirname, 'migrations', fileName);
      
      const template = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- Write your SQL here

-- For example:
-- CREATE TABLE example (id SERIAL PRIMARY KEY, name VARCHAR(100));

-- To roll back:
-- Consider writing a down migration in a separate file if needed
`;
      
      await fs.writeFile(filePath, template, 'utf8');
      logger.info('Created migration file', { fileName });
      
      return filePath;
    } catch (error) {
      logger.error('Failed to create migration file', { error: error.message });
      throw error;
    }
  }
}

module.exports = new MigrationManager();