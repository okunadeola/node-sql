// server/src/controllers/userController.js
const { query } = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { validateUser } = require('../middleware/validation');

// Helper function to generate JWT
const generateToken = (userId, role) => {
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
};

// User Registration
const register = async (req, res) => {
  try {
    const { username, email, password, role = 'customer' } = req.body;
    
    // Check if user exists
    const existingUser = await query(
      'SELECT * FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        status: 'fail',
        message: 'User already exists with this email or username'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Create user
    const newUser = await query(
      `INSERT INTO users (
        user_id, username, email, password_hash, role
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING user_id, username, email, role, created_at`,
      [uuidv4(), username, email, hashedPassword, role]
    );

    // Generate JWT
    const token = generateToken(
      newUser.rows[0].user_id,
      newUser.rows[0].role
    );

    res.status(201).json({
      status: 'success',
      token,
      data: newUser.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Registration failed'
    });
  }
};

// User Login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // 1. Check if user exists
    const user = await query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    if (!user.rows[0] || !(await bcrypt.compare(password, user.rows[0].password_hash))) {
      return res.status(401).json({
        status: 'fail',
        message: 'Invalid credentials'
      });
    }

    // 2. Check account status
    if (user.rows[0].account_status !== 'active') {
      return res.status(403).json({
        status: 'fail',
        message: 'Account is suspended'
      });
    }

    // 3. Generate JWT
    const token = generateToken(
      user.rows[0].user_id,
      user.rows[0].role
    );

    // 4. Update last login
    await query(
      'UPDATE users SET last_login = NOW() WHERE user_id = $1',
      [user.rows[0].user_id]
    );

    res.json({
      status: 'success',
      token,
      data: {
        user_id: user.rows[0].user_id,
        username: user.rows[0].username,
        role: user.rows[0].role
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Login failed'
    });
  }
};

// Get User Profile
const getProfile = async (req, res) => {
  try {
    const { userId } = req.user;
    
    const user = await query(
      `SELECT user_id, username, email, first_name, last_name, 
       phone, address, role, created_at, last_login
       FROM users WHERE user_id = $1`,
      [userId]
    );

    res.json({
      status: 'success',
      data: user.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch profile'
    });
  }
};

// Update Profile
const updateProfile = async (req, res) => {
  try {
    const { userId } = req.user;
    const updates = req.body;
    
    const updateFields = [];
    const values = [];
    let paramCount = 1;

    // Build dynamic update query
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'password') {
        const hashedPassword = await bcrypt.hash(value, 12);
        updateFields.push(`password_hash = $${paramCount}`);
        values.push(hashedPassword);
        paramCount++;
      } else if (key !== 'role' && key !== 'user_id') {
        updateFields.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        status: 'fail',
        message: 'No valid fields to update'
      });
    }

    const result = await query(
      `UPDATE users
       SET ${updateFields.join(', ')}, updated_at = NOW()
       WHERE user_id = $${paramCount}
       RETURNING user_id, username, email, first_name, last_name, phone, address`,
      [...values, userId]
    );

    res.json({
      status: 'success',
      data: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Profile update failed'
    });
  }
};

// Admin: Get All Users
const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;

    const users = await query(
      `SELECT user_id, username, email, role, account_status, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const total = await query('SELECT COUNT(*) FROM users');

    res.json({
      status: 'success',
      data: users.rows,
      pagination: {
        page,
        limit,
        total: parseInt(total.rows[0].count)
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch users'
    });
  }
};

// Address Management
const addAddress = async (req, res) => {
  try {
    const { userId } = req.user;
    const addressData = req.body;

    const result = await query(
      `INSERT INTO user_addresses (
        user_id, address_type, first_name, last_name, 
        address_line1, city, postal_code, country
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        addressData.address_type,
        addressData.first_name,
        addressData.last_name,
        addressData.address_line1,
        addressData.city,
        addressData.postal_code,
        addressData.country
      ]
    );

    res.status(201).json({
      status: 'success',
      data: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to add address'
    });
  }
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  getAllUsers,
  addAddress,
  // Add other methods as needed
};