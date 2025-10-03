import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createDatabaseConnection,
  testDatabaseConnection,
  introspectDatabase,
  runQuery
} from '@/utils/database'
import { Kysely } from 'kysely'

// Mock Kysely and dialects
vi.mock('kysely', () => {
  class MockKysely {
    destroy = vi.fn()
    introspection = {
      getTables: vi.fn().mockResolvedValue([
        { name: 'users', schema: 'public' },
        { name: 'posts', schema: 'public' }
      ])
    }
    schema = {
      createTable: vi.fn().mockReturnThis(),
      dropTable: vi.fn().mockReturnThis(),
      execute: vi.fn()
    }
    selectFrom = vi.fn().mockReturnThis()
    selectAll = vi.fn().mockReturnThis()
    execute = vi.fn().mockResolvedValue([])
  }

  return {
    Kysely: MockKysely,
    PostgresDialect: vi.fn(),
    MysqlDialect: vi.fn(),
    SqliteDialect: vi.fn(),
    sql: {
      raw: vi.fn()
    }
  }
})

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    end: vi.fn()
  }))
}))

vi.mock('mysql2', () => ({
  createPool: vi.fn().mockImplementation(() => ({
    end: vi.fn()
  }))
}))

vi.mock('better-sqlite3', () => ({
  default: vi.fn().mockImplementation(() => ({}))
}))

describe('createDatabaseConnection', () => {
  it('should create a PostgreSQL connection', async () => {
    const config = {
      dialect: 'postgres' as const,
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      user: 'testuser',
      password: 'testpass'
    }

    const db = await createDatabaseConnection(config)
    expect(db).toBeDefined()
    expect(db.destroy).toBeDefined()
  })

  it('should create a MySQL connection', async () => {
    const config = {
      dialect: 'mysql' as const,
      host: 'localhost',
      port: 3306,
      database: 'testdb',
      user: 'testuser',
      password: 'testpass'
    }

    const db = await createDatabaseConnection(config)
    expect(db).toBeDefined()
    expect(db.destroy).toBeDefined()
  })

  it('should create a SQLite connection', async () => {
    const config = {
      dialect: 'sqlite' as const,
      database: './test.db'
    }

    const db = await createDatabaseConnection(config)
    expect(db).toBeDefined()
    expect(db.destroy).toBeDefined()
  })

  it('should use connection string if provided', async () => {
    const config = {
      dialect: 'postgres' as const,
      connectionString: 'postgres://user:pass@localhost:5432/db'
    }

    const db = await createDatabaseConnection(config)
    expect(db).toBeDefined()
  })

  it('should apply pool configuration', async () => {
    const config = {
      dialect: 'postgres' as const,
      host: 'localhost',
      database: 'testdb',
      pool: {
        min: 5,
        max: 20
      }
    }

    const db = await createDatabaseConnection(config)
    expect(db).toBeDefined()
  })

  it('should throw for unsupported dialect', async () => {
    const config = {
      dialect: 'mongodb' as any,
      database: 'testdb'
    }

    await expect(createDatabaseConnection(config)).rejects.toThrow()
  })
})

describe('testDatabaseConnection', () => {
  it('should successfully test connection', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([{ result: 1 }]),
      destroy: vi.fn()
    }

    const result = await testDatabaseConnection(mockDb as any)
    expect(result).toBe(true)
    expect(mockDb.destroy).toHaveBeenCalled()
  })

  it('should return false on connection error', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      execute: vi.fn().mockRejectedValue(new Error('Connection failed')),
      destroy: vi.fn()
    }

    const result = await testDatabaseConnection(mockDb as any)
    expect(result).toBe(false)
    expect(mockDb.destroy).toHaveBeenCalled()
  })
})

describe('introspectDatabase', () => {
  it('should return database tables', async () => {
    const mockDb = {
      introspection: {
        getTables: vi.fn().mockResolvedValue([
          { name: 'users', schema: 'public' },
          { name: 'posts', schema: 'public' },
          { name: 'comments', schema: 'public' }
        ])
      },
      destroy: vi.fn()
    }

    const result = await introspectDatabase(mockDb as any)

    expect(result).toEqual({
      tables: [
        { name: 'users', schema: 'public' },
        { name: 'posts', schema: 'public' },
        { name: 'comments', schema: 'public' }
      ]
    })
  })

  it('should filter tables by options', async () => {
    const mockDb = {
      introspection: {
        getTables: vi.fn().mockResolvedValue([
          { name: 'users', schema: 'public' },
          { name: 'posts', schema: 'public' },
          { name: '_migrations', schema: 'public' },
          { name: 'admin_users', schema: 'admin' }
        ])
      },
      destroy: vi.fn()
    }

    const result = await introspectDatabase(mockDb as any, {
      schema: 'public',
      excludePattern: '^_'
    })

    expect(result.tables).toHaveLength(2)
    expect(result.tables.map((t: any) => t.name)).toEqual(['users', 'posts'])
  })
})

describe('runQuery', () => {
  it('should execute a SELECT query', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([
        { id: 1, name: 'User 1' },
        { id: 2, name: 'User 2' }
      ])
    }

    const result = await runQuery(mockDb as any, 'SELECT * FROM users')

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ id: 1, name: 'User 1' })
  })

  it('should execute an INSERT query', async () => {
    const mockDb = {
      insertInto: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ insertId: 1 })
    }

    const result = await runQuery(
      mockDb as any,
      'INSERT INTO users (name) VALUES (?)',
      ['Test User']
    )

    expect(result).toEqual({ insertId: 1 })
  })

  it('should execute an UPDATE query', async () => {
    const mockDb = {
      updateTable: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ numUpdatedRows: 1 })
    }

    const result = await runQuery(
      mockDb as any,
      'UPDATE users SET name = ? WHERE id = ?',
      ['Updated Name', 1]
    )

    expect(result).toEqual({ numUpdatedRows: 1 })
  })

  it('should execute a DELETE query', async () => {
    const mockDb = {
      deleteFrom: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ numDeletedRows: 1 })
    }

    const result = await runQuery(
      mockDb as any,
      'DELETE FROM users WHERE id = ?',
      [1]
    )

    expect(result).toEqual({ numDeletedRows: 1 })
  })

  it('should handle query errors', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      execute: vi.fn().mockRejectedValue(new Error('Query failed'))
    }

    await expect(
      runQuery(mockDb as any, 'SELECT * FROM invalid_table')
    ).rejects.toThrow('Query failed')
  })
})