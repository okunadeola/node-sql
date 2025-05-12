// server/src/utils/logger.js
const { createLogger, format, transports } = require('winston');
const { logger: loggerConfig } = require('../config/environment');

// Define log format
const logFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.splat(),
  format.json()
);

// Create the logger instance
const logger = createLogger({
  level: loggerConfig.level,
  format: logFormat,
  defaultMeta: { service: 'ecommerce-api' },
  transports: [
    // Write all logs to console
    new transports.Console({
      format: loggerConfig.prettyPrint 
        ? format.combine(
            format.colorize(),
            format.printf(({ timestamp, level, message, ...meta }) => {
              // Extract SQL query details if available
              const sqlDetails = meta.text 
                ? `\n  Query: ${meta.text}${meta.params ? `\n  Params: ${JSON.stringify(meta.params)}` : ''}${meta.duration ? `\n  Duration: ${meta.duration}ms` : ''}` 
                : '';
              
              // Extract error details if available
              const errorDetails = meta.error ? `\n  Error: ${meta.error}${meta.code ? ` (${meta.code})` : ''}` : '';
              
              // Construct log output
              return `${timestamp} ${level}: ${message}${sqlDetails}${errorDetails}${Object.keys(meta).length > 0 && !meta.text && !meta.error ? `\n  ${JSON.stringify(meta)}` : ''}`;
            })
          )
        : format.json()
    }),
    
    // In production, add additional transports:
    // - Error logs to separate file
    ...(process.env.NODE_ENV === 'production' ? [
      new transports.File({ 
        filename: 'logs/error.log', 
        level: 'error',
        maxsize: 10485760, // 10MB
        maxFiles: 5,
      }),
      // All logs to combined file
      new transports.File({ 
        filename: 'logs/combined.log',
        maxsize: 10485760, // 10MB
        maxFiles: 5,
      })
    ] : [])
  ]
});

// Add special handling for SQL query logging
logger.sqlQuery = (query, params, duration, rows) => {
  logger.debug('SQL Query', {
    text: query,
    params,
    duration,
    rows
  });
};

module.exports = logger;