import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withDebug,
  formatSQL,
  QueryProfiler,
  type QueryMetrics,
} from '../src/debug.js';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';

// Test database interface
interface TestDB {
  users: {
    id: number;
    name: string;
    email: string;
  };
}

describe('debug', () => {
  let db: Kysely<TestDB>;

  beforeEach(async () => {
    const sqliteDb = new Database(':memory:');
    db = new Kysely<TestDB>({
      dialect: new SqliteDialect({
        database: sqliteDb,
      }),
    });

    // Create test table
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('name', 'varchar(255)')
      .addColumn('email', 'varchar(255)')
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('withDebug', () => {
    it('should wrap database with debug capabilities', () => {
      const debugDb = withDebug(db);

      expect(debugDb.getMetrics).toBeDefined();
      expect(debugDb.clearMetrics).toBeDefined();
      expect(typeof debugDb.getMetrics).toBe('function');
      expect(typeof debugDb.clearMetrics).toBe('function');
    });

    it('should collect query metrics', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.insertInto('users').values({ name: 'Test', email: 'test@example.com' }).execute();

      const metrics = debugDb.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].sql).toContain('insert into');
      expect(metrics[0].duration).toBeGreaterThanOrEqual(0);
      expect(metrics[0].timestamp).toBeDefined();
    });

    it('should include parameters in metrics', async () => {
      const debugDb = withDebug(db, { logQuery: false, logParams: true });

      await debugDb.insertInto('users').values({ name: 'Test', email: 'test@example.com' }).execute();

      const metrics = debugDb.getMetrics();
      expect(metrics[0].params).toBeDefined();
      expect(metrics[0].params).toContain('Test');
      expect(metrics[0].params).toContain('test@example.com');
    });

    it('should log queries when logQuery is true', async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const debugDb = withDebug(db, { logQuery: true, logger: mockLogger });

      await debugDb.selectFrom('users').selectAll().execute();

      expect(mockLogger.debug).toHaveBeenCalled();
      expect(mockLogger.debug.mock.calls.some((call) => call[0].includes('[SQL]'))).toBe(true);
    });

    it('should log parameters when logParams is true', async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const debugDb = withDebug(db, { logQuery: true, logParams: true, logger: mockLogger });

      await debugDb
        .selectFrom('users')
        .where('name', '=', 'TestName')
        .selectAll()
        .execute();

      expect(mockLogger.debug).toHaveBeenCalled();
      expect(mockLogger.debug.mock.calls.some((call) => call[0].includes('[Params]'))).toBe(true);
    });

    it('should log duration', async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const debugDb = withDebug(db, { logQuery: true, logger: mockLogger });

      await debugDb.selectFrom('users').selectAll().execute();

      expect(mockLogger.debug.mock.calls.some((call) => call[0].includes('[Duration]'))).toBe(true);
    });

    it('should detect slow queries', async () => {
      const onSlowQuery = vi.fn();
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      // Use a very small threshold that any query will exceed
      // The threshold check is: duration > slowQueryThreshold
      // A threshold of -1 ensures any query with duration >= 0 triggers slow query
      const debugDb = withDebug(db, {
        logQuery: false,
        slowQueryThreshold: -1,
        onSlowQuery,
        logger: mockLogger,
      });

      await debugDb.selectFrom('users').selectAll().execute();

      expect(onSlowQuery).toHaveBeenCalled();
      const [sql, duration] = onSlowQuery.mock.calls[0];
      expect(sql).toContain('select');
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('should log slow query with default logger when no onSlowQuery provided', async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      // Use a very small threshold that any query will exceed
      const debugDb = withDebug(db, {
        logQuery: false,
        slowQueryThreshold: -1,
        logger: mockLogger,
      });

      await debugDb.selectFrom('users').selectAll().execute();

      expect(mockLogger.warn.mock.calls.some((call) => call[0].includes('[SLOW QUERY]'))).toBe(true);
    });

    it('should clear metrics', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.selectFrom('users').selectAll().execute();
      expect(debugDb.getMetrics().length).toBe(1);

      debugDb.clearMetrics();
      expect(debugDb.getMetrics().length).toBe(0);
    });

    it('should limit metrics with maxMetrics option', async () => {
      const debugDb = withDebug(db, { logQuery: false, maxMetrics: 3 });

      // Execute more queries than maxMetrics
      for (let i = 0; i < 5; i++) {
        await debugDb.selectFrom('users').selectAll().execute();
      }

      const metrics = debugDb.getMetrics();
      expect(metrics.length).toBe(3);
    });

    it('should use circular buffer for metrics', async () => {
      const debugDb = withDebug(db, { logQuery: false, maxMetrics: 2 });

      // Insert users to generate different queries
      await debugDb.insertInto('users').values({ name: 'User1', email: 'u1@test.com' }).execute();
      await debugDb.insertInto('users').values({ name: 'User2', email: 'u2@test.com' }).execute();
      await debugDb.selectFrom('users').selectAll().execute();

      const metrics = debugDb.getMetrics();
      expect(metrics.length).toBe(2);
      // Should keep the last 2 queries (second insert and select)
      expect(metrics[1].sql).toContain('select');
    });

    it('should return copy of metrics array', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      await debugDb.selectFrom('users').selectAll().execute();

      const metrics1 = debugDb.getMetrics();
      const metrics2 = debugDb.getMetrics();

      expect(metrics1).not.toBe(metrics2);
      expect(metrics1).toEqual(metrics2);
    });

    it('should use default maxMetrics of 1000', async () => {
      const debugDb = withDebug(db, { logQuery: false });

      // Execute a few queries
      for (let i = 0; i < 5; i++) {
        await debugDb.selectFrom('users').selectAll().execute();
      }

      // Should accept all queries (under default limit)
      expect(debugDb.getMetrics().length).toBe(5);
    });
  });

  describe('formatSQL', () => {
    it('should add newline before SELECT', () => {
      const sql = 'prefix SELECT * FROM users';
      const formatted = formatSQL(sql);
      expect(formatted).toContain('\nSELECT');
    });

    it('should add newline before FROM', () => {
      const sql = 'SELECT * FROM users';
      const formatted = formatSQL(sql);
      expect(formatted).toContain('\nFROM');
    });

    it('should add newline before WHERE', () => {
      const sql = 'SELECT * FROM users WHERE id = 1';
      const formatted = formatSQL(sql);
      expect(formatted).toContain('\nWHERE');
    });

    it('should add newline before JOIN', () => {
      const sql = 'SELECT * FROM users JOIN posts ON users.id = posts.user_id';
      const formatted = formatSQL(sql);
      expect(formatted).toContain('\nJOIN');
    });

    it('should add newline before ORDER BY', () => {
      const sql = 'SELECT * FROM users ORDER BY name';
      const formatted = formatSQL(sql);
      expect(formatted).toContain('\nORDER BY');
    });

    it('should add newline before GROUP BY', () => {
      const sql = 'SELECT name, COUNT(*) FROM users GROUP BY name';
      const formatted = formatSQL(sql);
      expect(formatted).toContain('\nGROUP BY');
    });

    it('should add newline before HAVING', () => {
      const sql = 'SELECT name, COUNT(*) FROM users GROUP BY name HAVING COUNT(*) > 1';
      const formatted = formatSQL(sql);
      expect(formatted).toContain('\nHAVING');
    });

    it('should add newline before LIMIT', () => {
      const sql = 'SELECT * FROM users LIMIT 10';
      const formatted = formatSQL(sql);
      expect(formatted).toContain('\nLIMIT');
    });

    it('should add newline before OFFSET', () => {
      const sql = 'SELECT * FROM users LIMIT 10 OFFSET 5';
      const formatted = formatSQL(sql);
      expect(formatted).toContain('\nOFFSET');
    });

    it('should handle lowercase keywords', () => {
      const sql = 'prefix select * from users where id = 1';
      const formatted = formatSQL(sql);
      expect(formatted).toContain('\nselect');
      expect(formatted).toContain('\nfrom');
      expect(formatted).toContain('\nwhere');
    });

    it('should trim result', () => {
      const sql = '  SELECT * FROM users  ';
      const formatted = formatSQL(sql);
      expect(formatted.startsWith(' ')).toBe(false);
      expect(formatted.endsWith(' ')).toBe(false);
    });

    it('should format complex queries', () => {
      const sql =
        'SELECT u.name, COUNT(p.id) FROM users u LEFT JOIN posts p ON u.id = p.user_id WHERE u.active = 1 GROUP BY u.name HAVING COUNT(p.id) > 5 ORDER BY u.name LIMIT 10 OFFSET 0';
      const formatted = formatSQL(sql);

      // SELECT at the beginning - trim removes leading newline, so it starts with SELECT
      expect(formatted).toMatch(/^SELECT/);
      expect(formatted).toContain('\nFROM');
      expect(formatted).toContain('\nJOIN');
      expect(formatted).toContain('\nWHERE');
      expect(formatted).toContain('\nGROUP BY');
      expect(formatted).toContain('\nHAVING');
      expect(formatted).toContain('\nORDER BY');
      expect(formatted).toContain('\nLIMIT');
      expect(formatted).toContain('\nOFFSET');
    });
  });

  describe('QueryProfiler', () => {
    it('should start with empty queries', () => {
      const profiler = new QueryProfiler();
      const summary = profiler.getSummary();

      expect(summary.totalQueries).toBe(0);
      expect(summary.totalDuration).toBe(0);
      expect(summary.averageDuration).toBe(0);
      expect(summary.slowestQuery).toBeNull();
      expect(summary.fastestQuery).toBeNull();
      expect(summary.queries).toEqual([]);
    });

    it('should record query metrics', () => {
      const profiler = new QueryProfiler();
      const metric: QueryMetrics = {
        sql: 'SELECT * FROM users',
        duration: 50,
        timestamp: Date.now(),
      };

      profiler.record(metric);

      const summary = profiler.getSummary();
      expect(summary.totalQueries).toBe(1);
      expect(summary.queries[0]).toEqual(metric);
    });

    it('should calculate total duration', () => {
      const profiler = new QueryProfiler();
      
      profiler.record({ sql: 'q1', duration: 10, timestamp: Date.now() });
      profiler.record({ sql: 'q2', duration: 20, timestamp: Date.now() });
      profiler.record({ sql: 'q3', duration: 30, timestamp: Date.now() });

      const summary = profiler.getSummary();
      expect(summary.totalDuration).toBe(60);
    });

    it('should calculate average duration', () => {
      const profiler = new QueryProfiler();
      
      profiler.record({ sql: 'q1', duration: 10, timestamp: Date.now() });
      profiler.record({ sql: 'q2', duration: 20, timestamp: Date.now() });
      profiler.record({ sql: 'q3', duration: 30, timestamp: Date.now() });

      const summary = profiler.getSummary();
      expect(summary.averageDuration).toBe(20);
    });

    it('should identify slowest query', () => {
      const profiler = new QueryProfiler();
      
      profiler.record({ sql: 'fast', duration: 10, timestamp: Date.now() });
      profiler.record({ sql: 'slow', duration: 100, timestamp: Date.now() });
      profiler.record({ sql: 'medium', duration: 50, timestamp: Date.now() });

      const summary = profiler.getSummary();
      expect(summary.slowestQuery?.sql).toBe('slow');
      expect(summary.slowestQuery?.duration).toBe(100);
    });

    it('should identify fastest query', () => {
      const profiler = new QueryProfiler();
      
      profiler.record({ sql: 'fast', duration: 10, timestamp: Date.now() });
      profiler.record({ sql: 'slow', duration: 100, timestamp: Date.now() });
      profiler.record({ sql: 'medium', duration: 50, timestamp: Date.now() });

      const summary = profiler.getSummary();
      expect(summary.fastestQuery?.sql).toBe('fast');
      expect(summary.fastestQuery?.duration).toBe(10);
    });

    it('should clear all queries', () => {
      const profiler = new QueryProfiler();
      
      profiler.record({ sql: 'q1', duration: 10, timestamp: Date.now() });
      profiler.record({ sql: 'q2', duration: 20, timestamp: Date.now() });

      profiler.clear();

      const summary = profiler.getSummary();
      expect(summary.totalQueries).toBe(0);
    });

    it('should limit queries with maxQueries option', () => {
      const profiler = new QueryProfiler({ maxQueries: 3 });

      for (let i = 0; i < 5; i++) {
        profiler.record({ sql: `q${i}`, duration: i * 10, timestamp: Date.now() });
      }

      const summary = profiler.getSummary();
      expect(summary.totalQueries).toBe(3);
    });

    it('should use circular buffer when maxQueries exceeded', () => {
      const profiler = new QueryProfiler({ maxQueries: 2 });

      profiler.record({ sql: 'first', duration: 10, timestamp: 1 });
      profiler.record({ sql: 'second', duration: 20, timestamp: 2 });
      profiler.record({ sql: 'third', duration: 30, timestamp: 3 });

      const summary = profiler.getSummary();
      expect(summary.totalQueries).toBe(2);
      expect(summary.queries[0].sql).toBe('second');
      expect(summary.queries[1].sql).toBe('third');
    });

    it('should return copy of queries array', () => {
      const profiler = new QueryProfiler();
      
      profiler.record({ sql: 'q1', duration: 10, timestamp: Date.now() });

      const summary1 = profiler.getSummary();
      const summary2 = profiler.getSummary();

      expect(summary1.queries).not.toBe(summary2.queries);
      expect(summary1.queries).toEqual(summary2.queries);
    });

    it('should include params in recorded metrics', () => {
      const profiler = new QueryProfiler();
      const metric: QueryMetrics = {
        sql: 'SELECT * FROM users WHERE id = ?',
        params: [1],
        duration: 10,
        timestamp: Date.now(),
      };

      profiler.record(metric);

      const summary = profiler.getSummary();
      expect(summary.queries[0].params).toEqual([1]);
    });

    it('should use default maxQueries of 1000', () => {
      const profiler = new QueryProfiler();

      // Record many queries
      for (let i = 0; i < 50; i++) {
        profiler.record({ sql: `q${i}`, duration: i, timestamp: Date.now() });
      }

      // Should accept all (under default 1000 limit)
      expect(profiler.getSummary().totalQueries).toBe(50);
    });

    it('should handle single query correctly', () => {
      const profiler = new QueryProfiler();
      const metric: QueryMetrics = {
        sql: 'SELECT 1',
        duration: 5,
        timestamp: Date.now(),
      };

      profiler.record(metric);

      const summary = profiler.getSummary();
      expect(summary.totalQueries).toBe(1);
      expect(summary.totalDuration).toBe(5);
      expect(summary.averageDuration).toBe(5);
      expect(summary.slowestQuery).toEqual(metric);
      expect(summary.fastestQuery).toEqual(metric);
    });
  });
});
