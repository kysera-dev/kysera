/**
 * @kysera/dialects - Comprehensive Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'

import {
  // Factory
  getAdapter,
  createDialectAdapter,
  registerAdapter,
  // Adapters
  PostgresAdapter,
  MySQLAdapter,
  SQLiteAdapter,
  postgresAdapter,
  mysqlAdapter,
  sqliteAdapter,
  // Connection
  parseConnectionUrl,
  buildConnectionUrl,
  getDefaultPort,
  // Helper functions
  tableExists,
  getTableColumns,
  getTables,
  escapeIdentifier,
  getCurrentTimestamp,
  formatDate,
  isUniqueConstraintError,
  isForeignKeyError,
  isNotNullError,
  truncateAllTables
} from '../src/index.js'

// ============================================================================
// Test Types
// ============================================================================

interface TestDB {
  users: {
    id: number
    name: string
    email: string
    created_at: string
  }
  posts: {
    id: number
    user_id: number
    title: string
    content: string
  }
}

// ============================================================================
// Factory Tests
// ============================================================================

describe('Factory', () => {
  describe('getAdapter', () => {
    it('should return postgres adapter', () => {
      const adapter = getAdapter('postgres')
      expect(adapter.dialect).toBe('postgres')
      expect(adapter).toBe(postgresAdapter)
    })

    it('should return mysql adapter', () => {
      const adapter = getAdapter('mysql')
      expect(adapter.dialect).toBe('mysql')
      expect(adapter).toBe(mysqlAdapter)
    })

    it('should return sqlite adapter', () => {
      const adapter = getAdapter('sqlite')
      expect(adapter.dialect).toBe('sqlite')
      expect(adapter).toBe(sqliteAdapter)
    })

    it('should throw for unknown dialect', () => {
      expect(() => getAdapter('unknown' as any)).toThrow('Unknown dialect: unknown')
    })
  })

  describe('createDialectAdapter', () => {
    it('should create new postgres adapter instance', () => {
      const adapter = createDialectAdapter('postgres')
      expect(adapter).toBeInstanceOf(PostgresAdapter)
      expect(adapter).not.toBe(postgresAdapter)
    })

    it('should create new mysql adapter instance', () => {
      const adapter = createDialectAdapter('mysql')
      expect(adapter).toBeInstanceOf(MySQLAdapter)
      expect(adapter).not.toBe(mysqlAdapter)
    })

    it('should create new sqlite adapter instance', () => {
      const adapter = createDialectAdapter('sqlite')
      expect(adapter).toBeInstanceOf(SQLiteAdapter)
      expect(adapter).not.toBe(sqliteAdapter)
    })

    it('should throw for unknown dialect', () => {
      expect(() => createDialectAdapter('unknown' as any)).toThrow('Unknown dialect: unknown')
    })
  })

  describe('registerAdapter', () => {
    it('should register custom adapter', () => {
      const customAdapter = new SQLiteAdapter()
      ;(customAdapter as any).dialect = 'sqlite'
      registerAdapter(customAdapter)
      expect(getAdapter('sqlite')).toBe(customAdapter)
    })
  })
})

// ============================================================================
// Connection Tests
// ============================================================================

describe('Connection', () => {
  describe('parseConnectionUrl', () => {
    it('should parse postgresql URL with all components', () => {
      const config = parseConnectionUrl(
        'postgresql://user:pass@host.example.com:5432/mydb?ssl=true'
      )
      expect(config).toEqual({
        host: 'host.example.com',
        port: 5432,
        database: 'mydb',
        user: 'user',
        password: 'pass',
        ssl: true
      })
    })

    it('should parse URL without port', () => {
      const config = parseConnectionUrl('postgresql://user:pass@localhost/mydb')
      expect(config.port).toBeUndefined()
    })

    it('should parse URL without auth', () => {
      const config = parseConnectionUrl('postgresql://localhost:5432/mydb')
      expect(config.user).toBeUndefined()
      expect(config.password).toBeUndefined()
    })

    it('should parse URL with sslmode=require', () => {
      const config = parseConnectionUrl('postgresql://localhost/mydb?sslmode=require')
      expect(config.ssl).toBe(true)
    })

    it('should parse mysql URL', () => {
      const config = parseConnectionUrl('mysql://root:secret@127.0.0.1:3306/testdb')
      expect(config).toEqual({
        host: '127.0.0.1',
        port: 3306,
        database: 'testdb',
        user: 'root',
        password: 'secret',
        ssl: false
      })
    })
  })

  describe('buildConnectionUrl', () => {
    it('should build postgres URL', () => {
      const url = buildConnectionUrl('postgres', {
        host: 'localhost',
        database: 'mydb'
      })
      expect(url).toBe('postgresql://localhost:5432/mydb')
    })

    it('should build mysql URL with auth', () => {
      const url = buildConnectionUrl('mysql', {
        host: 'db.example.com',
        port: 3307,
        database: 'mydb',
        user: 'admin',
        password: 'secret'
      })
      expect(url).toBe('mysql://admin:secret@db.example.com:3307/mydb')
    })

    it('should build URL with ssl', () => {
      const url = buildConnectionUrl('postgres', {
        host: 'localhost',
        database: 'mydb',
        ssl: true
      })
      expect(url).toBe('postgresql://localhost:5432/mydb?ssl=true')
    })

    it('should build sqlite URL without port', () => {
      const url = buildConnectionUrl('sqlite', {
        database: 'test.db'
      })
      expect(url).toBe('sqlite://localhost/test.db')
    })
  })

  describe('getDefaultPort', () => {
    it('should return 5432 for postgres', () => {
      expect(getDefaultPort('postgres')).toBe(5432)
    })

    it('should return 3306 for mysql', () => {
      expect(getDefaultPort('mysql')).toBe(3306)
    })

    it('should return null for sqlite', () => {
      expect(getDefaultPort('sqlite')).toBeNull()
    })
  })
})

// ============================================================================
// PostgresAdapter Tests
// ============================================================================

describe('PostgresAdapter', () => {
  const adapter = new PostgresAdapter()

  it('should have correct dialect', () => {
    expect(adapter.dialect).toBe('postgres')
  })

  it('should return correct default port', () => {
    expect(adapter.getDefaultPort()).toBe(5432)
  })

  it('should return correct timestamp SQL', () => {
    expect(adapter.getCurrentTimestamp()).toBe('CURRENT_TIMESTAMP')
  })

  it('should escape identifiers with double quotes', () => {
    expect(adapter.escapeIdentifier('user-table')).toBe('"user-table"')
    expect(adapter.escapeIdentifier('table"with"quotes')).toBe('"table""with""quotes"')
  })

  it('should format date as ISO string', () => {
    const date = new Date('2024-01-15T10:30:00.000Z')
    expect(adapter.formatDate(date)).toBe('2024-01-15T10:30:00.000Z')
  })

  describe('error detection', () => {
    it('should detect unique constraint error by code', () => {
      expect(adapter.isUniqueConstraintError({ code: '23505' })).toBe(true)
    })

    it('should detect unique constraint error by message', () => {
      expect(adapter.isUniqueConstraintError({ message: 'Unique constraint violation' })).toBe(true)
    })

    it('should detect foreign key error by code', () => {
      expect(adapter.isForeignKeyError({ code: '23503' })).toBe(true)
    })

    it('should detect foreign key error by message', () => {
      expect(adapter.isForeignKeyError({ message: 'Foreign key constraint violation' })).toBe(true)
    })

    it('should detect not-null error by code', () => {
      expect(adapter.isNotNullError({ code: '23502' })).toBe(true)
    })

    it('should detect not-null error by message', () => {
      expect(adapter.isNotNullError({ message: 'not-null constraint violation' })).toBe(true)
    })

    it('should not detect errors that do not match', () => {
      expect(adapter.isUniqueConstraintError({ code: '00000' })).toBe(false)
      expect(adapter.isForeignKeyError({ message: 'some other error' })).toBe(false)
      expect(adapter.isNotNullError({})).toBe(false)
    })
  })
})

// ============================================================================
// MySQLAdapter Tests
// ============================================================================

describe('MySQLAdapter', () => {
  const adapter = new MySQLAdapter()

  it('should have correct dialect', () => {
    expect(adapter.dialect).toBe('mysql')
  })

  it('should return correct default port', () => {
    expect(adapter.getDefaultPort()).toBe(3306)
  })

  it('should return correct timestamp SQL', () => {
    expect(adapter.getCurrentTimestamp()).toBe('CURRENT_TIMESTAMP')
  })

  it('should escape identifiers with backticks', () => {
    expect(adapter.escapeIdentifier('user-table')).toBe('`user-table`')
    expect(adapter.escapeIdentifier('table`with`backticks')).toBe('`table``with``backticks`')
  })

  it('should format date in MySQL datetime format', () => {
    const date = new Date('2024-01-15T10:30:45.123Z')
    expect(adapter.formatDate(date)).toBe('2024-01-15 10:30:45')
  })

  describe('error detection', () => {
    it('should detect unique constraint error by ER_DUP_ENTRY', () => {
      expect(adapter.isUniqueConstraintError({ code: 'ER_DUP_ENTRY' })).toBe(true)
    })

    it('should detect unique constraint error by code 1062', () => {
      expect(adapter.isUniqueConstraintError({ code: '1062' })).toBe(true)
    })

    it('should detect unique constraint error by message', () => {
      expect(adapter.isUniqueConstraintError({ message: 'Duplicate entry for key' })).toBe(true)
    })

    it('should detect foreign key error by ER_ROW_IS_REFERENCED', () => {
      expect(adapter.isForeignKeyError({ code: 'ER_ROW_IS_REFERENCED' })).toBe(true)
    })

    it('should detect foreign key error by codes 1451/1452', () => {
      expect(adapter.isForeignKeyError({ code: '1451' })).toBe(true)
      expect(adapter.isForeignKeyError({ code: '1452' })).toBe(true)
    })

    it('should detect not-null error by ER_BAD_NULL_ERROR', () => {
      expect(adapter.isNotNullError({ code: 'ER_BAD_NULL_ERROR' })).toBe(true)
    })

    it('should detect not-null error by code 1048', () => {
      expect(adapter.isNotNullError({ code: '1048' })).toBe(true)
    })
  })
})

// ============================================================================
// SQLiteAdapter Tests
// ============================================================================

describe('SQLiteAdapter', () => {
  const adapter = new SQLiteAdapter()

  it('should have correct dialect', () => {
    expect(adapter.dialect).toBe('sqlite')
  })

  it('should return null for default port (file-based)', () => {
    expect(adapter.getDefaultPort()).toBeNull()
  })

  it('should return correct timestamp SQL', () => {
    expect(adapter.getCurrentTimestamp()).toBe("datetime('now')")
  })

  it('should escape identifiers with double quotes', () => {
    expect(adapter.escapeIdentifier('user-table')).toBe('"user-table"')
    expect(adapter.escapeIdentifier('table"with"quotes')).toBe('"table""with""quotes"')
  })

  it('should format date as ISO string', () => {
    const date = new Date('2024-01-15T10:30:00.000Z')
    expect(adapter.formatDate(date)).toBe('2024-01-15T10:30:00.000Z')
  })

  describe('error detection', () => {
    it('should detect unique constraint error by message', () => {
      expect(
        adapter.isUniqueConstraintError({ message: 'UNIQUE constraint failed: users.email' })
      ).toBe(true)
    })

    it('should detect foreign key error by message', () => {
      expect(adapter.isForeignKeyError({ message: 'FOREIGN KEY constraint failed' })).toBe(true)
    })

    it('should detect not-null error by message', () => {
      expect(adapter.isNotNullError({ message: 'NOT NULL constraint failed: users.name' })).toBe(
        true
      )
    })

    it('should not detect errors that do not match', () => {
      expect(adapter.isUniqueConstraintError({ message: 'some other error' })).toBe(false)
      expect(adapter.isForeignKeyError({ message: 'constraint error' })).toBe(false)
      expect(adapter.isNotNullError({})).toBe(false)
    })
  })
})

// ============================================================================
// Database Integration Tests (SQLite)
// ============================================================================

describe('Database Integration (SQLite)', () => {
  let db: Kysely<TestDB>

  beforeEach(async () => {
    const database = new Database(':memory:')
    db = new Kysely<TestDB>({
      dialect: new SqliteDialect({ database })
    })

    // Create test tables
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', col => col.primaryKey())
      .addColumn('name', 'text', col => col.notNull())
      .addColumn('email', 'text', col => col.notNull().unique())
      .addColumn('created_at', 'text', col => col.notNull())
      .execute()

    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', col => col.primaryKey())
      .addColumn('user_id', 'integer', col => col.notNull())
      .addColumn('title', 'text', col => col.notNull())
      .addColumn('content', 'text', col => col.notNull())
      .execute()

    // Insert test data
    await db
      .insertInto('users')
      .values([
        { id: 1, name: 'Alice', email: 'alice@example.com', created_at: '2024-01-01' },
        { id: 2, name: 'Bob', email: 'bob@example.com', created_at: '2024-01-02' }
      ])
      .execute()

    await db
      .insertInto('posts')
      .values([
        { id: 1, user_id: 1, title: 'Hello', content: 'World' },
        { id: 2, user_id: 1, title: 'Second', content: 'Post' }
      ])
      .execute()
  })

  afterEach(async () => {
    await db.destroy()
  })

  describe('tableExists', () => {
    it('should return true for existing table', async () => {
      expect(await tableExists(db, 'users', 'sqlite')).toBe(true)
      expect(await tableExists(db, 'posts', 'sqlite')).toBe(true)
    })

    it('should return false for non-existing table', async () => {
      expect(await tableExists(db, 'nonexistent', 'sqlite')).toBe(false)
    })

    it('should return false for sqlite_* tables', async () => {
      // sqlite_master shouldn't be returned as a user table
      const tables = await getTables(db, 'sqlite')
      expect(tables).not.toContain('sqlite_master')
    })
  })

  describe('getTableColumns', () => {
    it('should return column names for users table', async () => {
      const columns = await getTableColumns(db, 'users', 'sqlite')
      expect(columns).toContain('id')
      expect(columns).toContain('name')
      expect(columns).toContain('email')
      expect(columns).toContain('created_at')
    })

    it('should return column names for posts table', async () => {
      const columns = await getTableColumns(db, 'posts', 'sqlite')
      expect(columns).toContain('id')
      expect(columns).toContain('user_id')
      expect(columns).toContain('title')
      expect(columns).toContain('content')
    })

    it('should return empty array for non-existing table', async () => {
      const columns = await getTableColumns(db, 'nonexistent', 'sqlite')
      expect(columns).toEqual([])
    })
  })

  describe('getTables', () => {
    it('should return all user tables', async () => {
      const tables = await getTables(db, 'sqlite')
      expect(tables).toContain('users')
      expect(tables).toContain('posts')
      expect(tables.length).toBe(2)
    })
  })

  describe('truncateAllTables', () => {
    it('should truncate all tables', async () => {
      await truncateAllTables(db, 'sqlite')

      const users = await db.selectFrom('users').selectAll().execute()
      const posts = await db.selectFrom('posts').selectAll().execute()

      expect(users).toEqual([])
      expect(posts).toEqual([])
    })

    it('should exclude specified tables', async () => {
      await truncateAllTables(db, 'sqlite', ['users'])

      const users = await db.selectFrom('users').selectAll().execute()
      const posts = await db.selectFrom('posts').selectAll().execute()

      expect(users.length).toBe(2)
      expect(posts).toEqual([])
    })
  })
})

// ============================================================================
// Helper Functions Tests
// ============================================================================

describe('Helper Functions', () => {
  describe('escapeIdentifier', () => {
    it('should delegate to adapter for each dialect', () => {
      expect(escapeIdentifier('test', 'postgres')).toBe('"test"')
      expect(escapeIdentifier('test', 'mysql')).toBe('`test`')
      expect(escapeIdentifier('test', 'sqlite')).toBe('"test"')
    })
  })

  describe('getCurrentTimestamp', () => {
    it('should delegate to adapter for each dialect', () => {
      expect(getCurrentTimestamp('postgres')).toBe('CURRENT_TIMESTAMP')
      expect(getCurrentTimestamp('mysql')).toBe('CURRENT_TIMESTAMP')
      expect(getCurrentTimestamp('sqlite')).toBe("datetime('now')")
    })
  })

  describe('formatDate', () => {
    const date = new Date('2024-01-15T10:30:45.123Z')

    it('should format correctly for each dialect', () => {
      expect(formatDate(date, 'postgres')).toBe('2024-01-15T10:30:45.123Z')
      expect(formatDate(date, 'mysql')).toBe('2024-01-15 10:30:45')
      expect(formatDate(date, 'sqlite')).toBe('2024-01-15T10:30:45.123Z')
    })
  })

  describe('isUniqueConstraintError', () => {
    it('should detect for each dialect', () => {
      expect(isUniqueConstraintError({ code: '23505' }, 'postgres')).toBe(true)
      expect(isUniqueConstraintError({ code: 'ER_DUP_ENTRY' }, 'mysql')).toBe(true)
      expect(isUniqueConstraintError({ message: 'UNIQUE constraint failed' }, 'sqlite')).toBe(true)
    })
  })

  describe('isForeignKeyError', () => {
    it('should detect for each dialect', () => {
      expect(isForeignKeyError({ code: '23503' }, 'postgres')).toBe(true)
      expect(isForeignKeyError({ code: 'ER_ROW_IS_REFERENCED' }, 'mysql')).toBe(true)
      expect(isForeignKeyError({ message: 'FOREIGN KEY constraint failed' }, 'sqlite')).toBe(true)
    })
  })

  describe('isNotNullError', () => {
    it('should detect for each dialect', () => {
      expect(isNotNullError({ code: '23502' }, 'postgres')).toBe(true)
      expect(isNotNullError({ code: 'ER_BAD_NULL_ERROR' }, 'mysql')).toBe(true)
      expect(isNotNullError({ message: 'NOT NULL constraint failed' }, 'sqlite')).toBe(true)
    })
  })
})

// ============================================================================
// Validation Functions Tests
// ============================================================================

import {
  validateIdentifier,
  assertValidIdentifier,
  getDatabaseSize,
  // Multi-tenant utilities
  getTenantSchemaName,
  parseTenantSchemaName,
  isTenantSchema,
  filterTenantSchemas,
  extractTenantIds,
  // Schema utilities
  resolveSchema,
  qualifyTableName,
  // Error detection utilities
  extractErrorInfo,
  createErrorMatcher,
  errorMatchers
} from '../src/index.js'

describe('Validation Functions', () => {
  describe('validateIdentifier', () => {
    it('should return true for valid identifiers', () => {
      expect(validateIdentifier('users')).toBe(true)
      expect(validateIdentifier('user_profiles')).toBe(true)
      expect(validateIdentifier('_private')).toBe(true)
      expect(validateIdentifier('public.users')).toBe(true)
      expect(validateIdentifier('schema_v2.table_name')).toBe(true)
    })

    it('should return false for empty identifier', () => {
      expect(validateIdentifier('')).toBe(false)
    })

    it('should return false for identifier that is too long', () => {
      const longName = 'a'.repeat(129)
      expect(validateIdentifier(longName)).toBe(false)
    })

    it('should return false for identifier starting with number', () => {
      expect(validateIdentifier('123table')).toBe(false)
    })

    it('should return false for identifier with invalid characters', () => {
      expect(validateIdentifier('table-name')).toBe(false)
      expect(validateIdentifier('table name')).toBe(false)
      expect(validateIdentifier("users'; DROP TABLE users;--")).toBe(false)
      expect(validateIdentifier('table@name')).toBe(false)
    })
  })

  describe('assertValidIdentifier', () => {
    it('should not throw for valid identifiers', () => {
      expect(() => assertValidIdentifier('users')).not.toThrow()
      expect(() => assertValidIdentifier('_table', 'table name')).not.toThrow()
    })

    it('should throw for invalid identifiers', () => {
      expect(() => assertValidIdentifier('')).toThrow('Invalid identifier')
      expect(() => assertValidIdentifier('123bad')).toThrow('Invalid identifier')
    })

    it('should include context in error message', () => {
      expect(() => assertValidIdentifier('bad-name', 'table name')).toThrow(
        'Invalid table name: bad-name'
      )
      expect(() => assertValidIdentifier('123column', 'column name')).toThrow(
        'Invalid column name: 123column'
      )
    })
  })

  describe('getDatabaseSize', () => {
    let db: Kysely<TestDB>

    beforeEach(async () => {
      const database = new Database(':memory:')
      db = new Kysely<TestDB>({
        dialect: new SqliteDialect({ database })
      })
    })

    afterEach(async () => {
      await db.destroy()
    })

    it('should return database size for sqlite', async () => {
      const size = await getDatabaseSize(db, 'sqlite')
      expect(typeof size).toBe('number')
      expect(size).toBeGreaterThanOrEqual(0)
    })
  })
})

// ============================================================================
// Multi-tenant Schema Utilities Tests
// ============================================================================

describe('Multi-tenant Schema Utilities', () => {
  describe('getTenantSchemaName', () => {
    it('should generate tenant schema name with default prefix', () => {
      expect(getTenantSchemaName('123')).toBe('tenant_123')
      expect(getTenantSchemaName('acme')).toBe('tenant_acme')
      expect(getTenantSchemaName('corp_inc')).toBe('tenant_corp_inc')
    })

    it('should generate tenant schema name with custom prefix', () => {
      expect(getTenantSchemaName('123', { prefix: 'org_' })).toBe('org_123')
      expect(getTenantSchemaName('acme', { prefix: 'customer_' })).toBe('customer_acme')
    })

    it('should throw for invalid resulting schema name', () => {
      expect(() => getTenantSchemaName('123-bad')).toThrow('Invalid tenant schema name')
      expect(() => getTenantSchemaName('')).toThrow('Invalid tenant schema name')
    })
  })

  describe('parseTenantSchemaName', () => {
    it('should extract tenant ID from schema name with default prefix', () => {
      expect(parseTenantSchemaName('tenant_123')).toBe('123')
      expect(parseTenantSchemaName('tenant_acme')).toBe('acme')
      expect(parseTenantSchemaName('tenant_corp_inc')).toBe('corp_inc')
    })

    it('should extract tenant ID with custom prefix', () => {
      expect(parseTenantSchemaName('org_123', { prefix: 'org_' })).toBe('123')
      expect(parseTenantSchemaName('customer_acme', { prefix: 'customer_' })).toBe('acme')
    })

    it('should return null for non-tenant schemas', () => {
      expect(parseTenantSchemaName('public')).toBeNull()
      expect(parseTenantSchemaName('auth')).toBeNull()
      expect(parseTenantSchemaName('org_123')).toBeNull() // default prefix doesn't match
    })

    it('should return null for prefix-only schema', () => {
      expect(parseTenantSchemaName('tenant_')).toBeNull()
      expect(parseTenantSchemaName('org_', { prefix: 'org_' })).toBeNull()
    })
  })

  describe('isTenantSchema', () => {
    it('should return true for tenant schemas', () => {
      expect(isTenantSchema('tenant_123')).toBe(true)
      expect(isTenantSchema('tenant_acme')).toBe(true)
    })

    it('should return true with custom prefix', () => {
      expect(isTenantSchema('org_123', { prefix: 'org_' })).toBe(true)
    })

    it('should return false for non-tenant schemas', () => {
      expect(isTenantSchema('public')).toBe(false)
      expect(isTenantSchema('auth')).toBe(false)
      expect(isTenantSchema('tenant_')).toBe(false)
    })
  })

  describe('filterTenantSchemas', () => {
    it('should filter to only tenant schemas', () => {
      const schemas = ['public', 'tenant_1', 'tenant_2', 'auth', 'tenant_acme']
      const result = filterTenantSchemas(schemas)
      expect(result).toEqual(['tenant_1', 'tenant_2', 'tenant_acme'])
    })

    it('should filter with custom prefix', () => {
      const schemas = ['public', 'org_1', 'org_2', 'tenant_3']
      const result = filterTenantSchemas(schemas, { prefix: 'org_' })
      expect(result).toEqual(['org_1', 'org_2'])
    })

    it('should return empty array when no tenant schemas exist', () => {
      const schemas = ['public', 'auth', 'admin']
      expect(filterTenantSchemas(schemas)).toEqual([])
    })
  })

  describe('extractTenantIds', () => {
    it('should extract tenant IDs from schema names', () => {
      const schemas = ['public', 'tenant_1', 'tenant_2', 'auth', 'tenant_acme']
      const result = extractTenantIds(schemas)
      expect(result).toEqual(['1', '2', 'acme'])
    })

    it('should extract with custom prefix', () => {
      const schemas = ['public', 'org_alpha', 'org_beta', 'tenant_1']
      const result = extractTenantIds(schemas, { prefix: 'org_' })
      expect(result).toEqual(['alpha', 'beta'])
    })

    it('should return empty array when no tenant schemas exist', () => {
      const schemas = ['public', 'auth']
      expect(extractTenantIds(schemas)).toEqual([])
    })
  })
})

// ============================================================================
// Schema Utilities Tests
// ============================================================================

describe('Schema Utilities', () => {
  describe('resolveSchema', () => {
    it('should return default schema when no options provided', () => {
      expect(resolveSchema('public')).toBe('public')
      expect(resolveSchema('dbo')).toBe('dbo')
    })

    it('should return default schema when options.schema is undefined', () => {
      expect(resolveSchema('public', {})).toBe('public')
      expect(resolveSchema('public', { schema: undefined })).toBe('public')
    })

    it('should return overridden schema from options', () => {
      expect(resolveSchema('public', { schema: 'auth' })).toBe('auth')
      expect(resolveSchema('dbo', { schema: 'tenant_123' })).toBe('tenant_123')
    })

    it('should throw for invalid schema name', () => {
      expect(() => resolveSchema('public', { schema: '' })).toThrow('Invalid schema name')
      expect(() => resolveSchema('public', { schema: '123bad' })).toThrow('Invalid schema name')
      expect(() => resolveSchema('public', { schema: 'bad-name' })).toThrow('Invalid schema name')
    })
  })

  describe('qualifyTableName', () => {
    it('should qualify table name with schema using postgres escaping', () => {
      const escapePostgres = (id: string) => `"${id.replace(/"/g, '""')}"`
      expect(qualifyTableName('public', 'users', escapePostgres)).toBe('"public"."users"')
      expect(qualifyTableName('auth', 'sessions', escapePostgres)).toBe('"auth"."sessions"')
    })

    it('should qualify table name with schema using mysql escaping', () => {
      const escapeMySQL = (id: string) => `\`${id.replace(/`/g, '``')}\``
      expect(qualifyTableName('mydb', 'users', escapeMySQL)).toBe('`mydb`.`users`')
    })

    it('should handle special characters in identifiers', () => {
      const escapePostgres = (id: string) => `"${id.replace(/"/g, '""')}"`
      expect(qualifyTableName('my"schema', 'user"table', escapePostgres)).toBe(
        '"my""schema"."user""table"'
      )
    })
  })
})

// ============================================================================
// Error Detection Utilities Tests
// ============================================================================

describe('Error Detection Utilities', () => {
  describe('extractErrorInfo', () => {
    it('should extract error info from standard error object', () => {
      const error = { code: '23505', message: 'Unique constraint violation' }
      const info = extractErrorInfo(error)
      expect(info.code).toBe('23505')
      expect(info.message).toBe('unique constraint violation')
      expect(info.originalMessage).toBe('Unique constraint violation')
      expect(info.number).toBeUndefined()
    })

    it('should extract error info with MSSQL number', () => {
      const error = { code: '2627', message: 'Cannot insert duplicate key', number: 2627 }
      const info = extractErrorInfo(error)
      expect(info.code).toBe('2627')
      expect(info.number).toBe(2627)
    })

    it('should handle missing fields gracefully', () => {
      const info = extractErrorInfo({})
      expect(info.code).toBe('')
      expect(info.message).toBe('')
      expect(info.originalMessage).toBe('')
      expect(info.number).toBeUndefined()
    })

    it('should handle non-object errors', () => {
      const info = extractErrorInfo(null)
      expect(info.code).toBe('')
      expect(info.message).toBe('')
    })
  })

  describe('createErrorMatcher', () => {
    it('should match by error code', () => {
      const matcher = createErrorMatcher({ codes: ['23505', '23000'] })
      expect(matcher({ code: '23505' })).toBe(true)
      expect(matcher({ code: '23000' })).toBe(true)
      expect(matcher({ code: '00000' })).toBe(false)
    })

    it('should match by MSSQL error number', () => {
      const matcher = createErrorMatcher({ numbers: [2627, 2601] })
      expect(matcher({ number: 2627 })).toBe(true)
      expect(matcher({ number: 2601 })).toBe(true)
      expect(matcher({ number: 547 })).toBe(false)
    })

    it('should match by message substring (case-insensitive)', () => {
      const matcher = createErrorMatcher({ messages: ['unique constraint', 'duplicate key'] })
      expect(matcher({ message: 'UNIQUE CONSTRAINT violation' })).toBe(true)
      expect(matcher({ message: 'Cannot insert Duplicate Key' })).toBe(true)
      expect(matcher({ message: 'some other error' })).toBe(false)
    })

    it('should combine multiple match types (OR logic)', () => {
      const matcher = createErrorMatcher({
        codes: ['23505'],
        numbers: [2627],
        messages: ['unique']
      })
      expect(matcher({ code: '23505' })).toBe(true)
      expect(matcher({ number: 2627 })).toBe(true)
      expect(matcher({ message: 'Unique constraint' })).toBe(true)
      expect(matcher({ code: '00000', message: 'other error' })).toBe(false)
    })

    it('should return false for empty config', () => {
      const matcher = createErrorMatcher({})
      expect(matcher({ code: '23505' })).toBe(false)
    })
  })

  describe('errorMatchers (pre-built)', () => {
    describe('postgres', () => {
      it('should detect unique constraint errors', () => {
        expect(errorMatchers.postgres.uniqueConstraint({ code: '23505' })).toBe(true)
        expect(errorMatchers.postgres.uniqueConstraint({ message: 'unique constraint' })).toBe(true)
      })

      it('should detect foreign key errors', () => {
        expect(errorMatchers.postgres.foreignKey({ code: '23503' })).toBe(true)
        expect(errorMatchers.postgres.foreignKey({ message: 'foreign key constraint' })).toBe(true)
      })

      it('should detect not-null errors', () => {
        expect(errorMatchers.postgres.notNull({ code: '23502' })).toBe(true)
        expect(errorMatchers.postgres.notNull({ message: 'not-null constraint' })).toBe(true)
      })
    })

    describe('mysql', () => {
      it('should detect unique constraint errors', () => {
        expect(errorMatchers.mysql.uniqueConstraint({ code: 'ER_DUP_ENTRY' })).toBe(true)
        expect(errorMatchers.mysql.uniqueConstraint({ code: '1062' })).toBe(true)
        expect(errorMatchers.mysql.uniqueConstraint({ message: 'Duplicate entry' })).toBe(true)
      })

      it('should detect foreign key errors', () => {
        expect(errorMatchers.mysql.foreignKey({ code: 'ER_ROW_IS_REFERENCED' })).toBe(true)
        expect(errorMatchers.mysql.foreignKey({ code: '1451' })).toBe(true)
        expect(errorMatchers.mysql.foreignKey({ code: '1452' })).toBe(true)
      })

      it('should detect not-null errors', () => {
        expect(errorMatchers.mysql.notNull({ code: 'ER_BAD_NULL_ERROR' })).toBe(true)
        expect(errorMatchers.mysql.notNull({ code: '1048' })).toBe(true)
      })
    })

    describe('sqlite', () => {
      it('should detect unique constraint errors by message', () => {
        expect(errorMatchers.sqlite.uniqueConstraint({ message: 'UNIQUE constraint failed' })).toBe(
          true
        )
      })

      it('should detect foreign key errors by message', () => {
        expect(errorMatchers.sqlite.foreignKey({ message: 'FOREIGN KEY constraint failed' })).toBe(
          true
        )
      })

      it('should detect not-null errors by message', () => {
        expect(errorMatchers.sqlite.notNull({ message: 'NOT NULL constraint failed' })).toBe(true)
      })
    })

    describe('mssql', () => {
      it('should detect unique constraint errors by code and number', () => {
        expect(errorMatchers.mssql.uniqueConstraint({ code: '2627' })).toBe(true)
        expect(errorMatchers.mssql.uniqueConstraint({ number: 2627 })).toBe(true)
        expect(errorMatchers.mssql.uniqueConstraint({ number: 2601 })).toBe(true)
      })

      it('should detect foreign key errors by code and number', () => {
        expect(errorMatchers.mssql.foreignKey({ code: '547' })).toBe(true)
        expect(errorMatchers.mssql.foreignKey({ number: 547 })).toBe(true)
      })

      it('should detect not-null errors by code and number', () => {
        expect(errorMatchers.mssql.notNull({ code: '515' })).toBe(true)
        expect(errorMatchers.mssql.notNull({ number: 515 })).toBe(true)
      })
    })
  })
})
