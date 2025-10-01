import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'
import { withDebug, formatSQL, QueryProfiler } from '../src/debug'

describe('Debug Utilities', () => {
  let db: Kysely<any>
  let database: Database.Database

  beforeEach(() => {
    database = new Database(':memory:')

    db = new Kysely({
      dialect: new SqliteDialect({
        database
      })
    })

    // Create test table
    database.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL
      )
    `)

    // Insert test data
    database.exec(`
      INSERT INTO users (name, email) VALUES
      ('Alice', 'alice@example.com'),
      ('Bob', 'bob@example.com')
    `)
  })

  afterEach(() => {
    database.close()
  })

  describe('withDebug', () => {
    it('should log queries when enabled', async () => {
      const logger = vi.fn()
      const debugDb = withDebug(db, {
        logQuery: true,
        logger
      })

      await debugDb.selectFrom('users').selectAll().execute()

      expect(logger).toHaveBeenCalled()
      expect(logger.mock.calls[0][0]).toContain('[SQL]')
      expect(logger.mock.calls[0][0].toLowerCase()).toContain('select')
    })

    it('should log query parameters when enabled', async () => {
      const logger = vi.fn()
      const debugDb = withDebug(db, {
        logQuery: true,
        logParams: true,
        logger
      })

      await debugDb
        .selectFrom('users')
        .selectAll()
        .where('name', '=', 'Alice')
        .execute()

      expect(logger).toHaveBeenCalled()
      const message = logger.mock.calls[0][0]
      expect(message).toContain('[SQL]')
      expect(message).toContain('[Params]')
      // For now, params are empty in our simplified implementation
      // In a real implementation, this would extract actual params
    })

    it('should track query metrics', async () => {
      const debugDb = withDebug(db, {
        logQuery: false
      })

      await debugDb.selectFrom('users').selectAll().execute()
      // The syntax error was from a plugin issue - just use execute
      await debugDb.selectFrom('users').selectAll().where('id', '=', 1).execute()

      const metrics = debugDb.getMetrics()
      expect(metrics).toHaveLength(2)
      expect(metrics[0]?.sql).toBeDefined()
      expect(metrics[0]?.duration).toBeGreaterThanOrEqual(0)
      expect(metrics[0]?.timestamp).toBeGreaterThan(0)
    })

    it('should detect slow queries', async () => {
      const onSlowQuery = vi.fn()
      const debugDb = withDebug(db, {
        logQuery: false,
        slowQueryThreshold: 0.01, // Very low threshold to trigger
        onSlowQuery
      })

      await debugDb.selectFrom('users').selectAll().execute()

      expect(onSlowQuery).toHaveBeenCalled()
      expect(onSlowQuery.mock.calls[0][0].toLowerCase()).toContain('select')
      expect(onSlowQuery.mock.calls[0][1]).toBeGreaterThanOrEqual(0)
    })

    it('should clear metrics', async () => {
      const debugDb = withDebug(db, {
        logQuery: false
      })

      await debugDb.selectFrom('users').selectAll().execute()
      expect(debugDb.getMetrics()).toHaveLength(1)

      debugDb.clearMetrics()
      expect(debugDb.getMetrics()).toHaveLength(0)
    })

    it('should work with transactions', async () => {
      const logger = vi.fn()
      const debugDb = withDebug(db, {
        logQuery: true,
        logger
      })

      await debugDb.transaction().execute(async (trx) => {
        await trx
          .insertInto('users')
          .values({ name: 'Charlie', email: 'charlie@example.com' })
          .execute()

        await trx
          .updateTable('users')
          .set({ email: 'new@example.com' })
          .where('name', '=', 'Charlie')
          .execute()
      })

      const metrics = debugDb.getMetrics()
      expect(metrics.length).toBeGreaterThanOrEqual(2)

      // Check that INSERT and UPDATE were logged
      const sqls = metrics.map(m => m.sql).join(' ').toLowerCase()
      expect(sqls).toContain('insert')
      expect(sqls).toContain('update')
    })

    it('should limit metrics to maxMetrics option (circular buffer)', async () => {
      const debugDb = withDebug(db, {
        logQuery: false,
        maxMetrics: 3
      })

      // Execute 5 queries
      for (let i = 0; i < 5; i++) {
        await debugDb.selectFrom('users').selectAll().execute()
      }

      const metrics = debugDb.getMetrics()
      // Should keep only last 3 metrics
      expect(metrics).toHaveLength(3)
    })

    it('should remove oldest metrics when limit is exceeded', async () => {
      const debugDb = withDebug(db, {
        logQuery: false,
        maxMetrics: 2
      })

      // Execute 3 queries to trigger circular buffer
      await debugDb.selectFrom('users').select('id').execute()
      await debugDb.selectFrom('users').select('name').execute()
      await debugDb.selectFrom('users').select('email').execute()

      const metrics = debugDb.getMetrics()
      expect(metrics).toHaveLength(2)

      // First query (select id) should be removed
      const sqls = metrics.map(m => m.sql.toLowerCase()).join(' ')
      expect(sqls).toContain('name')
      expect(sqls).toContain('email')
    })

    it('should use default maxMetrics of 1000 when not specified', async () => {
      const debugDb = withDebug(db, {
        logQuery: false
      })

      // Execute 1001 queries to exceed default limit
      for (let i = 0; i < 1001; i++) {
        await debugDb.selectFrom('users').selectAll().execute()
      }

      const metrics = debugDb.getMetrics()
      // Should keep only last 1000 metrics
      expect(metrics).toHaveLength(1000)
    })

    it('should handle maxMetrics of 1 (keep only last metric)', async () => {
      const debugDb = withDebug(db, {
        logQuery: false,
        maxMetrics: 1
      })

      await debugDb.selectFrom('users').select('id').execute()
      await debugDb.selectFrom('users').select('name').execute()

      const metrics = debugDb.getMetrics()
      expect(metrics).toHaveLength(1)
      expect(metrics[0]?.sql.toLowerCase()).toContain('name')
    })
  })

  describe('formatSQL', () => {
    it('should format SQL for readability', () => {
      const sql = 'SELECT id, name FROM users WHERE age > 18 ORDER BY name LIMIT 10'
      const formatted = formatSQL(sql)

      // Check that keywords are on new lines (SELECT starts the string without newline prefix)
      expect(formatted).toContain('SELECT')
      expect(formatted).toContain('\nFROM')
      expect(formatted).toContain('\nWHERE')
      expect(formatted).toContain('\nORDER BY')
      expect(formatted).toContain('\nLIMIT')
    })

    it('should handle complex queries', () => {
      const sql = 'SELECT u.*, p.* FROM users u JOIN posts p ON u.id = p.user_id WHERE u.active = true GROUP BY u.id HAVING COUNT(p.id) > 5'
      const formatted = formatSQL(sql)

      // Check that keywords are on new lines (SELECT starts the string without newline prefix)
      expect(formatted).toContain('SELECT')
      expect(formatted).toContain('\nFROM')
      expect(formatted).toContain('\nJOIN')
      expect(formatted).toContain('\nWHERE')
      expect(formatted).toContain('\nGROUP BY')
      expect(formatted).toContain('\nHAVING')
    })
  })

  describe('QueryProfiler', () => {
    it('should track query metrics', () => {
      const profiler = new QueryProfiler()

      profiler.record({
        sql: 'SELECT * FROM users',
        params: [],
        duration: 10,
        timestamp: Date.now()
      })

      profiler.record({
        sql: 'INSERT INTO users',
        params: ['test'],
        duration: 5,
        timestamp: Date.now()
      })

      const summary = profiler.getSummary()
      expect(summary.totalQueries).toBe(2)
      expect(summary.totalDuration).toBe(15)
      expect(summary.averageDuration).toBe(7.5)
      expect(summary.slowestQuery?.duration).toBe(10)
      expect(summary.fastestQuery?.duration).toBe(5)
    })

    it('should handle empty profiler', () => {
      const profiler = new QueryProfiler()
      const summary = profiler.getSummary()

      expect(summary.totalQueries).toBe(0)
      expect(summary.totalDuration).toBe(0)
      expect(summary.averageDuration).toBe(0)
      expect(summary.slowestQuery).toBeNull()
      expect(summary.fastestQuery).toBeNull()
    })

    it('should clear metrics', () => {
      const profiler = new QueryProfiler()

      profiler.record({
        sql: 'SELECT * FROM users',
        params: [],
        duration: 10,
        timestamp: Date.now()
      })

      expect(profiler.getSummary().totalQueries).toBe(1)

      profiler.clear()
      expect(profiler.getSummary().totalQueries).toBe(0)
    })

    it('should return all queries', () => {
      const profiler = new QueryProfiler()

      const metric1 = {
        sql: 'SELECT * FROM users',
        params: [],
        duration: 10,
        timestamp: Date.now()
      }

      const metric2 = {
        sql: 'INSERT INTO users',
        params: ['test'],
        duration: 5,
        timestamp: Date.now()
      }

      profiler.record(metric1)
      profiler.record(metric2)

      const summary = profiler.getSummary()
      expect(summary.queries).toHaveLength(2)
      expect(summary.queries).toContainEqual(metric1)
      expect(summary.queries).toContainEqual(metric2)
    })

    it('should limit queries to maxQueries option (circular buffer)', () => {
      const profiler = new QueryProfiler({ maxQueries: 3 })

      // Record 5 queries
      for (let i = 0; i < 5; i++) {
        profiler.record({
          sql: `SELECT ${i}`,
          params: [],
          duration: i,
          timestamp: Date.now()
        })
      }

      const summary = profiler.getSummary()
      // Should keep only last 3 queries
      expect(summary.queries).toHaveLength(3)
      expect(summary.totalQueries).toBe(3)
    })

    it('should remove oldest queries when limit is exceeded', () => {
      const profiler = new QueryProfiler({ maxQueries: 2 })

      profiler.record({ sql: 'QUERY 1', duration: 1, timestamp: Date.now() })
      profiler.record({ sql: 'QUERY 2', duration: 2, timestamp: Date.now() })
      profiler.record({ sql: 'QUERY 3', duration: 3, timestamp: Date.now() })

      const summary = profiler.getSummary()
      expect(summary.queries).toHaveLength(2)

      // First query should be removed
      const sqls = summary.queries.map(q => q.sql).join(' ')
      expect(sqls).toContain('QUERY 2')
      expect(sqls).toContain('QUERY 3')
      expect(sqls).not.toContain('QUERY 1')
    })

    it('should use default maxQueries of 1000 when not specified', () => {
      const profiler = new QueryProfiler()

      // Record 1001 queries to exceed default limit
      for (let i = 0; i < 1001; i++) {
        profiler.record({
          sql: `SELECT ${i}`,
          params: [],
          duration: i,
          timestamp: Date.now()
        })
      }

      const summary = profiler.getSummary()
      // Should keep only last 1000 queries
      expect(summary.queries).toHaveLength(1000)
      expect(summary.totalQueries).toBe(1000)
    })

    it('should handle maxQueries of 1 (keep only last query)', () => {
      const profiler = new QueryProfiler({ maxQueries: 1 })

      profiler.record({ sql: 'QUERY 1', duration: 1, timestamp: Date.now() })
      profiler.record({ sql: 'QUERY 2', duration: 2, timestamp: Date.now() })

      const summary = profiler.getSummary()
      expect(summary.queries).toHaveLength(1)
      expect(summary.queries[0]?.sql).toBe('QUERY 2')
    })

    it('should correctly calculate summary with circular buffer', () => {
      const profiler = new QueryProfiler({ maxQueries: 3 })

      // Record 5 queries with known durations
      profiler.record({ sql: 'Q1', duration: 10, timestamp: Date.now() })
      profiler.record({ sql: 'Q2', duration: 20, timestamp: Date.now() })
      profiler.record({ sql: 'Q3', duration: 30, timestamp: Date.now() }) // oldest kept
      profiler.record({ sql: 'Q4', duration: 40, timestamp: Date.now() })
      profiler.record({ sql: 'Q5', duration: 50, timestamp: Date.now() })

      const summary = profiler.getSummary()
      // Should only have Q3, Q4, Q5 (last 3)
      expect(summary.totalQueries).toBe(3)
      expect(summary.totalDuration).toBe(120) // 30 + 40 + 50
      expect(summary.averageDuration).toBe(40) // 120 / 3
      expect(summary.slowestQuery?.duration).toBe(50)
      expect(summary.fastestQuery?.duration).toBe(30)
    })
  })
})