/**
 * Unified Error Code System for Kysera Ecosystem
 *
 * Error code format: `CATEGORY_SUBCATEGORY_SPECIFIC`
 *
 * Categories:
 * - DB: Database-related errors
 * - VALIDATION: Validation and constraint errors
 * - MIGRATION: Migration-related errors
 * - PLUGIN: Plugin system errors
 * - AUDIT: Audit system errors
 * - CONFIG: Configuration errors
 * - NETWORK: Network and connection errors
 *
 * @example
 * ```typescript
 * import { ErrorCodes } from '@kysera/core';
 *
 * throw new DatabaseError('Connection failed', ErrorCodes.DB_CONNECTION_FAILED);
 * ```
 */

// ============================================================================
// Database Error Codes
// ============================================================================

/**
 * Database error codes
 */
export const DatabaseErrorCodes = {
  /** Database connection failed */
  DB_CONNECTION_FAILED: 'DB_CONNECTION_FAILED',
  /** Database query execution failed */
  DB_QUERY_FAILED: 'DB_QUERY_FAILED',
  /** Database transaction failed */
  DB_TRANSACTION_FAILED: 'DB_TRANSACTION_FAILED',
  /** Database timeout occurred */
  DB_TIMEOUT: 'DB_TIMEOUT',
  /** Database pool exhausted */
  DB_POOL_EXHAUSTED: 'DB_POOL_EXHAUSTED',
  /** Unknown database error */
  DB_UNKNOWN: 'DB_UNKNOWN',
} as const;

// ============================================================================
// Validation Error Codes
// ============================================================================

/**
 * Validation and constraint error codes
 */
export const ValidationErrorCodes = {
  /** Unique constraint violation */
  VALIDATION_UNIQUE_VIOLATION: 'VALIDATION_UNIQUE_VIOLATION',
  /** Foreign key constraint violation */
  VALIDATION_FOREIGN_KEY_VIOLATION: 'VALIDATION_FOREIGN_KEY_VIOLATION',
  /** Not null constraint violation */
  VALIDATION_NOT_NULL_VIOLATION: 'VALIDATION_NOT_NULL_VIOLATION',
  /** Check constraint violation */
  VALIDATION_CHECK_VIOLATION: 'VALIDATION_CHECK_VIOLATION',
  /** Invalid input data */
  VALIDATION_INVALID_INPUT: 'VALIDATION_INVALID_INPUT',
  /** Required field missing */
  VALIDATION_REQUIRED_FIELD: 'VALIDATION_REQUIRED_FIELD',
  /** Invalid type */
  VALIDATION_INVALID_TYPE: 'VALIDATION_INVALID_TYPE',
} as const;

// ============================================================================
// Resource Error Codes
// ============================================================================

/**
 * Resource error codes
 */
export const ResourceErrorCodes = {
  /** Resource not found */
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  /** Resource already exists */
  RESOURCE_ALREADY_EXISTS: 'RESOURCE_ALREADY_EXISTS',
  /** Resource conflict */
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  /** Bad request */
  RESOURCE_BAD_REQUEST: 'RESOURCE_BAD_REQUEST',
} as const;

// ============================================================================
// Migration Error Codes
// ============================================================================

/**
 * Migration error codes
 */
export const MigrationErrorCodes = {
  /** Migration up operation failed */
  MIGRATION_UP_FAILED: 'MIGRATION_UP_FAILED',
  /** Migration down/rollback operation failed */
  MIGRATION_DOWN_FAILED: 'MIGRATION_DOWN_FAILED',
  /** Migration validation failed */
  MIGRATION_VALIDATION_FAILED: 'MIGRATION_VALIDATION_FAILED',
  /** Migration not found */
  MIGRATION_NOT_FOUND: 'MIGRATION_NOT_FOUND',
  /** Duplicate migration name */
  MIGRATION_DUPLICATE_NAME: 'MIGRATION_DUPLICATE_NAME',
  /** Migration lock acquisition failed */
  MIGRATION_LOCK_FAILED: 'MIGRATION_LOCK_FAILED',
  /** Migration already executed */
  MIGRATION_ALREADY_EXECUTED: 'MIGRATION_ALREADY_EXECUTED',
} as const;

// ============================================================================
// Plugin Error Codes
// ============================================================================

/**
 * Plugin error codes
 */
export const PluginErrorCodes = {
  /** Plugin validation failed */
  PLUGIN_VALIDATION_FAILED: 'PLUGIN_VALIDATION_FAILED',
  /** Plugin initialization failed */
  PLUGIN_INIT_FAILED: 'PLUGIN_INIT_FAILED',
  /** Plugin conflict detected */
  PLUGIN_CONFLICT: 'PLUGIN_CONFLICT',
  /** Plugin dependency not found */
  PLUGIN_DEPENDENCY_MISSING: 'PLUGIN_DEPENDENCY_MISSING',
  /** Duplicate plugin */
  PLUGIN_DUPLICATE: 'PLUGIN_DUPLICATE',
  /** Plugin not found */
  PLUGIN_NOT_FOUND: 'PLUGIN_NOT_FOUND',
} as const;

// ============================================================================
// Audit Error Codes
// ============================================================================

/**
 * Audit error codes
 */
export const AuditErrorCodes = {
  /** Audit log not found */
  AUDIT_LOG_NOT_FOUND: 'AUDIT_LOG_NOT_FOUND',
  /** Cannot restore from this operation type */
  AUDIT_RESTORE_NOT_SUPPORTED: 'AUDIT_RESTORE_NOT_SUPPORTED',
  /** Old values not captured */
  AUDIT_OLD_VALUES_MISSING: 'AUDIT_OLD_VALUES_MISSING',
  /** Audit table creation failed */
  AUDIT_TABLE_CREATION_FAILED: 'AUDIT_TABLE_CREATION_FAILED',
} as const;

// ============================================================================
// Configuration Error Codes
// ============================================================================

/**
 * Configuration error codes
 */
export const ConfigErrorCodes = {
  /** Configuration file not found */
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  /** Configuration validation failed */
  CONFIG_VALIDATION_FAILED: 'CONFIG_VALIDATION_FAILED',
  /** Configuration parse error */
  CONFIG_PARSE_ERROR: 'CONFIG_PARSE_ERROR',
  /** Missing required configuration */
  CONFIG_REQUIRED_MISSING: 'CONFIG_REQUIRED_MISSING',
  /** Invalid configuration value */
  CONFIG_INVALID_VALUE: 'CONFIG_INVALID_VALUE',
} as const;

// ============================================================================
// File System Error Codes
// ============================================================================

/**
 * File system error codes
 */
export const FileSystemErrorCodes = {
  /** File not found */
  FS_FILE_NOT_FOUND: 'FS_FILE_NOT_FOUND',
  /** Permission denied */
  FS_PERMISSION_DENIED: 'FS_PERMISSION_DENIED',
  /** Directory not found */
  FS_DIRECTORY_NOT_FOUND: 'FS_DIRECTORY_NOT_FOUND',
  /** File already exists */
  FS_FILE_EXISTS: 'FS_FILE_EXISTS',
  /** Write operation failed */
  FS_WRITE_FAILED: 'FS_WRITE_FAILED',
  /** Read operation failed */
  FS_READ_FAILED: 'FS_READ_FAILED',
} as const;

// ============================================================================
// Network Error Codes
// ============================================================================

/**
 * Network error codes
 */
export const NetworkErrorCodes = {
  /** Connection refused */
  NETWORK_CONNECTION_REFUSED: 'NETWORK_CONNECTION_REFUSED',
  /** Connection timeout */
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  /** DNS resolution failed */
  NETWORK_DNS_FAILED: 'NETWORK_DNS_FAILED',
  /** SSL/TLS error */
  NETWORK_SSL_ERROR: 'NETWORK_SSL_ERROR',
} as const;

// ============================================================================
// Combined Error Codes
// ============================================================================

/**
 * All error codes combined
 */
export const ErrorCodes = {
  ...DatabaseErrorCodes,
  ...ValidationErrorCodes,
  ...ResourceErrorCodes,
  ...MigrationErrorCodes,
  ...PluginErrorCodes,
  ...AuditErrorCodes,
  ...ConfigErrorCodes,
  ...FileSystemErrorCodes,
  ...NetworkErrorCodes,
} as const;

/**
 * Type for all error codes
 */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Type guard to check if a string is a valid error code
 */
export function isValidErrorCode(code: string): code is ErrorCode {
  return Object.values(ErrorCodes).includes(code as ErrorCode);
}

/**
 * Get error category from error code
 * @param code - The error code
 * @returns The category prefix (e.g., 'DB', 'VALIDATION', 'MIGRATION')
 */
export function getErrorCategory(code: string): string {
  const match = code.match(/^([A-Z]+)_/);
  return match?.[1] ?? 'UNKNOWN';
}

// ============================================================================
// Legacy Code Mapping (for backwards compatibility)
// ============================================================================

/**
 * Maps legacy error codes to new unified codes
 * This helps migrate existing code without breaking changes
 */
export const LegacyCodeMapping: Record<string, ErrorCode> = {
  // Database legacy codes
  UNIQUE_VIOLATION: ErrorCodes.VALIDATION_UNIQUE_VIOLATION,
  FOREIGN_KEY_VIOLATION: ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION,
  NOT_FOUND: ErrorCodes.RESOURCE_NOT_FOUND,
  BAD_REQUEST: ErrorCodes.RESOURCE_BAD_REQUEST,

  // PostgreSQL codes
  '23505': ErrorCodes.VALIDATION_UNIQUE_VIOLATION,
  '23503': ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION,
  '23502': ErrorCodes.VALIDATION_NOT_NULL_VIOLATION,
  '23514': ErrorCodes.VALIDATION_CHECK_VIOLATION,

  // MySQL codes
  ER_DUP_ENTRY: ErrorCodes.VALIDATION_UNIQUE_VIOLATION,
  ER_DUP_KEY: ErrorCodes.VALIDATION_UNIQUE_VIOLATION,
  ER_NO_REFERENCED_ROW: ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION,
  ER_NO_REFERENCED_ROW_2: ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION,
  ER_BAD_NULL_ERROR: ErrorCodes.VALIDATION_NOT_NULL_VIOLATION,

  // SQLite codes (parsed from message)
  SQLITE_CONSTRAINT: ErrorCodes.VALIDATION_CHECK_VIOLATION,

  // CLI legacy codes
  E001: ErrorCodes.DB_CONNECTION_FAILED,
  E002: ErrorCodes.MIGRATION_UP_FAILED,
  E003: ErrorCodes.CONFIG_VALIDATION_FAILED,
  E004: ErrorCodes.PLUGIN_VALIDATION_FAILED,
  E005: ErrorCodes.FS_WRITE_FAILED,

  // Migration legacy codes
  MIGRATION_UP_FAILED: ErrorCodes.MIGRATION_UP_FAILED,
  MIGRATION_DOWN_FAILED: ErrorCodes.MIGRATION_DOWN_FAILED,
  MIGRATION_VALIDATION_FAILED: ErrorCodes.MIGRATION_VALIDATION_FAILED,
};

/**
 * Convert legacy error code to unified error code
 * @param legacyCode - The legacy error code
 * @returns The unified error code, or the original code if no mapping exists
 */
export function mapLegacyCode(legacyCode: string): ErrorCode | string {
  return LegacyCodeMapping[legacyCode] ?? legacyCode;
}
