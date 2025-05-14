/**
 * Routes index file
 * Consolidates all route modules
 */
const express = require('express');
const router = express.Router();

// Import route modules
const productRoutes = require('./productRoutes');
const userRoutes = require('./userRoutes');
const orderRoutes = require('./orderRoutes');
const analyticsRoutes = require('./analyticsRoutes');
// const cartRoutes = require('./cartRoutes');
// const categoryRoutes = require('./categoryRoutes');
// const webhookRoutes = require('./webhookRoutes');
// const searchRoutes = require('./searchRoutes');
// const discountRoutes = require('./discountRoutes');

// Map routes to their respective path prefixes
router.use('/products', productRoutes);
router.use('/users', userRoutes);
router.use('/orders', orderRoutes);
router.use('/analytics', analyticsRoutes);
// router.use('/cart', cartRoutes);
// router.use('/categories', categoryRoutes);
// router.use('/webhooks', webhookRoutes);
// router.use('/search', searchRoutes);
// router.use('/discounts', discountRoutes);

// API health check route
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'API is running',
    timestamp: new Date().toISOString(),
    version: process.env.API_VERSION || '1.0.0'
  });
});

// API documentation route
router.get('/docs', (req, res) => {
  res.redirect(process.env.API_DOCS_URL || '/api-docs');
});

module.exports = router;