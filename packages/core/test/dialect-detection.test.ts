import { describe, it, expect, vi } from 'vitest'
import type { Kysely, CompiledQuery } from 'kysely'
import { detectDialect } from '../src/dialect-detection.js'
import type { Dialect } from '../src/types.js'

/**
 * Test suite for dialect detection functionality
 *
 * This tests the improved dialect detection that uses stable SQL generation patterns
 * instead of relying on Kysely internals.
 */
describe('detectDialect', () => {
  /**
   * Helper to create a mock Kysely instance that generates SQL with specific quoting patterns
   */
  function createMockKysely(sql: string): Kysely<any> {
    const compiled: CompiledQuery = {
      sql,
      parameters: [],
      query: { kind: 'SelectQueryNode' } as any,
      queryId: Symbol('test-query') as any
    }

    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      compile: vi.fn().mockReturnValue(compiled)
    }

    const mockDb = {
      selectFrom: vi.fn().mockReturnValue(mockQueryBuilder),
      fn: vi.fn().mockReturnValue({ as: vi.fn().mockReturnValue('test') })
    } as unknown as Kysely<any>

    return mockDb
  }

  /**
   * Helper to create a mock Kysely with fallback constructor name (legacy detection)
   */
  function createMockKyselyWithConstructor(dialectName: string): Kysely<any> {
    // Create a mock that throws during SQL generation to force fallback
    const mockDb = {
      selectFrom: vi.fn().mockImplementation(() => {
        throw new Error('SQL generation failed')
      }),
      fn: vi.fn(),
      executor: {
        adapter: {
          dialect: {
            constructor: {
              name: dialectName
            }
          }
        }
      }
    } as unknown as Kysely<any>

    return mockDb
  }

  describe('Primary detection (SQL generation)', () => {
    it('detects PostgreSQL by double quotes', () => {
      const db = createMockKysely('SELECT 1 AS "test" FROM "_kysera_test" LIMIT 0')
      const dialect = detectDialect(db)
      expect(dialect).toBe('postgres')
    })

    it('detects MySQL by backticks', () => {
      const db = createMockKysely('SELECT 1 AS `test` FROM `_kysera_test` LIMIT 0')
      const dialect = detectDialect(db)
      expect(dialect).toBe('mysql')
    })

    it('detects MSSQL by square brackets', () => {
      const db = createMockKysely('SELECT TOP 0 1 AS [test] FROM [_kysera_test]')
      const dialect = detectDialect(db)
      expect(dialect).toBe('mssql')
    })

    it('detects SQLite by lack of identifier quoting', () => {
      const db = createMockKysely('SELECT 1 AS test FROM _kysera_test LIMIT 0')
      const dialect = detectDialect(db)
      expect(dialect).toBe('sqlite')
    })
  })

  describe('Fallback detection (constructor name)', () => {
    it('falls back to PostgresDialect constructor name', () => {
      const db = createMockKyselyWithConstructor('PostgresDialect')
      const dialect = detectDialect(db)
      expect(dialect).toBe('postgres')
    })

    it('falls back to MysqlDialect constructor name', () => {
      const db = createMockKyselyWithConstructor('MysqlDialect')
      const dialect = detectDialect(db)
      expect(dialect).toBe('mysql')
    })

    it('falls back to SqliteDialect constructor name', () => {
      const db = createMockKyselyWithConstructor('SqliteDialect')
      const dialect = detectDialect(db)
      expect(dialect).toBe('sqlite')
    })

    it('falls back to MssqlDialect constructor name', () => {
      const db = createMockKyselyWithConstructor('MssqlDialect')
      const dialect = detectDialect(db)
      expect(dialect).toBe('mssql')
    })

    it('falls back to SqlServerDialect constructor name', () => {
      const db = createMockKyselyWithConstructor('SqlServerDialect')
      const dialect = detectDialect(db)
      expect(dialect).toBe('mssql')
    })

    it('handles case-insensitive constructor names', () => {
      const testCases: Array<[string, Dialect]> = [
        ['POSTGRESDIALECT', 'postgres'],
        ['mysqldialect', 'mysql'],
        ['SQLiteDialect', 'sqlite'],
        ['MsSqLdIaLeCt', 'mssql']
      ]

      for (const [name, expected] of testCases) {
        const db = createMockKyselyWithConstructor(name)
        const dialect = detectDialect(db)
        expect(dialect).toBe(expected)
      }
    })
  })

  describe('Default fallback behavior', () => {
    it('defaults to postgres when detection fails completely', () => {
      const mockDb = {
        selectFrom: vi.fn().mockImplementation(() => {
          throw new Error('SQL generation failed')
        }),
        fn: vi.fn()
      } as unknown as Kysely<any>

      const dialect = detectDialect(mockDb)
      expect(dialect).toBe('postgres')
    })

    it('defaults to postgres when SQL contains no recognizable quoting', () => {
      // Edge case: SQL that doesn't match any pattern
      const db = createMockKysely('WEIRD SQL SYNTAX')
      const dialect = detectDialect(db)
      expect(dialect).toBe('postgres')
    })

    it('defaults to postgres when constructor name is unknown', () => {
      const db = createMockKyselyWithConstructor('UnknownDialect')
      const dialect = detectDialect(db)
      expect(dialect).toBe('postgres')
    })
  })

  describe('Edge cases', () => {
    it('handles SQL with mixed quoting styles (prefers first match)', () => {
      // This shouldn't happen in practice, but tests priority order
      const db = createMockKysely('SELECT "_kysera_test", `other`, [another]')
      const dialect = detectDialect(db)
      expect(dialect).toBe('postgres') // Double quotes checked first
    })

    it('handles empty SQL string', () => {
      const db = createMockKysely('')
      const dialect = detectDialect(db)
      expect(dialect).toBe('postgres') // Falls back to default
    })

    it('handles SQL with only partial table name match', () => {
      // Contains _kysera_test but with different quoting
      const db = createMockKysely('SELECT * FROM some_kysera_test_table')
      const dialect = detectDialect(db)
      expect(dialect).toBe('sqlite') // Matches unquoted pattern
    })
  })

  describe('Real-world SQL patterns', () => {
    it('detects PostgreSQL with complex query', () => {
      const sql = `
        SELECT "users"."id", "users"."email"
        FROM "_kysera_test"
        LEFT JOIN "profiles" ON "profiles"."user_id" = "users"."id"
        WHERE "users"."active" = $1
        LIMIT 0
      `
      const db = createMockKysely(sql)
      const dialect = detectDialect(db)
      expect(dialect).toBe('postgres')
    })

    it('detects MySQL with complex query', () => {
      const sql = `
        SELECT \`users\`.\`id\`, \`users\`.\`email\`
        FROM \`_kysera_test\`
        LEFT JOIN \`profiles\` ON \`profiles\`.\`user_id\` = \`users\`.\`id\`
        WHERE \`users\`.\`active\` = ?
        LIMIT 0
      `
      const db = createMockKysely(sql)
      const dialect = detectDialect(db)
      expect(dialect).toBe('mysql')
    })

    it('detects MSSQL with TOP clause', () => {
      const sql = `
        SELECT TOP 0 [users].[id], [users].[email]
        FROM [_kysera_test]
        LEFT JOIN [profiles] ON [profiles].[user_id] = [users].[id]
        WHERE [users].[active] = @p1
      `
      const db = createMockKysely(sql)
      const dialect = detectDialect(db)
      expect(dialect).toBe('mssql')
    })

    it('detects SQLite with simple query', () => {
      const sql = `
        SELECT users.id, users.email
        FROM _kysera_test
        LEFT JOIN profiles ON profiles.user_id = users.id
        WHERE users.active = ?
        LIMIT 0
      `
      const db = createMockKysely(sql)
      const dialect = detectDialect(db)
      expect(dialect).toBe('sqlite')
    })
  })

  describe('Integration with Kysely types', () => {
    it('works with generic database type parameter', () => {
      interface Database {
        users: { id: number; email: string }
        posts: { id: number; title: string }
      }

      const db = createMockKysely('SELECT 1 AS "test" FROM "_kysera_test" LIMIT 0')
      const dialect = detectDialect<Database>(db)
      expect(dialect).toBe('postgres')
    })

    it('maintains type safety with Dialect return type', () => {
      const db = createMockKysely('SELECT 1 AS `test` FROM `_kysera_test` LIMIT 0')
      const dialect: Dialect = detectDialect(db)
      expect(['postgres', 'mysql', 'sqlite', 'mssql']).toContain(dialect)
    })
  })

  describe('Error handling', () => {
    it('handles null/undefined executor properties gracefully', () => {
      const mockDb = {
        selectFrom: vi.fn().mockImplementation(() => {
          throw new Error('SQL generation failed')
        }),
        fn: vi.fn(),
        executor: null
      } as unknown as Kysely<any>

      const dialect = detectDialect(mockDb)
      expect(dialect).toBe('postgres') // Falls back to default
    })

    it('handles missing compile() method', () => {
      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              compile: undefined
            })
          })
        }),
        fn: vi.fn()
      } as unknown as Kysely<any>

      const dialect = detectDialect(mockDb)
      expect(dialect).toBe('postgres') // Falls back to default
    })

    it('handles compile() throwing an error', () => {
      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              compile: vi.fn().mockImplementation(() => {
                throw new Error('Compilation error')
              })
            })
          })
        }),
        fn: vi.fn()
      } as unknown as Kysely<any>

      const dialect = detectDialect(mockDb)
      expect(dialect).toBe('postgres') // Falls back to default
    })
  })

  describe('Version stability', () => {
    it('does not depend on Kysely version-specific internals', () => {
      // This test documents that we only use the public compile() API
      const db = createMockKysely('SELECT 1 AS "test" FROM "_kysera_test" LIMIT 0')

      // Verify we're calling public APIs only
      const dialect = detectDialect(db)

      expect(db.selectFrom).toHaveBeenCalledWith('_kysera_test')
      expect(dialect).toBe('postgres')

      // The compile() method is part of Kysely's stable public API
      // This should work across Kysely versions >=0.28.9
    })
  })
})
