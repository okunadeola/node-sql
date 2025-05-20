// server/src/services/emailService.js
const fs = require('fs').promises;
const path = require('path');
const handlebars = require('handlebars');
const transporter = require('../config/email');
const { logger } = require('../utils/logger');
const db = require('../config/db');

/**
 * Email Service
 * Handles sending various system emails using templates
 */
class EmailService {
  constructor() {
    this.templateCache = {};
    this.defaultSender = process.env.EMAIL_FROM || 'noreply@example.com';
  }

  /**
   * Load and compile an email template
   * @param {string} templateName - Name of the template to load
   * @returns {Promise<Function>} Compiled template function
   */
  async loadTemplate(templateName) {
    // Check cache first
    if (this.templateCache[templateName]) {
      return this.templateCache[templateName];
    }

    // Load from database or file system
    try {
      // First try to load from database
      const result = await db.query(
        'SELECT content FROM notification_templates WHERE name = $1 AND type = $2',
        [templateName, 'email']
      );

      let templateContent;
      if (result.rows.length > 0) {
        templateContent = result.rows[0].content;
      } else {
        // Fall back to file system if not in database
        const templatePath = path.join(__dirname, '../templates/emails', `${templateName}.html`);
        templateContent = await fs.readFile(templatePath, 'utf-8');
      }

      // Compile and cache the template
      const compiledTemplate = handlebars.compile(templateContent);
      this.templateCache[templateName] = compiledTemplate;
      return compiledTemplate;
    } catch (error) {
      logger.error(`Failed to load email template: ${templateName}`, error);
      throw new Error(`Email template not found: ${templateName}`);
    }
  }

  /**
   * Send an email using a template
   * @param {Object} options - Email options
   * @param {string} options.to - Recipient email
   * @param {string} options.subject - Email subject
   * @param {string} options.template - Template name
   * @param {Object} options.data - Data to populate the template
   * @param {string} [options.from] - Sender email (optional)
   * @returns {Promise<Object>} Information about the sent email
   */
  async sendTemplatedEmail({ to, subject, template, data, from = this.defaultSender }) {
    try {
      // Load and compile the template
      const compiledTemplate = await this.loadTemplate(template);

      // Render the template with the provided data
      const html = compiledTemplate(data);

      // Send the email
      const info = await transporter.sendMail({
        from,
        to,
        subject,
        html,
        text: this.stripHtml(html) // Plain text version
      });

      logger.info(`Email sent: ${info.messageId}`);
      return info;
    } catch (error) {
      logger.error('Failed to send email', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  /**
   * Convert HTML to plain text for email clients that don't support HTML
   * @param {string} html - HTML content
   * @returns {string} Plain text content
   */
  stripHtml(html) {
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/\s+/g, ' ')    // Replace multiple spaces with single space
      .trim();
  }

  /**
   * Send a welcome email to a new user
   * @param {Object} user - User object with email, name
   * @param {string} verificationUrl - Email verification URL
   * @returns {Promise<Object>} Email send information
   */
  async sendWelcomeEmail(user, verificationUrl) {
    return this.sendTemplatedEmail({
      to: user.email,
      subject: 'Welcome to Our Store',
      template: 'welcome',
      data: {
        name: user.first_name || user.username,
        verificationUrl
      }
    });
  }

  /**
   * Send an email verification link
   * @param {Object} user - User object with email, name
   * @param {string} verificationUrl - Email verification URL
   * @returns {Promise<Object>} Email send information
   */
  async sendVerificationEmail(user, verificationUrl) {
    return this.sendTemplatedEmail({
      to: user.email,
      subject: 'Verify Your Email Address',
      template: 'email-verification',
      data: {
        name: user.first_name || user.username,
        verificationUrl
      }
    });
  }

  /**
   * Send a password reset link
   * @param {Object} user - User object with email, name
   * @param {string} resetUrl - Password reset URL
   * @returns {Promise<Object>} Email send information
   */
  async sendPasswordResetEmail(user, resetUrl) {
    return this.sendTemplatedEmail({
      to: user.email,
      subject: 'Reset Your Password',
      template: 'password-reset',
      data: {
        name: user.first_name || user.username,
        resetUrl
      }
    });
  }

  /**
   * Send order confirmation email
   * @param {Object} user - User who placed the order
   * @param {Object} order - Order details
   * @returns {Promise<Object>} Email send information
   */
  async sendOrderConfirmationEmail(user, order) {
    return this.sendTemplatedEmail({
      to: user.email,
      subject: `Order Confirmation #${order.order_number}`,
      template: 'order-confirmation',
      data: {
        name: user.first_name || user.username,
        order
      }
    });
  }

  /**
   * Send order status update email
   * @param {Object} user - User who placed the order
   * @param {Object} order - Order details
   * @param {string} status - New order status
   * @returns {Promise<Object>} Email send information
   */
  async sendOrderStatusUpdateEmail(user, order, status) {
    return this.sendTemplatedEmail({
      to: user.email,
      subject: `Order #${order.order_number} Status Update`,
      template: 'order-status-update',
      data: {
        name: user.first_name || user.username,
        order,
        status,
        statusMessage: this.getOrderStatusMessage(status)
      }
    });
  }

  /**
   * Get a human-readable message for an order status
   * @param {string} status - Order status
   * @returns {string} Human-readable message
   */
  getOrderStatusMessage(status) {
    const messages = {
      'processing': 'Your order is being processed',
      'shipped': 'Your order has been shipped',
      'delivered': 'Your order has been delivered',
      'cancelled': 'Your order has been cancelled',
      'refunded': 'Your order has been refunded'
    };
    
    return messages[status] || `Your order status is now: ${status}`;
  }
}

module.exports = new EmailService();