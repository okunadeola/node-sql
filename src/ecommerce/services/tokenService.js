// server/src/services/tokenService.js
const crypto = require("crypto");
const db = require("../config/db");
const { logger } = require("../utils/logger");

/**
 * Token Service
 * Handles creating and validating tokens for verification and password reset
 */
class TokenService {
  /**
   * Create a verification token for a user
   * @param {string} userId - User ID
   * @param {string} tokenId - User ID
   * @param {string} type - Token type ('email_verification' or 'password_reset' or "api_token")
   * @returns {Promise<string>} Generated token
   */
  async createToken(userId, tokenId, type) {
    try {
      // Generate a random token
      const token = crypto.randomBytes(32).toString("hex");

      // Calculate expiration date
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Store the token in the database
      await db.query(
        `INSERT INTO user_tokens (token_id, user_id, token, type, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [tokenId, userId, token, type, expiresAt]
      );

      return token;
    } catch (error) {
      logger.error("Failed to create token", error);
      throw new Error("Failed to create token");
    }
  }

  /**
   * Verify a token's validity
   * @param {string} token - Token to verify
   * @param {string} type - Token type ('email_verification' or 'password_reset')
   * @returns {Promise<Object|null>} User ID or null if invalid
   */
  async verifyToken(token, type = 'api_token') {
    try {
      const result = await db.query(
        `SELECT user_id, expires_at
         FROM user_tokens
         WHERE token = $1 AND type = $2 AND used = FALSE`,
        [token, type]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const { user_id, expires_at } = result.rows[0];

      // Check if token has expired
      if (new Date() > new Date(expires_at)) {
        return null;
      }

      return { userId: user_id };
    } catch (error) {
      logger.error("Failed to verify token", error);
      throw new Error("Failed to verify token");
    }
  }

  /**
   * Mark a token as used
   * @param {string} token - Token to mark as used
   * @returns {Promise<boolean>} Success status
   */
  async consumeToken(token) {
    try {
      const result = await db.query(
        `UPDATE user_tokens
         SET used = TRUE, used_at = CURRENT_TIMESTAMP
         WHERE token = $1 AND used = FALSE
         RETURNING token`,
        [token]
      );

      return result.rows.length > 0;
    } catch (error) {
      logger.error("Failed to consume token", error);
      throw new Error("Failed to consume token");
    }
  }

  /**
   * Delete tokens
   * @returns {Promise<number>} Number of deleted tokens
   */
  async revokeToken(userId, token) {
    try {
      const result = await db.query(
        `DELETE FROM user_tokens
         WHERE user_id = $1`,
        [userId, ] //token
      );

      return result.rowCount;
    } catch (error) {
      logger.error("Failed to cleanup expired tokens", error);
      throw new Error("Failed to cleanup expired tokens");
    }
  }
  /**
   * Delete expired tokens
   * @returns {Promise<number>} Number of deleted tokens
   */
  async cleanupExpiredTokens() {
    try {
      const result = await db.query(
        `DELETE FROM user_tokens
         WHERE expires_at < CURRENT_TIMESTAMP
         AND used = FALSE`
      );

      return result.rowCount;
    } catch (error) {
      logger.error("Failed to cleanup expired tokens", error);
      throw new Error("Failed to cleanup expired tokens");
    }
  }
}

module.exports = new TokenService();
