const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, authorize } = require('../middleware/auth');
const { validateUser } = require('../middleware/validation');

// Public routes
router.post('/register', validateUser, userController.register);
// router.post('/login', userController.login);
// router.post('/refresh-token', userController.refreshToken);

// // Protected routes
// router.use(authenticate);

// router.route('/me')
//   .get(userController.getProfile)
//   .put(validateUser, userController.updateProfile)
//   .delete(userController.deleteAccount);

// router.get('/addresses', userController.getAddresses);
// router.post('/addresses', userController.addAddress);
// router.patch('/addresses/:id', userController.updateAddress);

// // Admin-only routes
// router.use(authorize('admin'));

// router.get('/', userController.getAllUsers);
// router.get('/:id', userController.getUserById);
// router.patch('/:id/status', userController.updateUserStatus);

module.exports = router;