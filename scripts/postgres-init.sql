-- PostgreSQL initialization script for tests

-- Create test schema with proper permissions
CREATE SCHEMA IF NOT EXISTS test_schema;
GRANT ALL ON SCHEMA test_schema TO test;

-- Enable extensions for advanced features
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create test user with proper permissions
GRANT CREATE ON DATABASE kysera_test TO test;
GRANT ALL ON SCHEMA public TO test;

-- Set default search path
ALTER DATABASE kysera_test SET search_path TO public, test_schema;

-- Create performance monitoring table
CREATE TABLE IF NOT EXISTS query_performance (
    id SERIAL PRIMARY KEY,
    query_hash TEXT NOT NULL,
    execution_time_ms NUMERIC(10,2),
    rows_affected INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on performance table
CREATE INDEX idx_query_performance_hash ON query_performance(query_hash);
CREATE INDEX idx_query_performance_created ON query_performance(created_at);

-- Grant permissions on performance table
GRANT ALL ON query_performance TO test;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO test;