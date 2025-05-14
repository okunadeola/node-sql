/**
 * User routes
 */
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validation');
const rateLimiter = require('../middleware/rateLimiter');

// Stricter rate limiting for authentication endpoints
const authRateLimiter = rateLimiter({
  maxRequests: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  keyPrefix: 'auth_api'
});

// Standard rate limiting for other user endpoints
router.use(rateLimiter({
  maxRequests: 60,
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: 'user_api'
}));

// Authentication routes
router.post('/register', authRateLimiter, validate.registration, userController.register);
router.post('/login', authRateLimiter, validate.login, userController.login);
router.post('/logout', userController.logout);
router.post('/refresh-token', authRateLimiter, userController.refreshToken);
router.post('/forgot-password', authRateLimiter, validate.email, userController.forgotPassword);
router.post('/reset-password', authRateLimiter, validate.resetPassword, userController.resetPassword);

// User profile routes - require authentication
router.get('/profile', auth.requireAuth, userController.getUserProfile);
router.put('/profile', auth.requireAuth, validate.userProfile, userController.updateUserProfile);
router.put('/password', auth.requireAuth, validate.changePassword, userController.changePassword);

// Address management
router.get('/addresses', auth.requireAuth, userController.getUserAddresses);
router.post('/addresses', auth.requireAuth, validate.address, userController.addUserAddress);
router.put('/addresses/:addressId', auth.requireAuth, validate.address, userController.updateUserAddress);
router.delete('/addresses/:addressId', auth.requireAuth, userController.deleteUserAddress);
router.put('/addresses/:addressId/default', auth.requireAuth, userController.setDefaultAddress);

// Wishlist management
router.get('/wishlists', auth.requireAuth, userController.getWishlists);
router.post('/wishlists', auth.requireAuth, validate.wishlist, userController.createWishlist);
router.put('/wishlists/:wishlistId', auth.requireAuth, validate.wishlist, userController.updateWishlist);
router.delete('/wishlists/:wishlistId', auth.requireAuth, userController.deleteWishlist);
router.post('/wishlists/:wishlistId/products/:productId', auth.requireAuth, userController.addProductToWishlist);
router.delete('/wishlists/:wishlistId/products/:productId', auth.requireAuth, userController.removeProductFromWishlist);

// Admin user management routes
router.get('/', auth.requireAuth, auth.requireRole('admin'), userController.getAllUsers);
router.get('/:userId', auth.requireAuth, auth.requireRole('admin'), userController.getUserById);
router.put('/:userId', auth.requireAuth, auth.requireRole('admin'), validate.userAdmin, userController.updateUser);
router.put('/:userId/status', auth.requireAuth, auth.requireRole('admin'), validate.userStatus, userController.updateUserStatus);
router.delete('/:userId', auth.requireAuth, auth.requireRole('admin'), userController.deleteUser);

// API token management
router.get('/tokens', auth.requireAuth, userController.getApiTokens);
router.post('/tokens', auth.requireAuth, validate.apiToken, userController.createApiToken);
router.delete('/tokens/:tokenId', auth.requireAuth, userController.revokeApiToken);

// Email verification
router.post('/verify-email', authRateLimiter, validate.verificationToken, userController.verifyEmail);
router.post('/resend-verification', authRateLimiter, validate.email, userController.resendVerificationEmail);

module.exports = router;