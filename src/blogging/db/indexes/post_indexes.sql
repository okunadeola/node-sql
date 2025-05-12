-- For full-text search
CREATE INDEX idx_posts_content_search ON posts USING GIN(to_tsvector('english', content));

-- For trending posts (hot score)
CREATE INDEX idx_posts_hot ON posts (EXTRACT(EPOCH FROM created_at) / 100000 + log(greatest(upvotes, 1)));

-- For speeding up queries filtering by user_id + published status
CREATE INDEX IF NOT EXISTS idx_posts_user_published ON posts(user_id, published);