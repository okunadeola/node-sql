// server/src/config/email.js
const nodemailer = require('nodemailer');
const { logger } = require('../utils/logger');

// Configure email transport
let transporter;

// Different configuration for development and production
if (process.env.NODE_ENV === 'production') {
  // Production configuration
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });
} else {
  // Development configuration - use ethereal.email or mailtrap
  transporter = nodemailer.createTransport({
    host: process.env.DEV_EMAIL_HOST || 'smtp.ethereal.email',
    port: process.env.DEV_EMAIL_PORT || 587,
    secure: false,
    auth: {
      user: process.env.DEV_EMAIL_USER,
      pass: process.env.DEV_EMAIL_PASSWORD
    }
  });
}

// Verify email configuration
transporter.verify()
  .then(() => logger.info('Email service is ready'))
  .catch(err => logger.error('Email service error:', err));

module.exports = transporter;