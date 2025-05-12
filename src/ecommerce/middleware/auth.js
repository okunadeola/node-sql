const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) throw new Error('Authentication required');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verify user exists in database
    const { rows } = await pool.query(
      'SELECT user_id, role, account_status FROM users WHERE user_id = $1',
      [decoded.userId]
    );
    
    if (!rows[0]) throw new Error('User not found');
    if (rows[0].account_status !== 'active') throw new Error('Account suspended');

    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      sessionId: decoded.sessionId
    };
    
    next();
  } catch (error) {
    res.status(401).json({
      status: 'fail',
      message: error.message
    });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        status: 'fail',
        message: 'Unauthorized access'
      });
    }
    next();
  };
};

module.exports = { authenticate, authorize };