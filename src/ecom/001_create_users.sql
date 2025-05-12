-- 001_create_users.sql
-- This migration creates the users table with comprehensive user information
-- Primary key, unique constraints, and indexing for performance

CREATE TABLE users (
    -- UUID as primary key for better security and scalability
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Basic user information with constraints
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    
    -- Additional user details
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    phone_number VARCHAR(20),
    
    -- User roles and status
    role VARCHAR(20) DEFAULT 'customer' 
        CHECK (role IN ('customer', 'admin', 'seller')),
    account_status VARCHAR(20) DEFAULT 'active'
        CHECK (account_status IN ('active', 'suspended', 'banned')),
    
    -- Timestamps for tracking
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE
);

-- Create indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);

-- 002_create_products.sql
-- Detailed product table with inventory management
CREATE TABLE products (
    product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Product identification
    name VARCHAR(255) NOT NULL,
    description TEXT,
    sku VARCHAR(50) UNIQUE NOT NULL,
    
    -- Pricing and inventory
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    stock_quantity INTEGER NOT NULL CHECK (stock_quantity >= 0),
    
    -- Categorization
    category VARCHAR(100),
    brand VARCHAR(100),
    
    -- Additional product details
    weight NUMERIC(8, 2),
    dimensions VARCHAR(100),
    
    -- Status and visibility
    is_active BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for product queries
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_brand ON products(brand);

-- 003_create_orders.sql
-- Comprehensive order management table
CREATE TABLE orders (
    order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- User relationship
    user_id UUID NOT NULL REFERENCES users(user_id),
    
    -- Order details
    order_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
    
    -- Order status tracking
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
    
    -- Shipping information
    shipping_address TEXT NOT NULL,
    billing_address TEXT NOT NULL,
    
    -- Payment details
    payment_method VARCHAR(50),
    payment_status VARCHAR(20) 
        CHECK (payment_status IN ('pending', 'paid', 'failed'))
);

-- Order items to track individual products in an order
CREATE TABLE order_items (
    order_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(order_id),
    product_id UUID NOT NULL REFERENCES products(product_id),
    
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    item_price NUMERIC(10, 2) NOT NULL CHECK (item_price >= 0),
    
    -- Allows tracking of product details at time of purchase
    product_snapshot JSONB
);

-- Indexes for order-related queries
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

-- Sample Complex Query Demonstrations

-- 1. Find top-selling products in the last 30 days
SELECT 
    p.product_id,
    p.name,
    SUM(oi.quantity) as total_quantity_sold,
    SUM(oi.quantity * oi.item_price) as total_revenue
FROM 
    products p
JOIN 
    order_items oi ON p.product_id = oi.product_id
JOIN 
    orders o ON oi.order_id = o.order_id
WHERE 
    o.order_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY 
    p.product_id, p.name
ORDER BY 
    total_quantity_sold DESC
LIMIT 10;

-- 2. Get user order history with product details
SELECT 
    u.user_id,
    u.username,
    o.order_id,
    o.order_date,
    o.total_amount,
    o.status,
    json_agg(
        json_build_object(
            'product_name', p.name,
            'quantity', oi.quantity,
            'item_price', oi.item_price
        )
    ) as order_items
FROM 
    users u
JOIN 
    orders o ON u.user_id = o.user_id
JOIN 
    order_items oi ON o.order_id = oi.order_id
JOIN 
    products p ON oi.product_id = p.product_id
GROUP BY 
    u.user_id, u.username, o.order_id, o.order_date, o.total_amount, o.status
ORDER BY 
    o.order_date DESC;

-- 3. Inventory management query
SELECT 
    category,
    COUNT(*) as total_products,
    SUM(stock_quantity) as total_stock,
    AVG(price) as average_price
FROM 
    products
WHERE 
    is_active = TRUE
GROUP BY 
    category
HAVING 
    SUM(stock_quantity) > 0
ORDER BY 
    total_stock DESC;

-- Additional Advanced Queries for Learning

-- Find users who haven't placed an order in the last 6 months
SELECT 
    u.user_id,
    u.username,
    u.email,
    u.last_login
FROM 
    users u
LEFT JOIN 
    orders o ON u.user_id = o.user_id AND o.order_date >= CURRENT_DATE - INTERVAL '6 months'
WHERE 
    o.order_id IS NULL;

-- Calculate total revenue per month
SELECT 
    DATE_TRUNC('month', order_date) as month,
    SUM(total_amount) as monthly_revenue,
    COUNT(order_id) as total_orders
FROM 
    orders
WHERE 
    status != 'cancelled'
GROUP BY 
    month
ORDER BY 
    month DESC;