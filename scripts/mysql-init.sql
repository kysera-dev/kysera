-- MySQL initialization script for tests

-- Create test database if not exists
CREATE DATABASE IF NOT EXISTS kysera_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kysera_test;

-- Grant all privileges to test user
GRANT ALL PRIVILEGES ON kysera_test.* TO 'test'@'%';
FLUSH PRIVILEGES;

-- Create performance monitoring table
CREATE TABLE IF NOT EXISTS query_performance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    query_hash VARCHAR(255) NOT NULL,
    execution_time_ms DECIMAL(10,2),
    rows_affected INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_query_hash (query_hash),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Set session variables for performance
SET GLOBAL max_connections = 200;
SET GLOBAL innodb_flush_log_at_trx_commit = 2;
SET GLOBAL sync_binlog = 0;