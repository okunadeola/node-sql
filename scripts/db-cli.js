#!/usr/bin/env node

/**
 * Database Command Line Tool
 * Provides commands to initialize, migrate, seed, and reset the database
 */

const { program } = require('commander');
const { initializeDatabase } = require('../src/ecommerce/db/init');
const { runMigrations, revertMigration, createMigration } = require('../src/ecommerce/db/migrations/migrationManager');
const logger = require('../src/ecommerce/utils/logger');

// Configure commander
program
  .version('1.0.0')
  .description('E-commerce database management tool');

// Initialize database command
program
  .command('init')
  .description('Initialize database schema with tables, indexes, and constraints')
  .action(async () => {
    try {
      logger.info('Initializing database schema...');
      await initializeDatabase();
      logger.info('Database schema initialized successfully!');
    } catch (error) {
      logger.error('Failed to initialize database schema:', error);
      process.exit(1);
    }
  });

// Run migrations command
program
  .command('migrate')
  .description('Run all pending migrations')
  .option('-t, --to <version>', 'Migrate to a specific version')
  .action(async (options) => {
    try {
      logger.info('Running database migrations...');
      await runMigrations(options.to);
      logger.info('Migrations completed successfully!');
    } catch (error) {
      logger.error('Failed to run migrations:', error);
      process.exit(1);
    }
  });

// Revert migration command
program
  .command('revert')
  .description('Revert the last applied migration')
  .option('-t, --to <version>', 'Revert to a specific version')
  .action(async (options) => {
    try {
      logger.info('Reverting migration...');
      await revertMigration(options.to);
      logger.info('Migration reverted successfully!');
    } catch (error) {
      logger.error('Failed to revert migration:', error);
      process.exit(1);
    }
  });

// Create new migration command
program
  .command('create-migration <name>')
  .description('Create a new migration file')
  .action(async (name) => {
    try {
      logger.info(`Creating migration: ${name}...`);
      const filePath = await createMigration(name);
      logger.info(`Migration created at: ${filePath}`);
    } catch (error) {
      logger.error('Failed to create migration:', error);
      process.exit(1);
    }
  });

// Reset database command (for development only)
program
  .command('reset')
  .description('WARNING: Reset the database (drop all tables and recreate)')
  .option('-f, --force', 'Force reset without confirmation (dangerous!)')
  .action(async (options) => {
    if (!options.force) {
      console.log('This command will DELETE ALL DATA. Use --force to confirm.');
      process.exit(0);
    }
    
    try {
      const db = require('../src/config/db');
      const client = await db.pool.connect();
      
      logger.info('Resetting database...');
      
      // Drop all tables
      await client.query(`
        DO $$ DECLARE
          r RECORD;
        BEGIN
          FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
            EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
          END LOOP;
        END $$;
      `);
      
      client.release();
      
      // Reinitialize database
      await initializeDatabase();
      
      logger.info('Database reset completed successfully!');
    } catch (error) {
      logger.error('Failed to reset database:', error);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);

// If no command is specified, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}