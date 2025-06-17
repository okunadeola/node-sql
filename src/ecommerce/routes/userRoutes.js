/**
 * User routes
 */
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validation');
const {  Redis } = require('ioredis');
const { RateLimiterRedis } = require('rate-limiter-flexible');
const logger = require('../utils/logger');

// Stricter rate limiting for authentication endpoints
//DDos protection and rate limiting
const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const rateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: "middleware",
  points: 10, // 10 attempts
  duration: 5 * 60, // 5 minutes
});

const authRateLimiter =((req, res, next) => {
  rateLimiter
    .consume(req.ip)
    .then(() => next())
    .catch(() => {
      logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
      res.status(429).json({ success: false, message: "Too many requests" });
    });
});



// Authentication routes
router.post('/register', authRateLimiter, validate.createUser, userController.register);
router.post('/login', authRateLimiter, validate.loginUser, userController.login);
router.post('/logout', userController.logout);
router.post('/refresh-token', authRateLimiter, userController.refreshToken);
router.post('/forgot-password', authRateLimiter, validate.email, userController.forgotPassword);
router.post('/reset-password', authRateLimiter, validate.resetPassword, userController.resetPassword);

// User profile routes - require authentication
router.get('/profile', auth.protect, userController.getUserProfile);
router.put('/update-profile', auth.protect, validate.userProfile, userController.updateUserProfile);
router.put('/password', auth.protect, validate.changePassword, userController.changePassword);

// Address management
router.get('/addresses', auth.protect, userController.getUserAddresses);
router.post('/addresses', auth.protect, validate.address, userController.addUserAddress);
router.put('/addresses/:addressId', auth.protect, validate.address, userController.updateUserAddress);
router.delete('/addresses/:addressId', auth.protect, userController.deleteUserAddress);
router.put('/addresses/:addressId/default', auth.protect, userController.setDefaultAddress);

// Wishlist management
router.get('/wishlists', auth.protect, userController.getWishlists);
router.post('/wishlists', auth.protect, validate.wishlist, userController.createWishlist);
router.put('/wishlists/:wishlistId', auth.protect, validate.wishlist, userController.updateWishlist);
router.delete('/wishlists/:wishlistId', auth.protect, userController.deleteWishlist);
router.post('/wishlists/:wishlistId/products/:productId', auth.protect, userController.addProductToWishlist);
router.delete('/wishlists/:wishlistId/products/:productId', auth.protect, userController.removeProductFromWishlist);

// Admin user management routes
// auth.protect, auth.requireRole('admin'),
router.get('/', authRateLimiter, userController.getAllUsers);
router.get('/:userId', auth.protect, auth.requireRole('admin'), userController.getUserById);
router.put('/:userId', auth.protect, auth.requireRole('admin'), validate.userAdmin, userController.updateUser);
router.put('/:userId/status', auth.protect, auth.requireRole('admin'), validate.userStatus, userController.updateUserStatus);
router.delete('/:userId', auth.protect, auth.requireRole('admin'), userController.deleteUser);

// API token management
// router.get('/tokens', auth.protect, userController.getApiTokens);
// router.post('/tokens', auth.protect, validate.apiToken, userController.createApiToken);
// router.delete('/tokens/:tokenId', auth.protect, userController.revokeApiToken);

// Email verification
router.post('/verify-email', authRateLimiter, validate.verificationToken, userController.verifyEmail);
router.post('/resend-verification', authRateLimiter, validate.email, userController.resendVerificationEmail);

module.exports = router;