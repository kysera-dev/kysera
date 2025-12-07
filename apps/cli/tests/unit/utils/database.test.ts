import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, testDatabaseConnection, introspectDatabase, runQuery } from '@/utils/database';
import { Kysely, sql } from 'kysely';
import type { Database } from '@/utils/database';

// Mock pg and mysql2 to avoid actual network connections
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    end: vi.fn(),
  })),
}));

vi.mock('mysql2', () => ({
  createPool: vi.fn().mockImplementation(() => ({
    end: vi.fn(),
  })),
}));

describe('createDatabaseConnection', () => {
  it('should create a PostgreSQL connection', async () => {
    const config = {
      dialect: 'postgres' as const,
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      user: 'testuser',
      password: 'testpass',
    };

    const db = await createDatabaseConnection(config);
    expect(db).toBeDefined();
    expect(db.destroy).toBeDefined();
    await db.destroy();
  });

  it('should create a MySQL connection', async () => {
    const config = {
      dialect: 'mysql' as const,
      host: 'localhost',
      port: 3306,
      database: 'testdb',
      user: 'testuser',
      password: 'testpass',
    };

    const db = await createDatabaseConnection(config);
    expect(db).toBeDefined();
    expect(db.destroy).toBeDefined();
    await db.destroy();
  });

  it('should create a SQLite connection', async () => {
    const config = {
      dialect: 'sqlite' as const,
      database: ':memory:',
    };

    const db = await createDatabaseConnection(config);
    expect(db).toBeDefined();
    expect(db.destroy).toBeDefined();
    await db.destroy();
  });

  it('should use connection string if provided', async () => {
    const config = {
      dialect: 'postgres' as const,
      connectionString: 'postgres://user:pass@localhost:5432/db',
    };

    const db = await createDatabaseConnection(config);
    expect(db).toBeDefined();
    await db.destroy();
  });

  it('should apply pool configuration', async () => {
    const config = {
      dialect: 'postgres' as const,
      host: 'localhost',
      database: 'testdb',
      pool: {
        min: 5,
        max: 20,
      },
    };

    const db = await createDatabaseConnection(config);
    expect(db).toBeDefined();
    await db.destroy();
  });

  it('should throw for unsupported dialect', async () => {
    const config = {
      dialect: 'mongodb' as any,
      database: 'testdb',
    };

    await expect(createDatabaseConnection(config)).rejects.toThrow();
  });
});

describe('testDatabaseConnection', () => {
  it('should successfully test connection', async () => {
    const config = {
      dialect: 'sqlite' as const,
      database: ':memory:',
    };

    const db = await createDatabaseConnection(config) as Kysely<Database>;
    const result = await testDatabaseConnection(db);
    expect(result).toBe(true);
  });

  it('should return false on connection error', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      execute: vi.fn().mockRejectedValue(new Error('Connection failed')),
      destroy: vi.fn(),
    };

    const result = await testDatabaseConnection(mockDb as any);
    expect(result).toBe(false);
    expect(mockDb.destroy).toHaveBeenCalled();
  });
});

describe('introspectDatabase', () => {
  it('should return database tables', async () => {
    const config = {
      dialect: 'sqlite' as const,
      database: ':memory:',
    };

    const db = await createDatabaseConnection(config) as Kysely<Database>;

    // Create some test tables
    await sql`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`.execute(db);
    await sql`CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`.execute(db);
    await sql`CREATE TABLE comments (id INTEGER PRIMARY KEY, content TEXT)`.execute(db);

    const result = await introspectDatabase(db);

    expect(result.tables).toBeDefined();
    expect(result.tables.length).toBeGreaterThanOrEqual(3);
    expect(result.tables.map((t: any) => t.name)).toContain('users');
    expect(result.tables.map((t: any) => t.name)).toContain('posts');
    expect(result.tables.map((t: any) => t.name)).toContain('comments');

    await db.destroy();
  });

  it('should filter tables by options', async () => {
    const config = {
      dialect: 'sqlite' as const,
      database: ':memory:',
    };

    const db = await createDatabaseConnection(config) as Kysely<Database>;

    // Create test tables with different names and patterns
    await sql`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`.execute(db);
    await sql`CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`.execute(db);
    await sql`CREATE TABLE _migrations (id INTEGER PRIMARY KEY, version TEXT)`.execute(db);

    const result = await introspectDatabase(db, {
      excludePattern: '^_',
    });

    expect(result.tables).toBeDefined();
    expect(result.tables.map((t: any) => t.name)).not.toContain('_migrations');
    expect(result.tables.map((t: any) => t.name)).toContain('users');
    expect(result.tables.map((t: any) => t.name)).toContain('posts');

    await db.destroy();
  });
});

describe('runQuery', () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    const config = {
      dialect: 'sqlite' as const,
      database: ':memory:',
    };

    db = await createDatabaseConnection(config) as Kysely<Database>;

    // Create a test table
    await sql`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`.execute(db);
  });

  afterEach(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('should execute a SELECT query', async () => {
    // Insert test data
    await sql`INSERT INTO users (name) VALUES ('User 1')`.execute(db);
    await sql`INSERT INTO users (name) VALUES ('User 2')`.execute(db);

    const result = await runQuery(db, 'SELECT * FROM users') as any[];

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('name');
    expect(result[0].name).toBe('User 1');
    expect(result[1].name).toBe('User 2');
  });

  it('should execute an INSERT query', async () => {
    const result = await runQuery(db, "INSERT INTO users (name) VALUES ('Test User')") as any;

    // For SQLite, result.rows is returned from runQuery
    expect(result).toBeDefined();

    // Verify the insert by querying
    const selectResult = await runQuery(db, "SELECT * FROM users WHERE name = 'Test User'") as any[];
    expect(selectResult).toHaveLength(1);
    expect(selectResult[0].name).toBe('Test User');
  });

  it('should execute an UPDATE query', async () => {
    // Insert a user first
    await sql`INSERT INTO users (name) VALUES ('Original Name')`.execute(db);

    const result = await runQuery(db, "UPDATE users SET name = 'Updated Name' WHERE id = 1") as any;

    expect(result).toBeDefined();

    // Verify the update by querying
    const selectResult = await runQuery(db, 'SELECT * FROM users WHERE id = 1') as any[];
    expect(selectResult).toHaveLength(1);
    expect(selectResult[0].name).toBe('Updated Name');
  });

  it('should execute a DELETE query', async () => {
    // Insert a user first
    await sql`INSERT INTO users (name) VALUES ('To Delete')`.execute(db);

    const result = await runQuery(db, 'DELETE FROM users WHERE id = 1') as any;

    expect(result).toBeDefined();

    // Verify the delete by querying
    const selectResult = await runQuery(db, 'SELECT * FROM users WHERE id = 1') as any[];
    expect(selectResult).toHaveLength(0);
  });

  it('should handle query errors', async () => {
    await expect(runQuery(db, 'SELECT * FROM invalid_table')).rejects.toThrow();
  });
});
