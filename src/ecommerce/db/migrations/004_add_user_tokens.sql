-- server/src/db/migrations/004_add_user_tokens.sql
-- User tokens table for email verification and password reset
CREATE TABLE user_tokens (
  token_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('email_verification', 'password_reset', 'api_token')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMP WITH TIME ZONE
);

-- Add email_verified field to users table
ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;