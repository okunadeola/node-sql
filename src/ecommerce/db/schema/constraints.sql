-- constraints.sql: Additional constraints for e-commerce database
-- This file adds foreign key constraints, check constraints, and unique constraints
-- to maintain data integrity in the e-commerce application

-- Users Table Constraints
ALTER TABLE users
    ADD CONSTRAINT chk_user_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- Categories Table Constraints
-- Prevent a category from being its own parent
ALTER TABLE categories
    ADD CONSTRAINT chk_category_parent_not_self CHECK (category_id != parent_id);

-- Products Table Constraints
ALTER TABLE products
    ADD CONSTRAINT chk_product_prices CHECK (
        (compare_price IS NULL OR compare_price >= price) AND
        (cost_price IS NULL OR price >= cost_price)
    );

-- Product Images Table Constraints
-- Ensure only one primary image per product
CREATE UNIQUE INDEX idx_product_images_primary ON product_images (product_id) 
    WHERE is_primary = TRUE;

-- Inventory Table Constraints
ALTER TABLE inventory
    ADD CONSTRAINT chk_inventory_quantities CHECK (
        quantity >= reserved_quantity
    );

-- Shopping Carts Table Constraints
-- Ensure cart has a valid owner (either user_id or session_id)
ALTER TABLE shopping_carts
    ADD CONSTRAINT chk_cart_owner CHECK (
        (user_id IS NOT NULL) OR (session_id IS NOT NULL)
    );

-- Cart Items Table Constraints
-- Ensure unique product in cart (no duplicates)
CREATE UNIQUE INDEX idx_cart_items_unique_product ON cart_items (cart_id, product_id);

-- Orders Table Constraints
ALTER TABLE orders
    ADD CONSTRAINT chk_order_amounts CHECK (
        total_amount = subtotal + tax_amount + shipping_amount - discount_amount
    );

-- Order Items Table Constraints
ALTER TABLE order_items
    ADD CONSTRAINT chk_order_item_amounts CHECK (
        total = (unit_price * quantity) + tax_amount - discount_amount
    );

-- Payments Table Constraints
-- Ensure payment amount is not negative
ALTER TABLE payments
    ADD CONSTRAINT chk_payment_amount_positive CHECK (amount > 0);

-- Product Reviews Table Constraints
-- Prevent multiple reviews by same user for same product
CREATE UNIQUE INDEX idx_product_reviews_user_product ON product_reviews (user_id, product_id);

-- Wishlist Table Constraints
-- Ensure user can't have duplicate wishlist names
CREATE UNIQUE INDEX idx_wishlists_user_name ON wishlists (user_id, name);

-- Wishlist Items Table Constraints
-- Prevent duplicate products in same wishlist
CREATE UNIQUE INDEX idx_wishlist_items_unique_product ON wishlist_items (wishlist_id, product_id);

-- Discounts Table Constraints
ALTER TABLE discounts
    ADD CONSTRAINT chk_discount_dates CHECK (
        starts_at < ends_at
    );

ALTER TABLE discounts
    ADD CONSTRAINT chk_discount_value CHECK (
        (type = 'percentage' AND value BETWEEN 0 AND 100) OR
        (type != 'percentage' AND value >= 0) OR
        (type = 'free_shipping' AND value IS NULL)
    );

-- User Addresses Table Constraints
-- Ensure each user has only one default address per type
CREATE UNIQUE INDEX idx_user_addresses_default_shipping ON user_addresses (user_id) 
    WHERE is_default = TRUE AND (address_type = 'shipping' OR address_type = 'both');

CREATE UNIQUE INDEX idx_user_addresses_default_billing ON user_addresses (user_id) 
    WHERE is_default = TRUE AND (address_type = 'billing' OR address_type = 'both');

-- Notification Templates Table Constraints
-- Enforce unique template names
ALTER TABLE notification_templates
    ADD CONSTRAINT unique_template_name UNIQUE (name);

-- API Tokens Table Constraints
-- Ensure unique tokens
ALTER TABLE api_tokens
    ADD CONSTRAINT unique_api_token UNIQUE (token);

-- Product Tags Table Constraints
-- Unique tags by name and slug
ALTER TABLE tags
    ADD CONSTRAINT unique_tag_name UNIQUE (name),
    ADD CONSTRAINT unique_tag_slug UNIQUE (slug);

-- Add referential integrity constraints with proper cascade behavior

-- Ensure category hierarchy integrity on delete
ALTER TABLE categories
    DROP CONSTRAINT IF EXISTS categories_parent_id_fkey,
    ADD CONSTRAINT categories_parent_id_fkey 
        FOREIGN KEY (parent_id) 
        REFERENCES categories(category_id) 
        ON DELETE SET NULL;

-- Ensure product-category integrity
ALTER TABLE products
    DROP CONSTRAINT IF EXISTS products_category_id_fkey,
    ADD CONSTRAINT products_category_id_fkey 
        FOREIGN KEY (category_id) 
        REFERENCES categories(category_id) 
        ON DELETE SET NULL;

-- Ensure seller integrity
ALTER TABLE products
    DROP CONSTRAINT IF EXISTS products_seller_id_fkey,
    ADD CONSTRAINT products_seller_id_fkey 
        FOREIGN KEY (seller_id) 
        REFERENCES users(user_id) 
        ON DELETE SET NULL;



-- -- Add trigger to prevent deletion of categories with products
-- CREATE OR REPLACE FUNCTION prevent_category_deletion_with_products()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     IF EXISTS (SELECT 1 FROM products WHERE category_id = OLD.category_id) THEN
--         RAISE EXCEPTION 'Cannot delete category with associated products';
--     END IF;
--     RETURN OLD;
-- END;
-- $$ LANGUAGE plpgsql;

-- -- Create the trigger
-- CREATE TRIGGER prevent_category_deletion 
--     BEFORE DELETE ON categories 
--     FOR EACH ROW 
--     EXECUTE FUNCTION prevent_category_deletion_with_products();

-- -- Create a product status history table (needed for the trigger below)
-- CREATE TABLE IF NOT EXISTS product_status_history (
--     history_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--     product_id UUID NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
--     previous_status VARCHAR(30),
--     new_status VARCHAR(30) NOT NULL,
--     reason TEXT,
--     changed_by UUID REFERENCES users(user_id),
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- -- Add status column to products table (since it's referenced in triggers but doesn't exist)
-- ALTER TABLE products ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'active' 
--     CHECK (status IN ('active', 'inactive', 'out_of_stock', 'discontinued'));

-- -- Add trigger to update product status when inventory is zero
-- CREATE OR REPLACE FUNCTION update_product_status_on_inventory_change()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     IF NEW.quantity = 0 AND (OLD.quantity IS NULL OR NEW.quantity != OLD.quantity) THEN
--         -- Create a product status history record
--         INSERT INTO product_status_history (
--             product_id, 
--             previous_status, 
--             new_status, 
--             reason,
--             changed_by
--         )
--         SELECT 
--             NEW.product_id,
--             p.status,
--             'out_of_stock',
--             'Automatic update - zero inventory',
--             NULL
--         FROM products p
--         WHERE p.product_id = NEW.product_id;
        
--         -- Update the product status
--         UPDATE products 
--         SET status = 'out_of_stock', updated_at = CURRENT_TIMESTAMP
--         WHERE product_id = NEW.product_id AND status != 'out_of_stock';
--     END IF;
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

-- CREATE TRIGGER update_product_status_on_inventory_trigger
--     AFTER UPDATE ON inventory
--     FOR EACH ROW
--     WHEN (NEW.quantity IS DISTINCT FROM OLD.quantity)
--     EXECUTE FUNCTION update_product_status_on_inventory_change();

-- -- Add trigger to update order total on order item changes
-- CREATE OR REPLACE FUNCTION update_order_totals()
-- RETURNS TRIGGER AS $$
-- DECLARE
--     order_id_val UUID;
--     new_subtotal DECIMAL(10, 2);
--     tax_total DECIMAL(10, 2);
--     discount_total DECIMAL(10, 2);
--     shipping_amt DECIMAL(10, 2);
-- BEGIN
--     -- Determine the order_id based on the operation
--     IF TG_OP = 'DELETE' THEN
--         order_id_val := OLD.order_id;
--     ELSE
--         order_id_val := NEW.order_id;
--     END IF;
    
--     -- Calculate new subtotal from order items
--     SELECT 
--         COALESCE(SUM(subtotal), 0),
--         COALESCE(SUM(tax_amount), 0),
--         COALESCE(SUM(discount_amount), 0)
--     INTO new_subtotal, tax_total, discount_total
--     FROM order_items
--     WHERE order_id = order_id_val;
    
--     -- Get shipping amount (remains unchanged)
--     SELECT shipping_amount INTO shipping_amt
--     FROM orders
--     WHERE order_id = order_id_val;
    
--     -- Update order totals
--     UPDATE orders
--     SET 
--         subtotal = new_subtotal,
--         tax_amount = tax_total,
--         discount_amount = discount_total,
--         total_amount = new_subtotal + tax_total + shipping_amt - discount_total,
--         updated_at = CURRENT_TIMESTAMP
--     WHERE order_id = order_id_val;
    
--     IF TG_OP = 'DELETE' THEN
--         RETURN OLD;
--     ELSE
--         RETURN NEW;
--     END IF;
-- END;
-- $$ LANGUAGE plpgsql;

-- CREATE TRIGGER update_order_totals_trigger
--     AFTER INSERT OR UPDATE OR DELETE ON order_items
--     FOR EACH ROW 
--     EXECUTE FUNCTION update_order_totals();

-- -- Add trigger to create order history on status change
-- CREATE OR REPLACE FUNCTION track_order_status_changes()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     IF NEW.status IS DISTINCT FROM OLD.status THEN
--         INSERT INTO order_history (
--             order_id,
--             status,
--             comment,
--             created_by
--         ) VALUES (
--             NEW.order_id,
--             NEW.status,
--             'Status changed from ' || OLD.status || ' to ' || NEW.status,
--             NULL
--         );
--     END IF;
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

-- CREATE TRIGGER track_order_status_changes_trigger
--     AFTER UPDATE ON orders
--     FOR EACH ROW
--     WHEN (NEW.status IS DISTINCT FROM OLD.status)
--     EXECUTE FUNCTION track_order_status_changes();

-- -- Add trigger to reserve inventory when adding to cart
-- CREATE OR REPLACE FUNCTION reserve_inventory_for_cart()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     -- Update inventory reserved quantity
--     UPDATE inventory
--     SET 
--         reserved_quantity = reserved_quantity + NEW.quantity,
--         updated_at = CURRENT_TIMESTAMP
--     WHERE product_id = NEW.product_id;
    
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;