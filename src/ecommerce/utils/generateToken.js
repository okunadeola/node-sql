const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const tokenService = require("../services/tokenService");
const { v4: uuidv4 } = require('uuid');

  /**
   * generateTokens
   * @param {Object} user - User details
   * @returns {Promise<Object>} token
   */

const generateTokens = async (user) => {
  const accessToken = jwt.sign(
    {
      userId: user.user_id,
      username: user.username,
    },
    process.env.JWT_SECRET,
    { expiresIn: "24h" }
  );

  const refreshToken =  await tokenService.createToken(
     user.user_id,
     uuidv4(),
      'api_token',
  );

  return { accessToken, refreshToken };
};

module.exports = generateTokens;
