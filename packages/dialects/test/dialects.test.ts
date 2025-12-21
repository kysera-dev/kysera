/**
 * @kysera/dialects - Comprehensive Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';

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
  truncateAllTables,
} from '../src/index.js';

// ============================================================================
// Test Types
// ============================================================================

interface TestDB {
  users: {
    id: number;
    name: string;
    email: string;
    created_at: string;
  };
  posts: {
    id: number;
    user_id: number;
    title: string;
    content: string;
  };
}

// ============================================================================
// Factory Tests
// ============================================================================

describe('Factory', () => {
  describe('getAdapter', () => {
    it('should return postgres adapter', () => {
      const adapter = getAdapter('postgres');
      expect(adapter.dialect).toBe('postgres');
      expect(adapter).toBe(postgresAdapter);
    });

    it('should return mysql adapter', () => {
      const adapter = getAdapter('mysql');
      expect(adapter.dialect).toBe('mysql');
      expect(adapter).toBe(mysqlAdapter);
    });

    it('should return sqlite adapter', () => {
      const adapter = getAdapter('sqlite');
      expect(adapter.dialect).toBe('sqlite');
      expect(adapter).toBe(sqliteAdapter);
    });

    it('should throw for unknown dialect', () => {
      expect(() => getAdapter('unknown' as any)).toThrow('Unknown dialect: unknown');
    });
  });

  describe('createDialectAdapter', () => {
    it('should create new postgres adapter instance', () => {
      const adapter = createDialectAdapter('postgres');
      expect(adapter).toBeInstanceOf(PostgresAdapter);
      expect(adapter).not.toBe(postgresAdapter);
    });

    it('should create new mysql adapter instance', () => {
      const adapter = createDialectAdapter('mysql');
      expect(adapter).toBeInstanceOf(MySQLAdapter);
      expect(adapter).not.toBe(mysqlAdapter);
    });

    it('should create new sqlite adapter instance', () => {
      const adapter = createDialectAdapter('sqlite');
      expect(adapter).toBeInstanceOf(SQLiteAdapter);
      expect(adapter).not.toBe(sqliteAdapter);
    });

    it('should throw for unknown dialect', () => {
      expect(() => createDialectAdapter('unknown' as any)).toThrow('Unknown dialect: unknown');
    });
  });

  describe('registerAdapter', () => {
    it('should register custom adapter', () => {
      const customAdapter = new SQLiteAdapter();
      (customAdapter as any).dialect = 'sqlite';
      registerAdapter(customAdapter);
      expect(getAdapter('sqlite')).toBe(customAdapter);
    });
  });
});

// ============================================================================
// Connection Tests
// ============================================================================

describe('Connection', () => {
  describe('parseConnectionUrl', () => {
    it('should parse postgresql URL with all components', () => {
      const config = parseConnectionUrl('postgresql://user:pass@host.example.com:5432/mydb?ssl=true');
      expect(config).toEqual({
        host: 'host.example.com',
        port: 5432,
        database: 'mydb',
        user: 'user',
        password: 'pass',
        ssl: true,
      });
    });

    it('should parse URL without port', () => {
      const config = parseConnectionUrl('postgresql://user:pass@localhost/mydb');
      expect(config.port).toBeUndefined();
    });

    it('should parse URL without auth', () => {
      const config = parseConnectionUrl('postgresql://localhost:5432/mydb');
      expect(config.user).toBeUndefined();
      expect(config.password).toBeUndefined();
    });

    it('should parse URL with sslmode=require', () => {
      const config = parseConnectionUrl('postgresql://localhost/mydb?sslmode=require');
      expect(config.ssl).toBe(true);
    });

    it('should parse mysql URL', () => {
      const config = parseConnectionUrl('mysql://root:secret@127.0.0.1:3306/testdb');
      expect(config).toEqual({
        host: '127.0.0.1',
        port: 3306,
        database: 'testdb',
        user: 'root',
        password: 'secret',
        ssl: false,
      });
    });
  });

  describe('buildConnectionUrl', () => {
    it('should build postgres URL', () => {
      const url = buildConnectionUrl('postgres', {
        host: 'localhost',
        database: 'mydb',
      });
      expect(url).toBe('postgresql://localhost:5432/mydb');
    });

    it('should build mysql URL with auth', () => {
      const url = buildConnectionUrl('mysql', {
        host: 'db.example.com',
        port: 3307,
        database: 'mydb',
        user: 'admin',
        password: 'secret',
      });
      expect(url).toBe('mysql://admin:secret@db.example.com:3307/mydb');
    });

    it('should build URL with ssl', () => {
      const url = buildConnectionUrl('postgres', {
        host: 'localhost',
        database: 'mydb',
        ssl: true,
      });
      expect(url).toBe('postgresql://localhost:5432/mydb?ssl=true');
    });

    it('should build sqlite URL without port', () => {
      const url = buildConnectionUrl('sqlite', {
        database: 'test.db',
      });
      expect(url).toBe('sqlite://localhost/test.db');
    });
  });

  describe('getDefaultPort', () => {
    it('should return 5432 for postgres', () => {
      expect(getDefaultPort('postgres')).toBe(5432);
    });

    it('should return 3306 for mysql', () => {
      expect(getDefaultPort('mysql')).toBe(3306);
    });

    it('should return null for sqlite', () => {
      expect(getDefaultPort('sqlite')).toBeNull();
    });
  });
});

// ============================================================================
// PostgresAdapter Tests
// ============================================================================

describe('PostgresAdapter', () => {
  const adapter = new PostgresAdapter();

  it('should have correct dialect', () => {
    expect(adapter.dialect).toBe('postgres');
  });

  it('should return correct default port', () => {
    expect(adapter.getDefaultPort()).toBe(5432);
  });

  it('should return correct timestamp SQL', () => {
    expect(adapter.getCurrentTimestamp()).toBe('CURRENT_TIMESTAMP');
  });

  it('should escape identifiers with double quotes', () => {
    expect(adapter.escapeIdentifier('user-table')).toBe('"user-table"');
    expect(adapter.escapeIdentifier('table"with"quotes')).toBe('"table""with""quotes"');
  });

  it('should format date as ISO string', () => {
    const date = new Date('2024-01-15T10:30:00.000Z');
    expect(adapter.formatDate(date)).toBe('2024-01-15T10:30:00.000Z');
  });

  describe('error detection', () => {
    it('should detect unique constraint error by code', () => {
      expect(adapter.isUniqueConstraintError({ code: '23505' })).toBe(true);
    });

    it('should detect unique constraint error by message', () => {
      expect(adapter.isUniqueConstraintError({ message: 'Unique constraint violation' })).toBe(true);
    });

    it('should detect foreign key error by code', () => {
      expect(adapter.isForeignKeyError({ code: '23503' })).toBe(true);
    });

    it('should detect foreign key error by message', () => {
      expect(adapter.isForeignKeyError({ message: 'Foreign key constraint violation' })).toBe(true);
    });

    it('should detect not-null error by code', () => {
      expect(adapter.isNotNullError({ code: '23502' })).toBe(true);
    });

    it('should detect not-null error by message', () => {
      expect(adapter.isNotNullError({ message: 'not-null constraint violation' })).toBe(true);
    });

    it('should not detect errors that do not match', () => {
      expect(adapter.isUniqueConstraintError({ code: '00000' })).toBe(false);
      expect(adapter.isForeignKeyError({ message: 'some other error' })).toBe(false);
      expect(adapter.isNotNullError({})).toBe(false);
    });
  });
});

// ============================================================================
// MySQLAdapter Tests
// ============================================================================

describe('MySQLAdapter', () => {
  const adapter = new MySQLAdapter();

  it('should have correct dialect', () => {
    expect(adapter.dialect).toBe('mysql');
  });

  it('should return correct default port', () => {
    expect(adapter.getDefaultPort()).toBe(3306);
  });

  it('should return correct timestamp SQL', () => {
    expect(adapter.getCurrentTimestamp()).toBe('CURRENT_TIMESTAMP');
  });

  it('should escape identifiers with backticks', () => {
    expect(adapter.escapeIdentifier('user-table')).toBe('`user-table`');
    expect(adapter.escapeIdentifier('table`with`backticks')).toBe('`table``with``backticks`');
  });

  it('should format date in MySQL datetime format', () => {
    const date = new Date('2024-01-15T10:30:45.123Z');
    expect(adapter.formatDate(date)).toBe('2024-01-15 10:30:45');
  });

  describe('error detection', () => {
    it('should detect unique constraint error by ER_DUP_ENTRY', () => {
      expect(adapter.isUniqueConstraintError({ code: 'ER_DUP_ENTRY' })).toBe(true);
    });

    it('should detect unique constraint error by code 1062', () => {
      expect(adapter.isUniqueConstraintError({ code: '1062' })).toBe(true);
    });

    it('should detect unique constraint error by message', () => {
      expect(adapter.isUniqueConstraintError({ message: 'Duplicate entry for key' })).toBe(true);
    });

    it('should detect foreign key error by ER_ROW_IS_REFERENCED', () => {
      expect(adapter.isForeignKeyError({ code: 'ER_ROW_IS_REFERENCED' })).toBe(true);
    });

    it('should detect foreign key error by codes 1451/1452', () => {
      expect(adapter.isForeignKeyError({ code: '1451' })).toBe(true);
      expect(adapter.isForeignKeyError({ code: '1452' })).toBe(true);
    });

    it('should detect not-null error by ER_BAD_NULL_ERROR', () => {
      expect(adapter.isNotNullError({ code: 'ER_BAD_NULL_ERROR' })).toBe(true);
    });

    it('should detect not-null error by code 1048', () => {
      expect(adapter.isNotNullError({ code: '1048' })).toBe(true);
    });
  });
});

// ============================================================================
// SQLiteAdapter Tests
// ============================================================================

describe('SQLiteAdapter', () => {
  const adapter = new SQLiteAdapter();

  it('should have correct dialect', () => {
    expect(adapter.dialect).toBe('sqlite');
  });

  it('should return null for default port (file-based)', () => {
    expect(adapter.getDefaultPort()).toBeNull();
  });

  it('should return correct timestamp SQL', () => {
    expect(adapter.getCurrentTimestamp()).toBe("datetime('now')");
  });

  it('should escape identifiers with double quotes', () => {
    expect(adapter.escapeIdentifier('user-table')).toBe('"user-table"');
    expect(adapter.escapeIdentifier('table"with"quotes')).toBe('"table""with""quotes"');
  });

  it('should format date as ISO string', () => {
    const date = new Date('2024-01-15T10:30:00.000Z');
    expect(adapter.formatDate(date)).toBe('2024-01-15T10:30:00.000Z');
  });

  describe('error detection', () => {
    it('should detect unique constraint error by message', () => {
      expect(adapter.isUniqueConstraintError({ message: 'UNIQUE constraint failed: users.email' })).toBe(true);
    });

    it('should detect foreign key error by message', () => {
      expect(adapter.isForeignKeyError({ message: 'FOREIGN KEY constraint failed' })).toBe(true);
    });

    it('should detect not-null error by message', () => {
      expect(adapter.isNotNullError({ message: 'NOT NULL constraint failed: users.name' })).toBe(true);
    });

    it('should not detect errors that do not match', () => {
      expect(adapter.isUniqueConstraintError({ message: 'some other error' })).toBe(false);
      expect(adapter.isForeignKeyError({ message: 'constraint error' })).toBe(false);
      expect(adapter.isNotNullError({})).toBe(false);
    });
  });
});

// ============================================================================
// Database Integration Tests (SQLite)
// ============================================================================

describe('Database Integration (SQLite)', () => {
  let db: Kysely<TestDB>;

  beforeEach(async () => {
    const database = new Database(':memory:');
    db = new Kysely<TestDB>({
      dialect: new SqliteDialect({ database }),
    });

    // Create test tables
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('email', 'text', (col) => col.notNull().unique())
      .addColumn('created_at', 'text', (col) => col.notNull())
      .execute();

    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .addColumn('user_id', 'integer', (col) => col.notNull())
      .addColumn('title', 'text', (col) => col.notNull())
      .addColumn('content', 'text', (col) => col.notNull())
      .execute();

    // Insert test data
    await db
      .insertInto('users')
      .values([
        { id: 1, name: 'Alice', email: 'alice@example.com', created_at: '2024-01-01' },
        { id: 2, name: 'Bob', email: 'bob@example.com', created_at: '2024-01-02' },
      ])
      .execute();

    await db
      .insertInto('posts')
      .values([
        { id: 1, user_id: 1, title: 'Hello', content: 'World' },
        { id: 2, user_id: 1, title: 'Second', content: 'Post' },
      ])
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('tableExists', () => {
    it('should return true for existing table', async () => {
      expect(await tableExists(db, 'users', 'sqlite')).toBe(true);
      expect(await tableExists(db, 'posts', 'sqlite')).toBe(true);
    });

    it('should return false for non-existing table', async () => {
      expect(await tableExists(db, 'nonexistent', 'sqlite')).toBe(false);
    });

    it('should return false for sqlite_* tables', async () => {
      // sqlite_master shouldn't be returned as a user table
      const tables = await getTables(db, 'sqlite');
      expect(tables).not.toContain('sqlite_master');
    });
  });

  describe('getTableColumns', () => {
    it('should return column names for users table', async () => {
      const columns = await getTableColumns(db, 'users', 'sqlite');
      expect(columns).toContain('id');
      expect(columns).toContain('name');
      expect(columns).toContain('email');
      expect(columns).toContain('created_at');
    });

    it('should return column names for posts table', async () => {
      const columns = await getTableColumns(db, 'posts', 'sqlite');
      expect(columns).toContain('id');
      expect(columns).toContain('user_id');
      expect(columns).toContain('title');
      expect(columns).toContain('content');
    });

    it('should return empty array for non-existing table', async () => {
      const columns = await getTableColumns(db, 'nonexistent', 'sqlite');
      expect(columns).toEqual([]);
    });
  });

  describe('getTables', () => {
    it('should return all user tables', async () => {
      const tables = await getTables(db, 'sqlite');
      expect(tables).toContain('users');
      expect(tables).toContain('posts');
      expect(tables.length).toBe(2);
    });
  });

  describe('truncateAllTables', () => {
    it('should truncate all tables', async () => {
      await truncateAllTables(db, 'sqlite');

      const users = await db.selectFrom('users').selectAll().execute();
      const posts = await db.selectFrom('posts').selectAll().execute();

      expect(users).toEqual([]);
      expect(posts).toEqual([]);
    });

    it('should exclude specified tables', async () => {
      await truncateAllTables(db, 'sqlite', ['users']);

      const users = await db.selectFrom('users').selectAll().execute();
      const posts = await db.selectFrom('posts').selectAll().execute();

      expect(users.length).toBe(2);
      expect(posts).toEqual([]);
    });
  });
});

// ============================================================================
// Helper Functions Tests
// ============================================================================

describe('Helper Functions', () => {
  describe('escapeIdentifier', () => {
    it('should delegate to adapter for each dialect', () => {
      expect(escapeIdentifier('test', 'postgres')).toBe('"test"');
      expect(escapeIdentifier('test', 'mysql')).toBe('`test`');
      expect(escapeIdentifier('test', 'sqlite')).toBe('"test"');
    });
  });

  describe('getCurrentTimestamp', () => {
    it('should delegate to adapter for each dialect', () => {
      expect(getCurrentTimestamp('postgres')).toBe('CURRENT_TIMESTAMP');
      expect(getCurrentTimestamp('mysql')).toBe('CURRENT_TIMESTAMP');
      expect(getCurrentTimestamp('sqlite')).toBe("datetime('now')");
    });
  });

  describe('formatDate', () => {
    const date = new Date('2024-01-15T10:30:45.123Z');

    it('should format correctly for each dialect', () => {
      expect(formatDate(date, 'postgres')).toBe('2024-01-15T10:30:45.123Z');
      expect(formatDate(date, 'mysql')).toBe('2024-01-15 10:30:45');
      expect(formatDate(date, 'sqlite')).toBe('2024-01-15T10:30:45.123Z');
    });
  });

  describe('isUniqueConstraintError', () => {
    it('should detect for each dialect', () => {
      expect(isUniqueConstraintError({ code: '23505' }, 'postgres')).toBe(true);
      expect(isUniqueConstraintError({ code: 'ER_DUP_ENTRY' }, 'mysql')).toBe(true);
      expect(isUniqueConstraintError({ message: 'UNIQUE constraint failed' }, 'sqlite')).toBe(true);
    });
  });

  describe('isForeignKeyError', () => {
    it('should detect for each dialect', () => {
      expect(isForeignKeyError({ code: '23503' }, 'postgres')).toBe(true);
      expect(isForeignKeyError({ code: 'ER_ROW_IS_REFERENCED' }, 'mysql')).toBe(true);
      expect(isForeignKeyError({ message: 'FOREIGN KEY constraint failed' }, 'sqlite')).toBe(true);
    });
  });

  describe('isNotNullError', () => {
    it('should detect for each dialect', () => {
      expect(isNotNullError({ code: '23502' }, 'postgres')).toBe(true);
      expect(isNotNullError({ code: 'ER_BAD_NULL_ERROR' }, 'mysql')).toBe(true);
      expect(isNotNullError({ message: 'NOT NULL constraint failed' }, 'sqlite')).toBe(true);
    });
  });
});
