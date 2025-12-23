/**
 * Tests for database cleanup utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CompiledQuery, QueryResult } from 'kysely'
import { cleanDatabase, type CleanupStrategy } from '../src/cleanup.js'

/**
 * Mock database interface for testing
 */
/**
 * Minimal mock database type for testing (avoids complex Kysely generics)
 */
type MockDb = any

/**
 * Mock database type with tracking capabilities
 */
interface MockDbWithTracking {
  db: MockDb
  rawCalls: string[]
}

/**
 * Create a mock Kysely database instance with dialect support
 * This properly mocks the executor for sql.raw() compatibility
 */
function createMockDb(dialectName = 'PostgresDialect'): MockDb {
  const mockExecuteQuery = vi.fn(
    async (_compiledQuery: CompiledQuery): Promise<QueryResult<unknown>> => {
      return { rows: [] }
    }
  )

  const deleteFromMock = vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n })
  })

  const mockDb = {
    deleteFrom: deleteFromMock,
    getExecutor: vi.fn(() => ({
      adapter: {
        dialect: {
          constructor: {
            name: dialectName
          }
        }
      },
      transformQuery: vi.fn((node: unknown) => node),
      compileQuery: vi.fn((node: unknown) => ({
        sql: String((node as { sql?: string })?.sql ?? 'MOCK_SQL'),
        parameters: [],
        query: node
      })),
      executeQuery: mockExecuteQuery,
      provideConnection: vi.fn()
    }))
  }

  return mockDb
}

/**
 * Create a mock that tracks raw SQL calls
 */
function createMockDbWithRawTracking(dialectName = 'PostgresDialect'): MockDbWithTracking {
  const rawCalls: string[] = []

  const deleteFromMock = vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n })
  })

  const mockExecuteQuery = vi.fn(
    async (compiledQuery: CompiledQuery): Promise<QueryResult<unknown>> => {
      rawCalls.push(compiledQuery.sql)
      return { rows: [] }
    }
  )

  const mockDb = {
    deleteFrom: deleteFromMock,
    getExecutor: vi.fn(() => ({
      adapter: {
        dialect: {
          constructor: {
            name: dialectName
          }
        }
      },
      transformQuery: vi.fn((node: unknown) => node),
      compileQuery: vi.fn((node: unknown, _queryId: unknown) => {
        // Extract SQL from RawNode
        const rawNode = node as { sql?: string; sqlFragments?: string[] }
        let sql = 'UNKNOWN_SQL'
        if (rawNode.sqlFragments) {
          sql = rawNode.sqlFragments.join('?')
        } else if (rawNode.sql) {
          sql = rawNode.sql
        }
        return {
          sql,
          parameters: [],
          query: node
        }
      }),
      executeQuery: mockExecuteQuery,
      provideConnection: vi.fn()
    }))
  }

  return { db: mockDb, rawCalls }
}

describe('cleanDatabase - transaction strategy', () => {
  it('should do nothing when strategy is transaction', async () => {
    const mockDb = createMockDb()

    await cleanDatabase(mockDb, 'transaction')

    // No database operations should be performed
    expect(mockDb.deleteFrom).not.toHaveBeenCalled()
  })

  it('should not require tables parameter with transaction strategy', async () => {
    const mockDb = createMockDb()

    await expect(cleanDatabase(mockDb, 'transaction')).resolves.toBeUndefined()
  })

  it('should ignore tables parameter when using transaction strategy', async () => {
    const mockDb = createMockDb()

    await cleanDatabase(mockDb, 'transaction', ['users', 'posts'])

    expect(mockDb.deleteFrom).not.toHaveBeenCalled()
  })
})

describe('cleanDatabase - delete strategy', () => {
  let mockDb: MockDb

  beforeEach(() => {
    mockDb = createMockDb()
  })

  it('should throw error if tables parameter is missing', async () => {
    await expect(cleanDatabase(mockDb, 'delete')).rejects.toThrow(
      'cleanDatabase requires tables parameter when using "delete" or "truncate" strategy'
    )
  })

  it('should throw error if tables array is empty', async () => {
    await expect(cleanDatabase(mockDb, 'delete', [])).rejects.toThrow(
      'cleanDatabase requires tables parameter when using "delete" or "truncate" strategy'
    )
  })

  it('should delete from each table in order', async () => {
    const deleteFromCalls: string[] = []
    const deleteFromMock = vi.fn((table: string) => {
      deleteFromCalls.push(table)
      return {
        execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n })
      }
    })

    mockDb = {
      deleteFrom: deleteFromMock,
      getExecutor: createMockDb().getExecutor
    }

    await cleanDatabase(mockDb, 'delete', ['comments', 'posts', 'users'])

    expect(deleteFromCalls).toEqual(['comments', 'posts', 'users'])
  })

  it('should delete tables in FK-safe order (children first)', async () => {
    const deleteFromCalls: string[] = []
    const deleteFromMock = vi.fn((table: string) => {
      deleteFromCalls.push(table)
      return {
        execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n })
      }
    })

    mockDb = {
      deleteFrom: deleteFromMock,
      getExecutor: createMockDb().getExecutor
    }

    // Children first: comments -> posts -> users
    await cleanDatabase(mockDb, 'delete', ['comments', 'posts', 'users'])

    expect(deleteFromCalls[0]).toBe('comments')
    expect(deleteFromCalls[1]).toBe('posts')
    expect(deleteFromCalls[2]).toBe('users')
  })

  it('should handle single table deletion', async () => {
    const deleteFromMock = vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n })
    })

    mockDb = {
      deleteFrom: deleteFromMock,
      getExecutor: createMockDb().getExecutor
    }

    await cleanDatabase(mockDb, 'delete', ['users'])

    expect(deleteFromMock).toHaveBeenCalledTimes(1)
    expect(deleteFromMock).toHaveBeenCalledWith('users')
  })

  it('should propagate errors from delete operations', async () => {
    const deleteError = new Error('Delete failed')
    const deleteFromMock = vi.fn().mockReturnValue({
      execute: vi.fn().mockRejectedValue(deleteError)
    })

    mockDb = {
      deleteFrom: deleteFromMock,
      getExecutor: createMockDb().getExecutor
    }

    await expect(cleanDatabase(mockDb, 'delete', ['users'])).rejects.toThrow('Delete failed')
  })

  it('should await each delete operation', async () => {
    const executionOrder: string[] = []
    const deleteFromMock = vi.fn((table: string) => ({
      execute: vi.fn(async () => {
        executionOrder.push(`delete-${table}`)
        await new Promise(resolve => setTimeout(resolve, 10))
      })
    }))

    mockDb = {
      deleteFrom: deleteFromMock,
      getExecutor: createMockDb().getExecutor
    }

    await cleanDatabase(mockDb, 'delete', ['users', 'posts'])

    expect(executionOrder).toEqual(['delete-users', 'delete-posts'])
  })
})

describe('cleanDatabase - truncate strategy - PostgreSQL', () => {
  let mock: MockDbWithTracking

  beforeEach(() => {
    mock = createMockDbWithRawTracking('PostgresDialect')
  })

  it('should throw error if tables parameter is missing', async () => {
    await expect(cleanDatabase(mock.db, 'truncate')).rejects.toThrow(
      'cleanDatabase requires tables parameter when using "delete" or "truncate" strategy'
    )
  })

  it('should disable FK checks before truncating', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users'])

    expect(
      mock.rawCalls.some(sql => sql.includes('session_replication_role') && sql.includes('replica'))
    ).toBe(true)
  })

  it('should re-enable FK checks after truncating', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users'])

    expect(
      mock.rawCalls.some(sql => sql.includes('session_replication_role') && sql.includes('DEFAULT'))
    ).toBe(true)
  })

  it('should truncate tables with CASCADE', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users', 'posts'])

    expect(mock.rawCalls.some(sql => sql.includes('TRUNCATE TABLE users CASCADE'))).toBe(true)
    expect(mock.rawCalls.some(sql => sql.includes('TRUNCATE TABLE posts CASCADE'))).toBe(true)
  })

  it('should execute operations in correct order', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users'])

    // Order: disable FK -> truncate -> enable FK
    const replicaIdx = mock.rawCalls.findIndex(sql => sql.includes('replica'))
    const truncateIdx = mock.rawCalls.findIndex(sql => sql.includes('TRUNCATE'))
    const defaultIdx = mock.rawCalls.findIndex(sql => sql.includes('DEFAULT'))

    expect(replicaIdx).toBeLessThan(truncateIdx)
    expect(truncateIdx).toBeLessThan(defaultIdx)
  })

  it('should handle multiple tables', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users', 'posts', 'comments'])

    const truncateCalls = mock.rawCalls.filter(sql => sql.includes('TRUNCATE TABLE'))
    expect(truncateCalls).toHaveLength(3)
  })
})

describe('cleanDatabase - truncate strategy - MySQL', () => {
  let mock: MockDbWithTracking

  beforeEach(() => {
    mock = createMockDbWithRawTracking('MysqlDialect')
  })

  it('should disable FK checks before truncating', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users'])

    expect(mock.rawCalls.some(sql => sql.includes('FOREIGN_KEY_CHECKS') && sql.includes('0'))).toBe(
      true
    )
  })

  it('should re-enable FK checks after truncating', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users'])

    expect(mock.rawCalls.some(sql => sql.includes('FOREIGN_KEY_CHECKS') && sql.includes('1'))).toBe(
      true
    )
  })

  it('should truncate tables with backtick escaping', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users'])

    expect(mock.rawCalls.some(sql => sql.includes('TRUNCATE TABLE `users`'))).toBe(true)
  })

  it('should execute operations in correct order', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users'])

    const disableIdx = mock.rawCalls.findIndex(
      sql => sql.includes('FOREIGN_KEY_CHECKS') && sql.includes('0')
    )
    const truncateIdx = mock.rawCalls.findIndex(sql => sql.includes('TRUNCATE'))
    const enableIdx = mock.rawCalls.findIndex(
      sql => sql.includes('FOREIGN_KEY_CHECKS') && sql.includes('1')
    )

    expect(disableIdx).toBeLessThan(truncateIdx)
    expect(truncateIdx).toBeLessThan(enableIdx)
  })
})

describe('cleanDatabase - truncate strategy - SQLite', () => {
  let mock: MockDbWithTracking

  beforeEach(() => {
    mock = createMockDbWithRawTracking('SqliteDialect')
  })

  it('should use DELETE instead of TRUNCATE', async () => {
    const deleteFromCalls: string[] = []
    const deleteFromMock = vi.fn((table: string) => {
      deleteFromCalls.push(table)
      return {
        execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n })
      }
    })

    // Override deleteFrom on the mock db
    mock.db.deleteFrom = deleteFromMock

    await cleanDatabase(mock.db, 'truncate', ['users'])

    expect(deleteFromCalls).toContain('users')
    expect(mock.rawCalls.some(sql => sql.includes('TRUNCATE'))).toBe(false)
  })

  it('should reset auto-increment sequences', async () => {
    mock.db.deleteFrom = vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n })
    })

    await cleanDatabase(mock.db, 'truncate', ['users'])

    // The parameterized query uses ? placeholder
    expect(mock.rawCalls.some(sql => sql.includes('DELETE FROM sqlite_sequence WHERE name'))).toBe(
      true
    )
  })

  it('should handle multiple tables', async () => {
    const deleteFromCalls: string[] = []
    const deleteFromMock = vi.fn((table: string) => {
      deleteFromCalls.push(table)
      return {
        execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n })
      }
    })

    mock.db.deleteFrom = deleteFromMock

    await cleanDatabase(mock.db, 'truncate', ['users', 'posts'])

    expect(deleteFromCalls).toEqual(['users', 'posts'])
    // Both sequence resets should be executed
    const sequenceResets = mock.rawCalls.filter(sql => sql.includes('sqlite_sequence'))
    expect(sequenceResets.length).toBe(2)
  })
})

describe('cleanDatabase - truncate strategy - MSSQL', () => {
  let mock: MockDbWithTracking

  beforeEach(() => {
    mock = createMockDbWithRawTracking('MssqlDialect')
  })

  it('should disable FK checks before truncating', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users'])

    expect(
      mock.rawCalls.some(
        sql => sql.includes('sp_MSforeachtable') && sql.includes('NOCHECK CONSTRAINT ALL')
      )
    ).toBe(true)
  })

  it('should re-enable FK checks after truncating', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users'])

    expect(
      mock.rawCalls.some(
        sql => sql.includes('sp_MSforeachtable') && sql.includes('CHECK CONSTRAINT ALL')
      )
    ).toBe(true)
  })

  it('should truncate tables with square bracket escaping', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users'])

    expect(mock.rawCalls.some(sql => sql.includes('TRUNCATE TABLE [users]'))).toBe(true)
  })

  it('should execute operations in correct order', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users'])

    // Order: disable FK -> truncate -> enable FK
    const disableIdx = mock.rawCalls.findIndex(sql => sql.includes('NOCHECK CONSTRAINT ALL'))
    const truncateIdx = mock.rawCalls.findIndex(sql => sql.includes('TRUNCATE TABLE'))
    const enableIdx = mock.rawCalls.findIndex(
      sql => sql.includes('CHECK CONSTRAINT ALL') && !sql.includes('NOCHECK')
    )

    expect(disableIdx).toBeGreaterThanOrEqual(0)
    expect(truncateIdx).toBeGreaterThanOrEqual(0)
    expect(enableIdx).toBeGreaterThanOrEqual(0)
    expect(disableIdx).toBeLessThan(truncateIdx)
    expect(truncateIdx).toBeLessThan(enableIdx)
  })

  it('should handle multiple tables', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users', 'posts', 'comments'])

    const truncateCalls = mock.rawCalls.filter(sql => sql.includes('TRUNCATE TABLE'))
    expect(truncateCalls).toHaveLength(3)
    expect(truncateCalls.some(sql => sql.includes('[users]'))).toBe(true)
    expect(truncateCalls.some(sql => sql.includes('[posts]'))).toBe(true)
    expect(truncateCalls.some(sql => sql.includes('[comments]'))).toBe(true)
  })

  it('should handle single table', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users'])

    const truncateCalls = mock.rawCalls.filter(sql => sql.includes('TRUNCATE TABLE [users]'))
    expect(truncateCalls).toHaveLength(1)
  })

  it('should use explicit dialect from options', async () => {
    // Create PostgreSQL mock but override with MSSQL dialect
    const pgMock = createMockDbWithRawTracking('PostgresDialect')

    await cleanDatabase(pgMock.db, 'truncate', { dialect: 'mssql', tables: ['users'] })

    // Should use MSSQL syntax (square brackets) not PostgreSQL (CASCADE)
    expect(pgMock.rawCalls.some(sql => sql.includes('TRUNCATE TABLE [users]'))).toBe(true)
    expect(pgMock.rawCalls.some(sql => sql.includes('CASCADE'))).toBe(false)
    expect(pgMock.rawCalls.some(sql => sql.includes('NOCHECK CONSTRAINT ALL'))).toBe(true)
  })

  it('should detect MssqlDialect from constructor name', async () => {
    await cleanDatabase(mock.db, 'truncate', ['users'])

    // Should detect MSSQL and use appropriate syntax
    expect(mock.rawCalls.some(sql => sql.includes('[users]'))).toBe(true)
  })

  it('should detect SqlServerDialect variant', async () => {
    const sqlServerMock = createMockDbWithRawTracking('SqlServerDialect')

    await cleanDatabase(sqlServerMock.db, 'truncate', ['users'])

    // Should detect as MSSQL and use square brackets
    expect(sqlServerMock.rawCalls.some(sql => sql.includes('[users]'))).toBe(true)
  })

  it('should handle tables with valid identifier patterns', async () => {
    await cleanDatabase(mock.db, 'truncate', ['user_table', 'UserPosts123', '_internal_table'])

    expect(mock.rawCalls.some(sql => sql.includes('[user_table]'))).toBe(true)
    expect(mock.rawCalls.some(sql => sql.includes('[UserPosts123]'))).toBe(true)
    expect(mock.rawCalls.some(sql => sql.includes('[_internal_table]'))).toBe(true)
  })

  it('should handle errors during constraint disable', async () => {
    const mockExecuteQuery = vi.fn().mockRejectedValue(new Error('Constraint disable failed'))

    const errorDb = {
      deleteFrom: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n })
      }),
      getExecutor: vi.fn(() => ({
        adapter: {
          dialect: {
            constructor: {
              name: 'MssqlDialect'
            }
          }
        },
        transformQuery: vi.fn((node: unknown) => node),
        compileQuery: vi.fn((node: unknown) => ({
          sql: 'EXEC sp_MSforeachtable "ALTER TABLE ? NOCHECK CONSTRAINT ALL"',
          parameters: [],
          query: node
        })),
        executeQuery: mockExecuteQuery,
        provideConnection: vi.fn()
      }))
    } as MockDb

    await expect(cleanDatabase(errorDb, 'truncate', ['users'])).rejects.toThrow(
      'Constraint disable failed'
    )
  })
})

describe('cleanDatabase - SQL injection prevention', () => {
  it('should reject invalid table names with special characters', async () => {
    const mockDb = createMockDb()

    await expect(cleanDatabase(mockDb, 'truncate', ['users; DROP TABLE users;--'])).rejects.toThrow(
      /Invalid identifier/
    )
  })

  it('should reject table names with SQL keywords', async () => {
    const mockDb = createMockDb()

    await expect(cleanDatabase(mockDb, 'truncate', ['users OR 1=1'])).rejects.toThrow(
      /Invalid identifier/
    )
  })

  it('should reject empty table names', async () => {
    const mockDb = createMockDb()

    await expect(cleanDatabase(mockDb, 'truncate', [''])).rejects.toThrow(/Invalid identifier/)
  })

  it('should reject table names that are too long', async () => {
    const mockDb = createMockDb()
    const longName = 'a'.repeat(129)

    await expect(cleanDatabase(mockDb, 'truncate', [longName])).rejects.toThrow(
      /Invalid identifier.*length/
    )
  })

  it('should accept valid table names', async () => {
    const mock = createMockDbWithRawTracking()

    await expect(
      cleanDatabase(mock.db, 'truncate', ['users', 'user_posts', 'UserTable123', '_table'])
    ).resolves.toBeUndefined()
  })

  it('should reject table names starting with numbers', async () => {
    const mockDb = createMockDb()

    await expect(cleanDatabase(mockDb, 'truncate', ['123users'])).rejects.toThrow(
      /Invalid identifier/
    )
  })

  it('should reject table names with hyphens', async () => {
    const mockDb = createMockDb()

    await expect(cleanDatabase(mockDb, 'truncate', ['user-table'])).rejects.toThrow(
      /Invalid identifier/
    )
  })

  it('should reject table names with spaces', async () => {
    const mockDb = createMockDb()

    await expect(cleanDatabase(mockDb, 'truncate', ['user table'])).rejects.toThrow(
      /Invalid identifier/
    )
  })

  it('should reject null or undefined table names', async () => {
    const mockDb = createMockDb()

    await expect(cleanDatabase(mockDb, 'truncate', [null as unknown as string])).rejects.toThrow(
      /Invalid identifier/
    )
  })

  it('should handle whitespace trimming', async () => {
    const mock = createMockDbWithRawTracking()

    // Should work after trimming
    await expect(cleanDatabase(mock.db, 'truncate', ['  users  '])).resolves.toBeUndefined()
  })
})

describe('cleanDatabase - edge cases', () => {
  it('should handle database with unknown dialect', async () => {
    const mock = createMockDbWithRawTracking('UnknownDialect')
    mock.db.deleteFrom = vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n })
    })

    // Should fall back to SQLite behavior (DELETE + sequence reset)
    await expect(cleanDatabase(mock.db, 'truncate', ['users'])).resolves.toBeUndefined()
  })

  it('should handle errors during FK disable', async () => {
    // Create a mock db that throws on executeQuery
    const mockExecuteQuery = vi.fn().mockRejectedValue(new Error('FK disable failed'))

    const mockDb = {
      deleteFrom: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n })
      }),
      getExecutor: vi.fn(() => ({
        adapter: {
          dialect: {
            constructor: {
              name: 'PostgresDialect'
            }
          }
        },
        transformQuery: vi.fn((node: unknown) => node),
        compileQuery: vi.fn((node: unknown) => ({
          sql: 'SET session_replication_role = replica',
          parameters: [],
          query: node
        })),
        executeQuery: mockExecuteQuery,
        provideConnection: vi.fn()
      }))
    } as MockDb

    await expect(cleanDatabase(mockDb, 'truncate', ['users'])).rejects.toThrow('FK disable failed')
  })

  it('should accept all valid cleanup strategies', async () => {
    const strategies: CleanupStrategy[] = ['transaction', 'delete', 'truncate']

    for (const strategy of strategies) {
      const mock = createMockDbWithRawTracking()
      if (strategy === 'transaction') {
        await expect(cleanDatabase(mock.db, strategy)).resolves.toBeUndefined()
      } else {
        await expect(cleanDatabase(mock.db, strategy, ['users'])).resolves.toBeUndefined()
      }
    }
  })

  it('should handle very long table lists', async () => {
    const mockDb = createMockDb()
    const tables = Array.from({ length: 100 }, (_, i) => `table_${i}`)

    await expect(cleanDatabase(mockDb, 'delete', tables)).resolves.toBeUndefined()
  })
})

describe('cleanDatabase - CleanupOptions', () => {
  it('should accept tables as array (backward compatibility)', async () => {
    const mock = createMockDbWithRawTracking('PostgresDialect')

    await expect(cleanDatabase(mock.db, 'truncate', ['users'])).resolves.toBeUndefined()
  })

  it('should accept tables via CleanupOptions object', async () => {
    const mock = createMockDbWithRawTracking('PostgresDialect')

    await expect(cleanDatabase(mock.db, 'truncate', { tables: ['users'] })).resolves.toBeUndefined()
  })

  it('should use provided dialect from options', async () => {
    const mock = createMockDbWithRawTracking('PostgresDialect')
    const deleteFromMock = vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({ numDeletedRows: 0n })
    })
    mock.db.deleteFrom = deleteFromMock

    // Override dialect to SQLite via options
    await cleanDatabase(mock.db, 'truncate', { dialect: 'sqlite', tables: ['users'] })

    // Should use DELETE instead of TRUNCATE (SQLite behavior)
    expect(deleteFromMock).toHaveBeenCalled()
  })
})

describe('CleanupStrategy type', () => {
  it('should accept valid cleanup strategy strings', () => {
    const validStrategies: CleanupStrategy[] = ['transaction', 'delete', 'truncate']

    expect(validStrategies).toHaveLength(3)
  })
})
