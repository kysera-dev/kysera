-- Initialize databases for all Kysera examples
-- This script runs automatically when the container starts

-- Create separate databases for each example
CREATE DATABASE blog_app;
CREATE DATABASE ecommerce_app;
CREATE DATABASE multitenant_app;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE blog_app TO kysera;
GRANT ALL PRIVILEGES ON DATABASE ecommerce_app TO kysera;
GRANT ALL PRIVILEGES ON DATABASE multitenant_app TO kysera;
