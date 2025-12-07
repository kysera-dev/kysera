import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import { withDebug } from '../src/debug.js';

describe('Debug SQL Extraction', () => {
  let db: Kysely<any>;
  let database: Database.Database;

  beforeEach(() => {
    database = new Database(':memory:');

    db = new Kysely({
      dialect: new SqliteDialect({
        database,
      }),
    });

    // Create test tables
    database.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        age INTEGER,
        created_at TEXT
      )
    `);

    database.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Insert test data
    database.exec(`
      INSERT INTO users (name, email, age) VALUES
      ('Alice', 'alice@example.com', 25),
      ('Bob', 'bob@example.com', 30)
    `);
  });

  afterEach(() => {
    database.close();
  });

  describe('SELECT queries', () => {
    it('should extract SQL for simple SELECT', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.selectFrom('users').selectAll().execute();

      const metrics = debugDb.getMetrics();
      expect(metrics).toHaveLength(1);

      const sql = metrics[0]?.sql ?? '';
      expect(sql.toLowerCase()).toContain('select');
      expect(sql.toLowerCase()).toContain('from');
      expect(sql.toLowerCase()).toContain('users');
      // Should not be placeholder
      expect(sql).not.toBe('SELECT * FROM ...');
    });

    it('should extract SQL for SELECT with WHERE clause', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.selectFrom('users').selectAll().where('name', '=', 'Alice').execute();

      const metrics = debugDb.getMetrics();
      const sql = metrics[0]?.sql ?? '';

      expect(sql.toLowerCase()).toContain('select');
      expect(sql.toLowerCase()).toContain('where');
      expect(sql.toLowerCase()).toContain('name');
    });

    it('should extract parameters for SELECT with WHERE', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.selectFrom('users').selectAll().where('name', '=', 'Alice').where('age', '>', 20).execute();

      const metrics = debugDb.getMetrics();
      const params = metrics[0]?.params ?? [];

      expect(params).toHaveLength(2);
      expect(params).toContain('Alice');
      expect(params).toContain(20);
    });

    it('should extract SQL for complex SELECT with JOIN', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb
        .selectFrom('users')
        .innerJoin('posts', 'posts.user_id', 'users.id')
        .select(['users.name', 'posts.title'])
        .where('users.age', '>', 18)
        .execute();

      const metrics = debugDb.getMetrics();
      const sql = metrics[0]?.sql ?? '';

      expect(sql.toLowerCase()).toContain('select');
      expect(sql.toLowerCase()).toContain('join');
      expect(sql.toLowerCase()).toContain('users');
      expect(sql.toLowerCase()).toContain('posts');
    });

    it('should extract SQL for SELECT with ORDER BY and LIMIT', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.selectFrom('users').selectAll().orderBy('name', 'asc').limit(10).execute();

      const metrics = debugDb.getMetrics();
      const sql = metrics[0]?.sql ?? '';

      expect(sql.toLowerCase()).toContain('order by');
      expect(sql.toLowerCase()).toContain('limit');
    });
  });

  describe('INSERT queries', () => {
    it('should extract SQL for simple INSERT', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb
        .insertInto('users')
        .values({
          name: 'Charlie',
          email: 'charlie@example.com',
          age: 28,
        })
        .execute();

      const metrics = debugDb.getMetrics();
      const sql = metrics[0]?.sql ?? '';

      expect(sql.toLowerCase()).toContain('insert');
      expect(sql.toLowerCase()).toContain('users');
      // Should not be placeholder
      expect(sql).not.toBe('INSERT INTO ...');
    });

    it('should extract parameters for INSERT', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb
        .insertInto('users')
        .values({
          name: 'Dave',
          email: 'dave@example.com',
          age: 35,
        })
        .execute();

      const metrics = debugDb.getMetrics();
      const params = metrics[0]?.params ?? [];

      expect(params).toHaveLength(3);
      expect(params).toContain('Dave');
      expect(params).toContain('dave@example.com');
      expect(params).toContain(35);
    });

    it('should extract SQL for batch INSERT', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb
        .insertInto('users')
        .values([
          { name: 'Eve', email: 'eve@example.com', age: 22 },
          { name: 'Frank', email: 'frank@example.com', age: 27 },
        ])
        .execute();

      const metrics = debugDb.getMetrics();
      const sql = metrics[0]?.sql ?? '';
      const params = metrics[0]?.params ?? [];

      expect(sql.toLowerCase()).toContain('insert');
      expect(params).toHaveLength(6); // 2 rows x 3 columns
    });
  });

  describe('UPDATE queries', () => {
    it('should extract SQL for simple UPDATE', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.updateTable('users').set({ age: 26 }).where('name', '=', 'Alice').execute();

      const metrics = debugDb.getMetrics();
      const sql = metrics[0]?.sql ?? '';

      expect(sql.toLowerCase()).toContain('update');
      expect(sql.toLowerCase()).toContain('users');
      expect(sql.toLowerCase()).toContain('set');
      // Should not be placeholder
      expect(sql).not.toBe('UPDATE ...');
    });

    it('should extract parameters for UPDATE', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb
        .updateTable('users')
        .set({ age: 31, email: 'bob.new@example.com' })
        .where('name', '=', 'Bob')
        .execute();

      const metrics = debugDb.getMetrics();
      const params = metrics[0]?.params ?? [];

      expect(params.length).toBeGreaterThanOrEqual(3);
      expect(params).toContain(31);
      expect(params).toContain('bob.new@example.com');
      expect(params).toContain('Bob');
    });
  });

  describe('DELETE queries', () => {
    it('should extract SQL for simple DELETE', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.deleteFrom('users').where('age', '<', 18).execute();

      const metrics = debugDb.getMetrics();
      const sql = metrics[0]?.sql ?? '';

      expect(sql.toLowerCase()).toContain('delete');
      expect(sql.toLowerCase()).toContain('from');
      expect(sql.toLowerCase()).toContain('users');
      // Should not be placeholder
      expect(sql).not.toBe('DELETE FROM ...');
    });

    it('should extract parameters for DELETE', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.deleteFrom('users').where('name', '=', 'Alice').execute();

      const metrics = debugDb.getMetrics();
      const params = metrics[0]?.params ?? [];

      expect(params).toContain('Alice');
    });
  });

  describe('Transaction queries', () => {
    it('should extract SQL for all queries in transaction', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.transaction().execute(async (trx) => {
        await trx.insertInto('users').values({ name: 'Grace', email: 'grace@example.com', age: 24 }).execute();

        await trx.updateTable('users').set({ age: 25 }).where('name', '=', 'Grace').execute();

        await trx.selectFrom('users').selectAll().where('name', '=', 'Grace').execute();
      });

      const metrics = debugDb.getMetrics();

      // Should have at least 3 queries (INSERT, UPDATE, SELECT)
      expect(metrics.length).toBeGreaterThanOrEqual(3);

      const sqls = metrics.map((m) => m.sql.toLowerCase());
      expect(sqls.some((s) => s.includes('insert'))).toBe(true);
      expect(sqls.some((s) => s.includes('update'))).toBe(true);
      expect(sqls.some((s) => s.includes('select'))).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle queries with NULL values', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb
        .insertInto('users')
        .values({
          name: 'Henry',
          email: 'henry@example.com',
          age: null,
        })
        .execute();

      const metrics = debugDb.getMetrics();
      const params = metrics[0]?.params ?? [];

      expect(params).toContain(null);
    });

    it('should handle queries with multiple parameter types', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb
        .selectFrom('users')
        .selectAll()
        .where('name', '=', 'Alice')
        .where('age', '>', 20)
        .where('email', 'like', '%example.com')
        .execute();

      const metrics = debugDb.getMetrics();
      const params = metrics[0]?.params ?? [];

      expect(params).toHaveLength(3);
      expect(params[0]).toBe('Alice');
      expect(params[1]).toBe(20);
      expect(params[2]).toBe('%example.com');
    });

    it('should handle subqueries', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb
        .selectFrom('users')
        .selectAll()
        .where('id', 'in', (eb: any) => eb.selectFrom('posts').select('user_id').where('title', '=', 'Test'))
        .execute();

      const metrics = debugDb.getMetrics();
      const sql = metrics[0]?.sql ?? '';

      expect(sql.toLowerCase()).toContain('select');
      // Subquery might be inlined or not depending on Kysely version
      expect(sql.toLowerCase()).toContain('in');
    });
  });
});
