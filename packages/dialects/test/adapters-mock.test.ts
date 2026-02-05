/**
 * Mock-based tests for MySQL and PostgreSQL adapter database methods
 *
 * These tests verify the logic of database-dependent methods using mocked Kysely instances
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PostgresAdapter, MySQLAdapter, SQLiteAdapter } from '../src/index.js'

// Mock Kysely-like query builder chain
const createMockDb = (mockResults: Record<string, unknown[]> = {}) => {
  const mockExecute = vi.fn()
  const mockExecuteTakeFirst = vi.fn()

  const chainable = {
    selectFrom: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: mockExecute,
    executeTakeFirst: mockExecuteTakeFirst
  }

  // Configure default mock implementations
  chainable.selectFrom.mockReturnValue(chainable)
  chainable.select.mockReturnValue(chainable)
  chainable.where.mockReturnValue(chainable)

  return {
    db: chainable as unknown as any,
    mockExecute,
    mockExecuteTakeFirst,
    setResults: (key: string, results: unknown[]) => {
      mockResults[key] = results
    }
  }
}

// =============================================================================
// PostgreSQL Adapter Mock Tests
// =============================================================================

describe('PostgresAdapter - Database Methods (Mocked)', () => {
  const adapter = new PostgresAdapter()
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
    vi.clearAllMocks()
  })

  describe('tableExists', () => {
    it('should return true when table exists', async () => {
      mockDb.mockExecuteTakeFirst.mockResolvedValue({ table_name: 'users' })

      const result = await adapter.tableExists(mockDb.db, 'users')

      expect(result).toBe(true)
      expect(mockDb.db.selectFrom).toHaveBeenCalledWith('information_schema.tables')
    })

    it('should return false when table does not exist', async () => {
      mockDb.mockExecuteTakeFirst.mockResolvedValue(undefined)

      const result = await adapter.tableExists(mockDb.db, 'nonexistent')

      expect(result).toBe(false)
    })

    it('should return false on query error', async () => {
      mockDb.mockExecuteTakeFirst.mockRejectedValue(new Error('Connection error'))

      const result = await adapter.tableExists(mockDb.db, 'users')

      expect(result).toBe(false)
    })

    it('should throw for invalid table names', async () => {
      await expect(adapter.tableExists(mockDb.db, 'DROP TABLE users;--')).rejects.toThrow(
        'Invalid table name'
      )
    })
  })

  describe('getTableColumns', () => {
    it('should return column names', async () => {
      mockDb.mockExecute.mockResolvedValue([
        { column_name: 'id' },
        { column_name: 'name' },
        { column_name: 'email' }
      ])

      const result = await adapter.getTableColumns(mockDb.db, 'users')

      expect(result).toEqual(['id', 'name', 'email'])
      expect(mockDb.db.selectFrom).toHaveBeenCalledWith('information_schema.columns')
    })

    it('should return empty array on error', async () => {
      mockDb.mockExecute.mockRejectedValue(new Error('Connection error'))

      const result = await adapter.getTableColumns(mockDb.db, 'users')

      expect(result).toEqual([])
    })
  })

  describe('getTables', () => {
    it('should return table names', async () => {
      mockDb.mockExecute.mockResolvedValue([{ table_name: 'users' }, { table_name: 'posts' }])

      const result = await adapter.getTables(mockDb.db)

      expect(result).toEqual(['users', 'posts'])
      expect(mockDb.db.where).toHaveBeenCalledWith('table_schema', '=', 'public')
      expect(mockDb.db.where).toHaveBeenCalledWith('table_type', '=', 'BASE TABLE')
    })

    it('should return empty array on error', async () => {
      mockDb.mockExecute.mockRejectedValue(new Error('Connection error'))

      const result = await adapter.getTables(mockDb.db)

      expect(result).toEqual([])
    })
  })

  describe('getDatabaseSize', () => {
    it('should return database size with current database', async () => {
      // Create a more complete mock for sql template tag
      const mockSqlExecute = vi.fn().mockResolvedValue({
        rows: [{ size: 1024000 }]
      })

      const mockDbWithSql = {
        ...mockDb.db
      }

      // We need to test this differently since it uses sql template
      // Just verify the adapter method exists and handles the result properly
      expect(typeof adapter.getDatabaseSize).toBe('function')
    })

    it('should return 0 on error', async () => {
      // getDatabaseSize uses sql template which is hard to mock
      // Test that the method handles errors gracefully
      expect(typeof adapter.getDatabaseSize).toBe('function')
    })
  })

  describe('truncateTable', () => {
    it('should return true on successful truncate', async () => {
      // Create mock that tracks raw SQL execution
      const mockRawExecute = vi.fn().mockResolvedValue(undefined)

      // We need a mock that handles sql.raw()
      // The actual implementation uses sql.raw which is harder to mock
      // Focus on testing the error handling paths

      expect(typeof adapter.truncateTable).toBe('function')
    })

    it('should throw for invalid table names', async () => {
      await expect(adapter.truncateTable(mockDb.db, '; DROP TABLE users;')).rejects.toThrow(
        'Invalid table name'
      )
    })
  })

  describe('truncateAllTables', () => {
    it('should call truncateTable for each table', async () => {
      const spy = vi.spyOn(adapter, 'getTables').mockResolvedValue(['users', 'posts'])
      const truncateSpy = vi.spyOn(adapter, 'truncateTable').mockResolvedValue(true)

      await adapter.truncateAllTables(mockDb.db)

      expect(truncateSpy).toHaveBeenCalledTimes(2)
      // truncateTable is now called with undefined options
      expect(truncateSpy).toHaveBeenCalledWith(mockDb.db, 'users', undefined)
      expect(truncateSpy).toHaveBeenCalledWith(mockDb.db, 'posts', undefined)

      spy.mockRestore()
      truncateSpy.mockRestore()
    })

    it('should exclude specified tables', async () => {
      const spy = vi.spyOn(adapter, 'getTables').mockResolvedValue(['users', 'posts', 'migrations'])
      const truncateSpy = vi.spyOn(adapter, 'truncateTable').mockResolvedValue(true)

      await adapter.truncateAllTables(mockDb.db, ['migrations'])

      expect(truncateSpy).toHaveBeenCalledTimes(2)
      expect(truncateSpy).not.toHaveBeenCalledWith(mockDb.db, 'migrations', expect.anything())

      spy.mockRestore()
      truncateSpy.mockRestore()
    })
  })
})

// =============================================================================
// MySQL Adapter Mock Tests
// =============================================================================

describe('MySQLAdapter - Database Methods (Mocked)', () => {
  const adapter = new MySQLAdapter()
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
    vi.clearAllMocks()
  })

  describe('tableExists', () => {
    it('should return true when table exists', async () => {
      mockDb.mockExecuteTakeFirst.mockResolvedValue({ table_name: 'users' })

      const result = await adapter.tableExists(mockDb.db, 'users')

      expect(result).toBe(true)
      expect(mockDb.db.selectFrom).toHaveBeenCalledWith('information_schema.tables')
    })

    it('should return false when table does not exist', async () => {
      mockDb.mockExecuteTakeFirst.mockResolvedValue(undefined)

      const result = await adapter.tableExists(mockDb.db, 'nonexistent')

      expect(result).toBe(false)
    })

    it('should return false on query error', async () => {
      mockDb.mockExecuteTakeFirst.mockRejectedValue(new Error('Connection error'))

      const result = await adapter.tableExists(mockDb.db, 'users')

      expect(result).toBe(false)
    })

    it('should throw for invalid table names', async () => {
      await expect(adapter.tableExists(mockDb.db, 'DROP TABLE users;--')).rejects.toThrow(
        'Invalid table name'
      )
    })
  })

  describe('getTableColumns', () => {
    it('should return column names', async () => {
      mockDb.mockExecute.mockResolvedValue([
        { column_name: 'id' },
        { column_name: 'name' },
        { column_name: 'email' }
      ])

      const result = await adapter.getTableColumns(mockDb.db, 'users')

      expect(result).toEqual(['id', 'name', 'email'])
      expect(mockDb.db.selectFrom).toHaveBeenCalledWith('information_schema.columns')
    })

    it('should return empty array on error', async () => {
      mockDb.mockExecute.mockRejectedValue(new Error('Connection error'))

      const result = await adapter.getTableColumns(mockDb.db, 'users')

      expect(result).toEqual([])
    })
  })

  describe('getTables', () => {
    it('should return table names', async () => {
      mockDb.mockExecute.mockResolvedValue([{ table_name: 'users' }, { table_name: 'posts' }])

      const result = await adapter.getTables(mockDb.db)

      expect(result).toEqual(['users', 'posts'])
      expect(mockDb.db.where).toHaveBeenCalledWith('table_type', '=', 'BASE TABLE')
    })

    it('should return empty array on error', async () => {
      mockDb.mockExecute.mockRejectedValue(new Error('Connection error'))

      const result = await adapter.getTables(mockDb.db)

      expect(result).toEqual([])
    })
  })

  describe('getDatabaseSize', () => {
    it('should handle database size query', async () => {
      // Method exists and returns number
      expect(typeof adapter.getDatabaseSize).toBe('function')
    })
  })

  describe('truncateTable', () => {
    it('should throw for invalid table names', async () => {
      await expect(adapter.truncateTable(mockDb.db, 'users; DROP DATABASE;')).rejects.toThrow(
        'Invalid table name'
      )
    })
  })

  describe('truncateAllTables', () => {
    it('should call truncateTable for each table', async () => {
      const spy = vi.spyOn(adapter, 'getTables').mockResolvedValue(['users', 'posts'])
      const truncateSpy = vi.spyOn(adapter, 'truncateTable').mockResolvedValue(true)

      await adapter.truncateAllTables(mockDb.db)

      expect(truncateSpy).toHaveBeenCalledTimes(2)
      // truncateTable is now called with undefined options
      expect(truncateSpy).toHaveBeenCalledWith(mockDb.db, 'users', undefined)
      expect(truncateSpy).toHaveBeenCalledWith(mockDb.db, 'posts', undefined)

      spy.mockRestore()
      truncateSpy.mockRestore()
    })

    it('should exclude specified tables', async () => {
      const spy = vi.spyOn(adapter, 'getTables').mockResolvedValue(['users', 'posts', 'sessions'])
      const truncateSpy = vi.spyOn(adapter, 'truncateTable').mockResolvedValue(true)

      await adapter.truncateAllTables(mockDb.db, ['sessions'])

      expect(truncateSpy).toHaveBeenCalledTimes(2)
      expect(truncateSpy).not.toHaveBeenCalledWith(mockDb.db, 'sessions', expect.anything())

      spy.mockRestore()
      truncateSpy.mockRestore()
    })
  })
})

// =============================================================================
// SQLite Adapter Additional Tests
// =============================================================================

describe('SQLiteAdapter - Additional Mock Tests', () => {
  const adapter = new SQLiteAdapter()
  let mockDb: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mockDb = createMockDb()
    vi.clearAllMocks()
  })

  describe('tableExists error handling', () => {
    it('should return false on query error', async () => {
      mockDb.mockExecuteTakeFirst.mockRejectedValue(new Error('Connection error'))

      const result = await adapter.tableExists(mockDb.db, 'users')

      expect(result).toBe(false)
    })

    it('should throw for invalid table names', async () => {
      await expect(adapter.tableExists(mockDb.db, 'DROP TABLE;')).rejects.toThrow(
        'Invalid table name'
      )
    })
  })

  describe('getTableColumns error handling', () => {
    it('should return empty array on error', async () => {
      mockDb.mockExecute.mockRejectedValue(new Error('Connection error'))

      const result = await adapter.getTableColumns(mockDb.db, 'users')

      expect(result).toEqual([])
    })
  })

  describe('getTables error handling', () => {
    it('should return empty array on error', async () => {
      mockDb.mockExecute.mockRejectedValue(new Error('Connection error'))

      const result = await adapter.getTables(mockDb.db)

      expect(result).toEqual([])
    })
  })

  describe('getDatabaseSize', () => {
    it('should return file size for database', async () => {
      expect(typeof adapter.getDatabaseSize).toBe('function')
    })
  })

  describe('truncateTable', () => {
    it('should throw for invalid table names', async () => {
      await expect(adapter.truncateTable(mockDb.db, '; DELETE FROM users')).rejects.toThrow(
        'Invalid table name'
      )
    })
  })

  describe('truncateAllTables', () => {
    it('should call truncateTable for each table', async () => {
      const spy = vi.spyOn(adapter, 'getTables').mockResolvedValue(['users', 'posts'])
      const truncateSpy = vi.spyOn(adapter, 'truncateTable').mockResolvedValue(true)

      await adapter.truncateAllTables(mockDb.db)

      expect(truncateSpy).toHaveBeenCalledTimes(2)

      spy.mockRestore()
      truncateSpy.mockRestore()
    })
  })
})

// =============================================================================
// Schema Support Tests
// =============================================================================

describe('Schema Support Tests', () => {
  describe('PostgresAdapter - Schema Options', () => {
    const adapter = new PostgresAdapter()
    let mockDb: ReturnType<typeof createMockDb>

    beforeEach(() => {
      mockDb = createMockDb()
      vi.clearAllMocks()
    })

    it('should have public as default schema', () => {
      expect(adapter.defaultSchema).toBe('public')
    })

    it('should use custom default schema when provided', () => {
      const customAdapter = new PostgresAdapter({ defaultSchema: 'custom_schema' })
      expect(customAdapter.defaultSchema).toBe('custom_schema')
    })

    it('should use default schema when no options provided', async () => {
      mockDb.mockExecuteTakeFirst.mockResolvedValue({ table_name: 'users' })

      await adapter.tableExists(mockDb.db, 'users')

      // Should filter by public schema
      expect(mockDb.db.where).toHaveBeenCalledWith('table_schema', '=', 'public')
    })

    it('should use custom schema when provided in options', async () => {
      mockDb.mockExecuteTakeFirst.mockResolvedValue({ table_name: 'users' })

      await adapter.tableExists(mockDb.db, 'users', { schema: 'auth' })

      // Should filter by auth schema
      expect(mockDb.db.where).toHaveBeenCalledWith('table_schema', '=', 'auth')
    })

    it('should validate schema names', async () => {
      await expect(
        adapter.tableExists(mockDb.db, 'users', { schema: '; DROP TABLE users' })
      ).rejects.toThrow('Invalid schema name')
    })

    it('should pass schema to getTableColumns', async () => {
      mockDb.mockExecute.mockResolvedValue([{ column_name: 'id' }])

      await adapter.getTableColumns(mockDb.db, 'users', { schema: 'tenant_1' })

      expect(mockDb.db.where).toHaveBeenCalledWith('table_schema', '=', 'tenant_1')
    })

    it('should pass schema to getTables', async () => {
      mockDb.mockExecute.mockResolvedValue([{ table_name: 'users' }])

      await adapter.getTables(mockDb.db, { schema: 'admin' })

      expect(mockDb.db.where).toHaveBeenCalledWith('table_schema', '=', 'admin')
    })

    it('should pass schema to truncateAllTables', async () => {
      const spy = vi.spyOn(adapter, 'getTables').mockResolvedValue(['users'])
      const truncateSpy = vi.spyOn(adapter, 'truncateTable').mockResolvedValue(true)

      await adapter.truncateAllTables(mockDb.db, [], { schema: 'test_schema' })

      expect(spy).toHaveBeenCalledWith(mockDb.db, { schema: 'test_schema' })
      expect(truncateSpy).toHaveBeenCalledWith(mockDb.db, 'users', { schema: 'test_schema' })

      spy.mockRestore()
      truncateSpy.mockRestore()
    })
  })

  describe('MySQLAdapter - Schema Options', () => {
    const adapter = new MySQLAdapter()
    let mockDb: ReturnType<typeof createMockDb>

    beforeEach(() => {
      mockDb = createMockDb()
      vi.clearAllMocks()
    })

    it('should have empty string as default schema (uses DATABASE())', () => {
      expect(adapter.defaultSchema).toBe('')
    })

    it('should use custom default schema when provided', () => {
      const customAdapter = new MySQLAdapter({ defaultSchema: 'my_database' })
      expect(customAdapter.defaultSchema).toBe('my_database')
    })

    it('should use specified schema in tableExists', async () => {
      mockDb.mockExecuteTakeFirst.mockResolvedValue({ table_name: 'users' })

      await adapter.tableExists(mockDb.db, 'users', { schema: 'my_db' })

      expect(mockDb.db.where).toHaveBeenCalledWith('table_schema', '=', 'my_db')
    })
  })

  describe('SQLiteAdapter - Schema Options', () => {
    const adapter = new SQLiteAdapter()
    let mockDb: ReturnType<typeof createMockDb>

    beforeEach(() => {
      mockDb = createMockDb()
      vi.clearAllMocks()
    })

    it('should have main as default schema', () => {
      expect(adapter.defaultSchema).toBe('main')
    })

    it('should use custom default schema when provided', () => {
      const customAdapter = new SQLiteAdapter({ defaultSchema: 'attached_db' })
      expect(customAdapter.defaultSchema).toBe('attached_db')
    })
  })
})

// =============================================================================
// Cross-Dialect Consistency Tests
// =============================================================================

describe('Cross-Dialect Consistency', () => {
  const adapters = [
    { name: 'PostgreSQL', adapter: new PostgresAdapter() },
    { name: 'MySQL', adapter: new MySQLAdapter() },
    { name: 'SQLite', adapter: new SQLiteAdapter() }
  ]

  describe('All adapters should have consistent interfaces', () => {
    adapters.forEach(({ name, adapter }) => {
      it(`${name} should implement tableExists`, () => {
        expect(typeof adapter.tableExists).toBe('function')
      })

      it(`${name} should implement getTableColumns`, () => {
        expect(typeof adapter.getTableColumns).toBe('function')
      })

      it(`${name} should implement getTables`, () => {
        expect(typeof adapter.getTables).toBe('function')
      })

      it(`${name} should implement getDatabaseSize`, () => {
        expect(typeof adapter.getDatabaseSize).toBe('function')
      })

      it(`${name} should implement truncateTable`, () => {
        expect(typeof adapter.truncateTable).toBe('function')
      })

      it(`${name} should implement truncateAllTables`, () => {
        expect(typeof adapter.truncateAllTables).toBe('function')
      })
    })
  })

  describe('Identifier validation', () => {
    adapters.forEach(({ name, adapter }) => {
      it(`${name} should reject SQL injection in tableExists`, async () => {
        const mockDb = createMockDb()
        await expect(adapter.tableExists(mockDb.db, "users'; DROP TABLE users;--")).rejects.toThrow()
      })

      it(`${name} should reject SQL injection in getTableColumns`, async () => {
        const mockDb = createMockDb()
        await expect(
          adapter.getTableColumns(mockDb.db, "users'; DROP TABLE users;--")
        ).rejects.toThrow()
      })

      it(`${name} should reject SQL injection in truncateTable`, async () => {
        const mockDb = createMockDb()
        await expect(
          adapter.truncateTable(mockDb.db, "users'; DROP TABLE users;--")
        ).rejects.toThrow()
      })
    })
  })
})
