/**
 * SQL Identifier Validation and Escaping Utility
 *
 * This module provides centralized SQL identifier validation to prevent SQL injection
 * attacks by ensuring all identifiers (table names, column names, database names, etc.)
 * contain only safe characters.
 *
 * @module sql-sanitizer
 */

/**
 * Supported identifier types
 */
export type IdentifierType = 'table' | 'database' | 'column' | 'index' | 'schema';

/**
 * Supported SQL dialects
 */
export type SqlDialect = 'postgres' | 'mysql' | 'sqlite';

/**
 * SQL Sanitization Error
 */
export class SqlSanitizationError extends Error {
  public readonly identifierType: IdentifierType;
  public readonly invalidValue: string;

  constructor(message: string, identifierType: IdentifierType, invalidValue: string) {
    super(message);
    this.name = 'SqlSanitizationError';
    this.identifierType = identifierType;
    this.invalidValue = invalidValue;
  }
}

/**
 * Configuration for identifier validation
 */
interface ValidationConfig {
  /** Maximum length for the identifier */
  maxLength: number;
  /** Minimum length for the identifier */
  minLength: number;
  /** Reserved words that cannot be used */
  reservedWords: Set<string>;
}

/**
 * Default validation configurations per identifier type
 */
const VALIDATION_CONFIGS: Record<IdentifierType, ValidationConfig> = {
  table: {
    maxLength: 128,
    minLength: 1,
    reservedWords: new Set(['table', 'select', 'insert', 'update', 'delete', 'drop', 'create', 'alter', 'truncate']),
  },
  database: {
    maxLength: 64,
    minLength: 1,
    reservedWords: new Set(['database', 'schema', 'master', 'tempdb', 'model', 'msdb']),
  },
  column: {
    maxLength: 128,
    minLength: 1,
    reservedWords: new Set(['column', 'key', 'index', 'primary', 'foreign', 'unique', 'constraint']),
  },
  index: {
    maxLength: 128,
    minLength: 1,
    reservedWords: new Set(['index', 'primary', 'unique', 'fulltext', 'spatial']),
  },
  schema: {
    maxLength: 64,
    minLength: 1,
    reservedWords: new Set(['schema', 'public', 'information_schema', 'pg_catalog']),
  },
};

/**
 * Strict regex pattern for valid SQL identifiers
 * - Must start with a letter or underscore
 * - Can contain letters, digits, and underscores
 * - No special characters or SQL injection patterns
 */
const VALID_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Pattern to detect common SQL injection attempts
 */
const INJECTION_PATTERNS = [
  /--/,                    // SQL comment
  /;/,                     // Statement terminator
  /'/,                     // Single quote
  /"/,                     // Double quote
  /`/,                     // Backtick
  /\\/,                    // Backslash
  /\x00/,                  // Null byte
  /\/\*/,                  // Block comment start
  /\*\//,                  // Block comment end
  /\bor\b/i,              // OR keyword
  /\band\b/i,             // AND keyword
  /\bunion\b/i,           // UNION keyword
  /\bselect\b/i,          // SELECT keyword
  /\bdrop\b/i,            // DROP keyword
  /\bdelete\b/i,          // DELETE keyword
  /\binsert\b/i,          // INSERT keyword
  /\bupdate\b/i,          // UPDATE keyword
  /\bexec\b/i,            // EXEC keyword
  /\bexecute\b/i,         // EXECUTE keyword
  /\bxp_/i,               // SQL Server extended procedures
];

/**
 * Check if a string is a valid SQL identifier
 *
 * @param name - The identifier to validate
 * @returns True if the identifier is valid, false otherwise
 *
 * @example
 * ```typescript
 * isValidIdentifier('users')           // true
 * isValidIdentifier('user_accounts')   // true
 * isValidIdentifier('_private')        // true
 * isValidIdentifier('123table')        // false (starts with number)
 * isValidIdentifier('user-table')      // false (contains hyphen)
 * isValidIdentifier("users'; DROP")    // false (SQL injection)
 * ```
 */
export function isValidIdentifier(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  // Check length (reasonable bounds)
  if (name.length === 0 || name.length > 128) {
    return false;
  }

  // Check against valid pattern
  if (!VALID_IDENTIFIER_PATTERN.test(name)) {
    return false;
  }

  // Check for injection patterns (should be caught by regex, but double-check)
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(name)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate an SQL identifier and return it if valid
 *
 * @param name - The identifier to validate
 * @param type - The type of identifier (table, database, column, index, schema)
 * @returns The validated identifier
 * @throws SqlSanitizationError if the identifier is invalid
 *
 * @example
 * ```typescript
 * // Valid identifiers are returned as-is
 * validateIdentifier('users', 'table')           // 'users'
 * validateIdentifier('user_email', 'column')     // 'user_email'
 *
 * // Invalid identifiers throw SqlSanitizationError
 * validateIdentifier("users'; DROP TABLE", 'table')  // throws
 * validateIdentifier('123invalid', 'column')          // throws
 * ```
 */
export function validateIdentifier(name: string, type: IdentifierType): string {
  const config = VALIDATION_CONFIGS[type];

  // Check if name is provided
  if (!name || typeof name !== 'string') {
    throw new SqlSanitizationError(
      `Invalid ${type} name: name must be a non-empty string`,
      type,
      String(name)
    );
  }

  // Trim whitespace
  const trimmedName = name.trim();

  // Check length constraints
  if (trimmedName.length < config.minLength) {
    throw new SqlSanitizationError(
      `Invalid ${type} name: name must be at least ${config.minLength} character(s)`,
      type,
      trimmedName
    );
  }

  if (trimmedName.length > config.maxLength) {
    throw new SqlSanitizationError(
      `Invalid ${type} name: name exceeds maximum length of ${config.maxLength} characters`,
      type,
      trimmedName
    );
  }

  // Check against valid identifier pattern
  if (!VALID_IDENTIFIER_PATTERN.test(trimmedName)) {
    throw new SqlSanitizationError(
      `Invalid ${type} name "${trimmedName}": must start with a letter or underscore and contain only letters, digits, and underscores`,
      type,
      trimmedName
    );
  }

  // Check for SQL injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(trimmedName)) {
      throw new SqlSanitizationError(
        `Invalid ${type} name "${trimmedName}": contains potentially dangerous characters or patterns`,
        type,
        trimmedName
      );
    }
  }

  return trimmedName;
}

/**
 * Escape an SQL identifier for safe use in queries
 *
 * This function both validates the identifier and wraps it in the appropriate
 * quote characters for the specified SQL dialect.
 *
 * @param name - The identifier to escape
 * @param dialect - The SQL dialect (postgres, mysql, sqlite)
 * @returns The escaped identifier
 * @throws SqlSanitizationError if the identifier is invalid
 *
 * @example
 * ```typescript
 * escapeIdentifier('users', 'postgres')   // '"users"'
 * escapeIdentifier('users', 'mysql')      // '`users`'
 * escapeIdentifier('users', 'sqlite')     // '"users"'
 * ```
 */
export function escapeIdentifier(name: string, dialect: SqlDialect): string {
  // First validate the identifier (defaults to 'table' type for general use)
  const validName = validateIdentifier(name, 'table');

  // Apply dialect-specific quoting
  switch (dialect) {
    case 'mysql':
      // MySQL uses backticks for identifier quoting
      return `\`${validName}\``;
    case 'postgres':
    case 'sqlite':
    default:
      // PostgreSQL and SQLite use double quotes
      return `"${validName}"`;
  }
}

/**
 * Escape an identifier with a specific type validation
 *
 * @param name - The identifier to escape
 * @param type - The type of identifier for validation
 * @param dialect - The SQL dialect
 * @returns The escaped identifier
 */
export function escapeTypedIdentifier(name: string, type: IdentifierType, dialect: SqlDialect): string {
  const validName = validateIdentifier(name, type);

  switch (dialect) {
    case 'mysql':
      return `\`${validName}\``;
    case 'postgres':
    case 'sqlite':
    default:
      return `"${validName}"`;
  }
}

/**
 * Validate and escape a schema-qualified identifier (schema.table)
 *
 * @param schema - The schema name (optional)
 * @param name - The table/object name
 * @param dialect - The SQL dialect
 * @returns The escaped qualified identifier
 *
 * @example
 * ```typescript
 * escapeQualifiedIdentifier('public', 'users', 'postgres')  // '"public"."users"'
 * escapeQualifiedIdentifier(undefined, 'users', 'postgres') // '"users"'
 * ```
 */
export function escapeQualifiedIdentifier(
  schema: string | undefined,
  name: string,
  dialect: SqlDialect
): string {
  const escapedName = escapeTypedIdentifier(name, 'table', dialect);

  if (schema) {
    const escapedSchema = escapeTypedIdentifier(schema, 'schema', dialect);
    return `${escapedSchema}.${escapedName}`;
  }

  return escapedName;
}

/**
 * Validate multiple identifiers at once
 *
 * @param names - Array of identifiers to validate
 * @param type - The type of identifiers
 * @returns Array of validated identifiers
 * @throws SqlSanitizationError if any identifier is invalid
 */
export function validateIdentifiers(names: string[], type: IdentifierType): string[] {
  return names.map((name) => validateIdentifier(name, type));
}

/**
 * Safely interpolate a table name into a raw SQL string
 *
 * @param sql - SQL template with ${table} placeholder
 * @param tableName - The table name to interpolate
 * @param dialect - The SQL dialect
 * @returns The SQL string with safely escaped table name
 *
 * @example
 * ```typescript
 * interpolateTableName('SELECT * FROM ${table}', 'users', 'postgres')
 * // Returns: 'SELECT * FROM "users"'
 * ```
 */
export function interpolateTableName(sql: string, tableName: string, dialect: SqlDialect): string {
  const escapedTable = escapeTypedIdentifier(tableName, 'table', dialect);
  return sql.replace(/\$\{table\}/g, escapedTable);
}

/**
 * Create a safe TRUNCATE TABLE statement
 *
 * @param tableName - The table to truncate
 * @param dialect - The SQL dialect
 * @param cascade - Whether to include CASCADE (postgres/mysql)
 * @returns Safe TRUNCATE statement
 */
export function safeTruncate(tableName: string, dialect: SqlDialect, cascade: boolean = false): string {
  const escapedTable = escapeTypedIdentifier(tableName, 'table', dialect);

  switch (dialect) {
    case 'postgres':
      return cascade ? `TRUNCATE TABLE ${escapedTable} CASCADE` : `TRUNCATE TABLE ${escapedTable}`;
    case 'mysql':
      // MySQL doesn't support CASCADE with TRUNCATE
      return `TRUNCATE TABLE ${escapedTable}`;
    case 'sqlite':
      // SQLite doesn't have TRUNCATE, use DELETE
      return `DELETE FROM ${escapedTable}`;
  }
}

/**
 * Create a safe DROP DATABASE statement
 *
 * @param dbName - The database to drop
 * @param dialect - The SQL dialect
 * @param ifExists - Whether to include IF EXISTS
 * @returns Safe DROP DATABASE statement
 */
export function safeDropDatabase(dbName: string, dialect: SqlDialect, ifExists: boolean = true): string {
  const escapedDb = escapeTypedIdentifier(dbName, 'database', dialect);
  const ifExistsClause = ifExists ? 'IF EXISTS ' : '';

  return `DROP DATABASE ${ifExistsClause}${escapedDb}`;
}

/**
 * Create a safe PRAGMA table_info statement for SQLite
 *
 * @param tableName - The table to get info for
 * @returns Safe PRAGMA statement
 */
export function safePragmaTableInfo(tableName: string): string {
  const validName = validateIdentifier(tableName, 'table');
  return `PRAGMA table_info('${validName}')`;
}

/**
 * Create a safe PRAGMA index_info statement for SQLite
 *
 * @param indexName - The index to get info for
 * @returns Safe PRAGMA statement
 */
export function safePragmaIndexInfo(indexName: string): string {
  const validName = validateIdentifier(indexName, 'index');
  return `PRAGMA index_info('${validName}')`;
}

/**
 * Create a safe PRAGMA foreign_key_list statement for SQLite
 *
 * @param tableName - The table to get foreign keys for
 * @returns Safe PRAGMA statement
 */
export function safePragmaForeignKeyList(tableName: string): string {
  const validName = validateIdentifier(tableName, 'table');
  return `PRAGMA foreign_key_list('${validName}')`;
}

/**
 * Create a safe VACUUM INTO statement for SQLite
 *
 * @param backupPath - The backup file path
 * @returns Safe VACUUM INTO statement
 */
export function safeVacuumInto(backupPath: string): string {
  // For file paths, we only validate that it doesn't contain SQL injection patterns
  // but allow more characters than identifiers
  if (backupPath.includes("'") || backupPath.includes(';') || backupPath.includes('--')) {
    throw new SqlSanitizationError(
      'Invalid backup path: contains potentially dangerous characters',
      'database',
      backupPath
    );
  }
  return `VACUUM INTO '${backupPath}'`;
}

/**
 * Create a safe ANALYZE statement
 *
 * @param tableName - The table to analyze (optional for SQLite)
 * @param dialect - The SQL dialect
 * @returns Safe ANALYZE statement
 */
export function safeAnalyze(tableName: string | undefined, dialect: SqlDialect): string {
  if (!tableName) {
    return 'ANALYZE';
  }

  const escapedTable = escapeTypedIdentifier(tableName, 'table', dialect);

  switch (dialect) {
    case 'sqlite':
      // SQLite ANALYZE uses quotes differently
      const validName = validateIdentifier(tableName, 'table');
      return `ANALYZE '${validName}'`;
    case 'mysql':
      return `ANALYZE TABLE ${escapedTable}`;
    case 'postgres':
      return `ANALYZE ${escapedTable}`;
  }
}

/**
 * Create a safe OPTIMIZE TABLE statement (MySQL)
 *
 * @param tableName - The table to optimize
 * @returns Safe OPTIMIZE statement
 */
export function safeOptimizeTable(tableName: string): string {
  const escapedTable = escapeTypedIdentifier(tableName, 'table', 'mysql');
  return `OPTIMIZE TABLE ${escapedTable}`;
}

/**
 * Create a safe CHECK TABLE statement (MySQL)
 *
 * @param tableName - The table to check
 * @returns Safe CHECK statement
 */
export function safeCheckTable(tableName: string): string {
  const escapedTable = escapeTypedIdentifier(tableName, 'table', 'mysql');
  return `CHECK TABLE ${escapedTable}`;
}

/**
 * Create a safe REPAIR TABLE statement (MySQL)
 *
 * @param tableName - The table to repair
 * @returns Safe REPAIR statement
 */
export function safeRepairTable(tableName: string): string {
  const escapedTable = escapeTypedIdentifier(tableName, 'table', 'mysql');
  return `REPAIR TABLE ${escapedTable}`;
}

/**
 * Create a safe VACUUM ANALYZE statement (PostgreSQL)
 *
 * @param tableName - The table to vacuum
 * @returns Safe VACUUM ANALYZE statement
 */
export function safeVacuumAnalyze(tableName: string): string {
  const escapedTable = escapeTypedIdentifier(tableName, 'table', 'postgres');
  return `VACUUM ANALYZE ${escapedTable}`;
}

/**
 * Create a safe CREATE EXTENSION statement (PostgreSQL)
 *
 * @param extensionName - The extension to create
 * @returns Safe CREATE EXTENSION statement
 */
export function safeCreateExtension(extensionName: string): string {
  // Extensions have similar naming rules to identifiers
  const validName = validateIdentifier(extensionName, 'table');
  return `CREATE EXTENSION IF NOT EXISTS "${validName}"`;
}

/**
 * Create a safe pg_terminate_backend query for PostgreSQL
 *
 * @param dbName - The database name to terminate connections for
 * @returns Safe termination query with parameterized database name
 */
export function safeTerminateBackendQuery(dbName: string): { sql: string; params: string[] } {
  // Validate the database name
  validateIdentifier(dbName, 'database');

  // Return parameterized query to prevent injection
  return {
    sql: `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
    `,
    params: [dbName],
  };
}

/**
 * Type guard to check if an error is a SqlSanitizationError
 */
export function isSqlSanitizationError(error: unknown): error is SqlSanitizationError {
  return error instanceof SqlSanitizationError;
}
