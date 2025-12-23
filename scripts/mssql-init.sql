-- MSSQL/Azure SQL Edge initialization script for tests

-- Create test database if not exists
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'kysera_test')
BEGIN
    CREATE DATABASE kysera_test;
END
GO

USE kysera_test;
GO

-- Create test user with proper permissions
IF NOT EXISTS (SELECT name FROM sys.sql_logins WHERE name = 'test')
BEGIN
    CREATE LOGIN test WITH PASSWORD = 'Test@12345';
END
GO

IF NOT EXISTS (SELECT name FROM sys.database_principals WHERE name = 'test')
BEGIN
    CREATE USER test FOR LOGIN test;
    ALTER ROLE db_owner ADD MEMBER test;
END
GO

-- Create performance monitoring table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[query_performance]') AND type in (N'U'))
BEGIN
    CREATE TABLE query_performance (
        id INT IDENTITY(1,1) PRIMARY KEY,
        query_hash NVARCHAR(255) NOT NULL,
        execution_time_ms DECIMAL(10,2),
        rows_affected INT,
        created_at DATETIME2 DEFAULT GETDATE()
    );

    CREATE INDEX idx_query_performance_hash ON query_performance(query_hash);
    CREATE INDEX idx_query_performance_created ON query_performance(created_at);
END
GO
