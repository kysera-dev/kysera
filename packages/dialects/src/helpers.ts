/**
 * Dialect Helper Functions
 *
 * Standalone helper functions that accept dialect as parameter
 * for backward compatibility with existing code.
 */

import type { Kysely } from 'kysely'
import type { Dialect, SchemaOptions, DatabaseErrorLike } from './types.js'
import { getAdapter } from './factory.js'

/**
 * Maximum allowed length for SQL identifiers
 */
const MAX_IDENTIFIER_LENGTH = 128

/**
 * Pattern for valid SQL identifiers
 * Allows alphanumeric, underscore, and dot for schema.table notation
 */
const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.]*$/

/**
 * Validate a SQL identifier (table name, column name, schema name, etc.)
 *
 * @param name - The identifier to validate
 * @returns true if the identifier is valid, false otherwise
 *
 * @example
 * validateIdentifier('users')           // true
 * validateIdentifier('public.users')    // true
 * validateIdentifier('_private_table')  // true
 * validateIdentifier('123invalid')      // false (starts with number)
 * validateIdentifier('table-name')      // false (contains hyphen)
 * validateIdentifier('')                // false (empty)
 */
export function validateIdentifier(name: string): boolean {
  if (!name || name.length > MAX_IDENTIFIER_LENGTH) {
    return false
  }
  return IDENTIFIER_PATTERN.test(name)
}

/**
 * Assert that an identifier is valid, throwing an error if not
 *
 * @param name - The identifier to validate
 * @param context - Optional context for the error message (e.g., 'table name', 'column name')
 * @throws Error if the identifier is invalid
 *
 * @example
 * assertValidIdentifier('users', 'table name');  // passes
 * assertValidIdentifier('123bad', 'table name'); // throws Error: Invalid table name: 123bad
 */
export function assertValidIdentifier(name: string, context = 'identifier'): void {
  if (!validateIdentifier(name)) {
    throw new Error(`Invalid ${context}: ${name}`)
  }
}

// ============================================================================
// Schema Resolution Utilities
// ============================================================================

/**
 * Resolve schema name with validation
 *
 * This is the canonical implementation used by all dialect adapters.
 * Eliminates code duplication across PostgreSQL, MySQL, SQLite, and MSSQL adapters.
 *
 * @param defaultSchema - The default schema to use if not specified in options
 * @param options - Optional schema configuration
 * @returns The resolved and validated schema name
 * @throws Error if the schema name is invalid
 *
 * @example
 * // Use with adapter's default schema
 * const schema = resolveSchema('public', options)
 *
 * @example
 * // Multi-tenant usage
 * const schema = resolveSchema('public', { schema: `tenant_${tenantId}` })
 */
export function resolveSchema(defaultSchema: string, options?: SchemaOptions): string {
  const schema = options?.schema ?? defaultSchema
  assertValidIdentifier(schema, 'schema name')
  return schema
}

// ============================================================================
// Multi-tenant Schema Utilities
// ============================================================================

/**
 * Default prefix for tenant schemas
 */
const DEFAULT_TENANT_PREFIX = 'tenant_'

/**
 * Configuration for multi-tenant schema operations
 */
export interface TenantSchemaConfig {
  /** Prefix for tenant schema names (default: 'tenant_') */
  prefix?: string
}

/**
 * Generate a tenant schema name from a tenant ID
 *
 * @param tenantId - The unique tenant identifier
 * @param config - Optional configuration
 * @returns The tenant schema name (validated)
 * @throws Error if the resulting schema name is invalid
 *
 * @example
 * getTenantSchemaName('123')           // 'tenant_123'
 * getTenantSchemaName('acme')          // 'tenant_acme'
 * getTenantSchemaName('corp', { prefix: 'org_' }) // 'org_corp'
 */
export function getTenantSchemaName(tenantId: string, config?: TenantSchemaConfig): string {
  if (!tenantId) {
    throw new Error('Invalid tenant schema name: tenant ID cannot be empty')
  }
  const prefix = config?.prefix ?? DEFAULT_TENANT_PREFIX
  const schemaName = `${prefix}${tenantId}`
  assertValidIdentifier(schemaName, 'tenant schema name')
  return schemaName
}

/**
 * Extract tenant ID from a tenant schema name
 *
 * @param schemaName - The schema name to parse
 * @param config - Optional configuration
 * @returns The tenant ID if the schema matches the pattern, null otherwise
 *
 * @example
 * parseTenantSchemaName('tenant_123')           // '123'
 * parseTenantSchemaName('tenant_acme')          // 'acme'
 * parseTenantSchemaName('public')               // null
 * parseTenantSchemaName('org_corp', { prefix: 'org_' }) // 'corp'
 */
export function parseTenantSchemaName(schemaName: string, config?: TenantSchemaConfig): string | null {
  const prefix = config?.prefix ?? DEFAULT_TENANT_PREFIX
  if (schemaName.startsWith(prefix) && schemaName.length > prefix.length) {
    return schemaName.slice(prefix.length)
  }
  return null
}

/**
 * Check if a schema name matches the tenant schema pattern
 *
 * @param schemaName - The schema name to check
 * @param config - Optional configuration
 * @returns true if the schema matches the tenant pattern
 *
 * @example
 * isTenantSchema('tenant_123')           // true
 * isTenantSchema('public')               // false
 * isTenantSchema('org_corp', { prefix: 'org_' }) // true
 */
export function isTenantSchema(schemaName: string, config?: TenantSchemaConfig): boolean {
  return parseTenantSchemaName(schemaName, config) !== null
}

/**
 * Filter an array of schema names to only tenant schemas
 *
 * @param schemas - Array of schema names
 * @param config - Optional configuration
 * @returns Array of tenant schema names
 *
 * @example
 * filterTenantSchemas(['public', 'tenant_1', 'tenant_2', 'auth'])
 * // ['tenant_1', 'tenant_2']
 */
export function filterTenantSchemas(schemas: string[], config?: TenantSchemaConfig): string[] {
  return schemas.filter(schema => isTenantSchema(schema, config))
}

/**
 * Extract tenant IDs from an array of schema names
 *
 * @param schemas - Array of schema names
 * @param config - Optional configuration
 * @returns Array of tenant IDs (excluding non-tenant schemas)
 *
 * @example
 * extractTenantIds(['public', 'tenant_1', 'tenant_2', 'auth'])
 * // ['1', '2']
 */
export function extractTenantIds(schemas: string[], config?: TenantSchemaConfig): string[] {
  return schemas
    .map(schema => parseTenantSchemaName(schema, config))
    .filter((id): id is string => id !== null)
}

// ============================================================================
// Schema Copying Utilities
// ============================================================================

/**
 * Options for schema copying operations
 */
export interface SchemaCopyOptions {
  /** Include table data (default: false, structure only) */
  includeData?: boolean
  /** Tables to exclude from copying */
  excludeTables?: string[]
  /** Tables to include (if specified, only these are copied) */
  includeTables?: string[]
}

/**
 * Create a qualified table name with schema prefix
 *
 * @param schema - The schema name
 * @param tableName - The table name
 * @param escapeIdentifierFn - Function to escape identifiers for the specific dialect
 * @returns Fully qualified table name (e.g., "public"."users")
 *
 * @example
 * qualifyTableName('auth', 'users', escapeIdentifier)
 * // PostgreSQL: "auth"."users"
 * // MySQL: `auth`.`users`
 */
export function qualifyTableName(
  schema: string,
  tableName: string,
  escapeIdentifierFn: (id: string) => string
): string {
  return `${escapeIdentifierFn(schema)}.${escapeIdentifierFn(tableName)}`
}

// ============================================================================
// Error Detection Utilities
// ============================================================================

/**
 * Error information extracted from a database error
 */
export interface ExtractedErrorInfo {
  /** Error code (e.g., '23505' for PostgreSQL unique constraint) */
  code: string
  /** Error message in lowercase for case-insensitive matching */
  message: string
  /** Original error message */
  originalMessage: string
  /** Error number (for MSSQL) - undefined if not present */
  number: number | undefined
}

/**
 * Extract error information from an unknown database error
 *
 * This utility normalizes error information across different database drivers,
 * eliminating the need for repeated type assertions in each adapter.
 *
 * @param error - The unknown error from a database operation
 * @returns Normalized error information
 *
 * @example
 * try {
 *   await db.insertInto('users').values(data).execute()
 * } catch (error) {
 *   const info = extractErrorInfo(error)
 *   if (info.code === '23505') {
 *     // Handle unique constraint violation
 *   }
 * }
 */
export function extractErrorInfo(error: unknown): ExtractedErrorInfo {
  // Handle null/undefined gracefully
  if (error == null || typeof error !== 'object') {
    return {
      code: '',
      message: '',
      originalMessage: '',
      number: undefined
    }
  }
  const e = error as DatabaseErrorLike
  const originalMessage = e.message ?? ''
  return {
    code: e.code ?? '',
    message: originalMessage.toLowerCase(),
    originalMessage,
    number: typeof e.number === 'number' ? e.number : undefined
  }
}

/**
 * Error matcher configuration for a specific error type
 */
export interface ErrorMatcherConfig {
  /** PostgreSQL error codes */
  codes?: string[]
  /** MSSQL error numbers */
  numbers?: number[]
  /** Message substrings to match (case-insensitive) */
  messages?: string[]
}

/**
 * Create an error matcher function for a specific constraint type
 *
 * This factory eliminates code duplication across dialect adapters by creating
 * reusable error detection functions.
 *
 * @param config - Configuration for matching the error
 * @returns A function that checks if an error matches the configured patterns
 *
 * @example
 * // Create a unique constraint error matcher for PostgreSQL
 * const isUniqueConstraint = createErrorMatcher({
 *   codes: ['23505'],
 *   messages: ['unique constraint']
 * })
 *
 * @example
 * // Create a foreign key error matcher for MSSQL
 * const isForeignKey = createErrorMatcher({
 *   numbers: [547],
 *   messages: ['foreign key']
 * })
 */
export function createErrorMatcher(
  config: ErrorMatcherConfig
): (error: unknown) => boolean {
  const { codes = [], numbers = [], messages = [] } = config

  return (error: unknown): boolean => {
    const info = extractErrorInfo(error)

    // Check error codes (PostgreSQL, MySQL)
    if (codes.length > 0 && codes.includes(info.code)) {
      return true
    }

    // Check error numbers (MSSQL)
    if (numbers.length > 0 && info.number !== undefined && numbers.includes(info.number)) {
      return true
    }

    // Check message patterns
    if (messages.length > 0) {
      for (const pattern of messages) {
        if (info.message.includes(pattern.toLowerCase())) {
          return true
        }
      }
    }

    return false
  }
}

// ============================================================================
// Pre-built Error Matchers
// ============================================================================

/**
 * Pre-built error matchers for common constraint violations
 * These can be used directly or as reference for custom matchers
 */
export const errorMatchers = {
  postgres: {
    uniqueConstraint: createErrorMatcher({ codes: ['23505'], messages: ['unique constraint'] }),
    foreignKey: createErrorMatcher({ codes: ['23503'], messages: ['foreign key constraint'] }),
    notNull: createErrorMatcher({ codes: ['23502'], messages: ['not-null constraint'] })
  },
  mysql: {
    // Include both named codes (ER_*) and numeric codes (1062, etc.)
    uniqueConstraint: createErrorMatcher({
      codes: ['ER_DUP_ENTRY', '1062'],
      messages: ['duplicate entry']
    }),
    foreignKey: createErrorMatcher({
      codes: ['ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED_2', 'ER_ROW_IS_REFERENCED', 'ER_NO_REFERENCED_ROW', '1451', '1452'],
      messages: ['foreign key constraint']
    }),
    notNull: createErrorMatcher({
      codes: ['ER_BAD_NULL_ERROR', '1048'],
      messages: ['cannot be null']
    })
  },
  sqlite: {
    uniqueConstraint: createErrorMatcher({ messages: ['unique constraint failed'] }),
    foreignKey: createErrorMatcher({ messages: ['foreign key constraint failed'] }),
    notNull: createErrorMatcher({ messages: ['not null constraint failed'] })
  },
  mssql: {
    // MSSQL uses numeric error codes
    uniqueConstraint: createErrorMatcher({
      codes: ['2627', '2601'],
      numbers: [2627, 2601],
      messages: ['violation of unique key constraint', 'cannot insert duplicate key', 'unique constraint']
    }),
    foreignKey: createErrorMatcher({
      codes: ['547'],
      numbers: [547],
      messages: ['foreign key constraint', 'conflicted with the foreign key']
    }),
    notNull: createErrorMatcher({
      codes: ['515'],
      numbers: [515],
      messages: ['cannot insert the value null', 'does not allow nulls']
    })
  }
} as const

/**
 * Check if table exists in the database
 *
 * @param db - Kysely database instance
 * @param tableName - Name of the table to check
 * @param dialect - Database dialect
 * @param options - Optional schema configuration
 * @returns true if table exists, false otherwise
 *
 * @example
 * // Check in default schema
 * const exists = await tableExists(db, 'users', 'postgres')
 *
 * @example
 * // Check in specific schema
 * const exists = await tableExists(db, 'users', 'postgres', { schema: 'auth' })
 */
export async function tableExists(
  db: Kysely<any>,
  tableName: string,
  dialect: Dialect,
  options?: SchemaOptions
): Promise<boolean> {
  return await getAdapter(dialect).tableExists(db, tableName, options)
}

/**
 * Get column names for a table
 *
 * @param db - Kysely database instance
 * @param tableName - Name of the table
 * @param dialect - Database dialect
 * @param options - Optional schema configuration
 * @returns Array of column names
 *
 * @example
 * const columns = await getTableColumns(db, 'users', 'postgres', { schema: 'auth' })
 * // ['id', 'name', 'email', 'created_at']
 */
export async function getTableColumns(
  db: Kysely<any>,
  tableName: string,
  dialect: Dialect,
  options?: SchemaOptions
): Promise<string[]> {
  return await getAdapter(dialect).getTableColumns(db, tableName, options)
}

/**
 * Get all tables in the database/schema
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect
 * @param options - Optional schema configuration
 * @returns Array of table names
 *
 * @example
 * // Get tables in auth schema
 * const tables = await getTables(db, 'postgres', { schema: 'auth' })
 * // ['users', 'sessions', 'tokens']
 */
export async function getTables(
  db: Kysely<any>,
  dialect: Dialect,
  options?: SchemaOptions
): Promise<string[]> {
  return await getAdapter(dialect).getTables(db, options)
}

/**
 * Escape identifier for SQL (table names, column names, etc.)
 *
 * @example
 * escapeIdentifier('my-table', 'postgres') // '"my-table"'
 * escapeIdentifier('my-table', 'mysql')    // '`my-table`'
 */
export function escapeIdentifier(identifier: string, dialect: Dialect): string {
  return getAdapter(dialect).escapeIdentifier(identifier)
}

/**
 * Get SQL expression for current timestamp
 *
 * @example
 * getCurrentTimestamp('postgres') // 'CURRENT_TIMESTAMP'
 * getCurrentTimestamp('sqlite')   // "datetime('now')"
 */
export function getCurrentTimestamp(dialect: Dialect): string {
  return getAdapter(dialect).getCurrentTimestamp()
}

/**
 * Format date for database insertion
 *
 * @example
 * formatDate(new Date(), 'postgres') // '2024-01-15T10:30:00.000Z'
 * formatDate(new Date(), 'mysql')    // '2024-01-15 10:30:00'
 */
export function formatDate(date: Date, dialect: Dialect): string {
  return getAdapter(dialect).formatDate(date)
}

/**
 * Check if error is a unique constraint violation
 *
 * @example
 * try {
 *   await db.insertInto('users').values({ email: 'duplicate@example.com' }).execute();
 * } catch (error) {
 *   if (isUniqueConstraintError(error, 'postgres')) {
 *     console.log('Email already exists');
 *   }
 * }
 */
export function isUniqueConstraintError(error: unknown, dialect: Dialect): boolean {
  return getAdapter(dialect).isUniqueConstraintError(error)
}

/**
 * Check if error is a foreign key constraint violation
 *
 * @example
 * if (isForeignKeyError(error, 'mysql')) {
 *   console.log('Referenced row does not exist');
 * }
 */
export function isForeignKeyError(error: unknown, dialect: Dialect): boolean {
  return getAdapter(dialect).isForeignKeyError(error)
}

/**
 * Check if error is a not-null constraint violation
 *
 * @example
 * if (isNotNullError(error, 'sqlite')) {
 *   console.log('Required field is missing');
 * }
 */
export function isNotNullError(error: unknown, dialect: Dialect): boolean {
  return getAdapter(dialect).isNotNullError(error)
}

/**
 * Get database size in bytes
 *
 * @example
 * const size = await getDatabaseSize(db, 'postgres');
 * console.log(`Database size: ${size} bytes`);
 */
export async function getDatabaseSize(
  db: Kysely<any>,
  dialect: Dialect,
  databaseName?: string
): Promise<number> {
  return await getAdapter(dialect).getDatabaseSize(db, databaseName)
}

/**
 * Truncate all tables in the database/schema (useful for testing)
 *
 * @param db - Kysely database instance
 * @param dialect - Database dialect
 * @param exclude - Array of table names to exclude
 * @param options - Optional schema configuration
 *
 * @example
 * // Truncate all tables in auth schema except migrations
 * await truncateAllTables(db, 'postgres', ['kysely_migrations'], { schema: 'auth' })
 */
export async function truncateAllTables(
  db: Kysely<any>,
  dialect: Dialect,
  exclude: string[] = [],
  options?: SchemaOptions
): Promise<void> {
  await getAdapter(dialect).truncateAllTables(db, exclude, options)
}
