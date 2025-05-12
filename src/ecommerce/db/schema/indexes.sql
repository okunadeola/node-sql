-- indexes.sql: Optimized indexes for e-commerce database

-- Users Table Indexes
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_account_status ON users(account_status);
CREATE INDEX idx_users_created_at ON users(created_at);

-- Categories Table Indexes
CREATE INDEX idx_categories_parent_id ON categories(parent_id);
CREATE INDEX idx_categories_is_active ON categories(is_active);

-- Products Table Indexes
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_seller_id ON products(seller_id);
CREATE INDEX idx_products_is_active ON products(is_active);
CREATE INDEX idx_products_is_featured ON products(is_featured);
CREATE INDEX idx_products_price ON products(price);
CREATE INDEX idx_products_created_at ON products(created_at);
-- This index helps with price range searches, a common filter in e-commerce
CREATE INDEX idx_products_price_active_category ON products(price, is_active, category_id);

-- Product Images Table Indexes
CREATE INDEX idx_product_images_product_id ON product_images(product_id);
CREATE INDEX idx_product_images_is_primary ON product_images(is_primary);

-- Product Attributes Table Indexes
CREATE INDEX idx_product_attributes_product_id ON product_attributes(product_id);
CREATE INDEX idx_product_attributes_name ON product_attributes(name);
CREATE INDEX idx_product_attributes_name_value ON product_attributes(name, value);

-- Inventory Table Indexes
CREATE INDEX idx_inventory_product_id ON inventory(product_id);
CREATE INDEX idx_inventory_quantity ON inventory(quantity);
-- Index for low stock alerts
CREATE INDEX idx_inventory_low_stock ON inventory(quantity) WHERE quantity <= low_stock_threshold;

-- Shopping Cart Table Indexes
CREATE INDEX idx_shopping_carts_user_id ON shopping_carts(user_id);
CREATE INDEX idx_shopping_carts_session_id ON shopping_carts(session_id);
CREATE INDEX idx_shopping_carts_created_at ON shopping_carts(created_at);
CREATE INDEX idx_shopping_carts_expires_at ON shopping_carts(expires_at);

-- Cart Items Table Indexes
CREATE INDEX idx_cart_items_cart_id ON cart_items(cart_id);
CREATE INDEX idx_cart_items_product_id ON cart_items(product_id);

-- Orders Table Indexes
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_order_number ON orders(order_number);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_completed_at ON orders(completed_at);
-- Composite index for order analytics
CREATE INDEX idx_orders_status_created_at ON orders(status, created_at);

-- Order Items Table Indexes
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);

-- Payments Table Indexes
CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_payments_transaction_id ON payments(transaction_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_created_at ON payments(created_at);

-- Order History Table Indexes
CREATE INDEX idx_order_history_order_id ON order_history(order_id);
CREATE INDEX idx_order_history_created_at ON order_history(created_at);

-- Product Reviews Table Indexes
CREATE INDEX idx_product_reviews_product_id ON product_reviews(product_id);
CREATE INDEX idx_product_reviews_user_id ON product_reviews(user_id);
CREATE INDEX idx_product_reviews_rating ON product_reviews(rating);
CREATE INDEX idx_product_reviews_status ON product_reviews(status);
-- Index for finding verified purchase reviews
CREATE INDEX idx_product_reviews_verified_purchase ON product_reviews(is_verified_purchase) WHERE is_verified_purchase = TRUE;

-- Wishlist Table Indexes
CREATE INDEX idx_wishlists_user_id ON wishlists(user_id);

-- Wishlist Items Table Indexes
CREATE INDEX idx_wishlist_items_wishlist_id ON wishlist_items(wishlist_id);
CREATE INDEX idx_wishlist_items_product_id ON wishlist_items(product_id);

-- Discounts Table Indexes
CREATE INDEX idx_discounts_code ON discounts(code);
CREATE INDEX idx_discounts_is_active ON discounts(is_active);
CREATE INDEX idx_discounts_date_range ON discounts(starts_at, ends_at);
-- This index helps find valid discounts quickly
CREATE INDEX idx_discounts_active_dates ON discounts(is_active, starts_at, ends_at);

-- User Addresses Table Indexes
CREATE INDEX idx_user_addresses_user_id ON user_addresses(user_id);
CREATE INDEX idx_user_addresses_is_default ON user_addresses(is_default);

-- User Notifications Table Indexes
CREATE INDEX idx_user_notifications_user_id ON user_notifications(user_id);
CREATE INDEX idx_user_notifications_is_read ON user_notifications(is_read);
CREATE INDEX idx_user_notifications_created_at ON user_notifications(created_at);

-- API Tokens Table Indexes
CREATE INDEX idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX idx_api_tokens_token ON api_tokens(token);
CREATE INDEX idx_api_tokens_expires_at ON api_tokens(expires_at);

-- Tags Table Indexes
CREATE INDEX idx_tags_name ON tags(name);
CREATE INDEX idx_tags_slug ON tags(slug);

-- Partial Index for Fast Access to Active Products
CREATE INDEX idx_active_products ON products(product_id) WHERE is_active = TRUE;

-- Full Text Search for Products
-- Enable the extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Create GIN index for full-text search on product names and descriptions
CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);
CREATE INDEX idx_products_description_trgm ON products USING GIN (description gin_trgm_ops);

-- Create a GIN index for JSONB fields
CREATE INDEX idx_product_attributes_jsonb ON product_attributes USING GIN (value jsonb_path_ops) WHERE jsonb_typeof(value) = 'object';
CREATE INDEX idx_order_items_product_data ON order_items USING GIN (product_data);