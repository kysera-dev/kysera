import { describe, it, expect } from 'vitest'
import { Kysely, DummyDriver, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from 'kysely'
import {
  createQualifiedColumn,
  applyWhereCondition,
  createRawCondition,
  selectFromDynamicTable,
  whereIdEquals,
  transformQueryBuilder,
  hasRawDb,
  getRawDbSafe
} from '../../src/utils/type-utils.js'

interface TestDB {
  users: {
    id: number
    uuid: string
    name: string
    tenant_id: string
  }
}

describe('Type Utils', () => {
  // Create a test database instance
  const db = new Kysely<TestDB>({
    dialect: {
      createAdapter: () => new SqliteAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: db => new SqliteIntrospector(db),
      createQueryCompiler: () => new SqliteQueryCompiler()
    }
  })

  describe('createQualifiedColumn', () => {
    it('should create qualified column name', () => {
      expect(createQualifiedColumn('users', 'name')).toBe('users.name')
      expect(createQualifiedColumn('posts', 'title')).toBe('posts.title')
    })

    it('should handle special characters in names', () => {
      expect(createQualifiedColumn('my_table', 'my_column')).toBe('my_table.my_column')
    })
  })

  describe('applyWhereCondition', () => {
    it('should apply equality condition', () => {
      const qb = db.selectFrom('users').selectAll()
      const result = applyWhereCondition(qb, 'users.id', '=', 1)

      const sql = result.compile().sql
      expect(sql).toContain('where')
      expect(sql).toContain('"users"."id"')
    })

    it('should apply IS condition', () => {
      const qb = db.selectFrom('users').selectAll()
      const result = applyWhereCondition(qb, 'users.name', 'is', null)

      const sql = result.compile().sql
      expect(sql).toContain('where')
    })

    it('should apply IN condition', () => {
      const qb = db.selectFrom('users').selectAll()
      const result = applyWhereCondition(qb, 'users.id', 'in', [1, 2, 3])

      const sql = result.compile().sql
      expect(sql).toContain('where')
      expect(sql).toContain('in')
    })
  })

  describe('createRawCondition', () => {
    it('should create raw SQL condition', () => {
      const condition = createRawCondition('FALSE')
      expect(condition).toBeDefined()
    })

    it('should handle complex expressions', () => {
      const condition = createRawCondition('1 = 0')
      expect(condition).toBeDefined()
    })
  })

  describe('selectFromDynamicTable', () => {
    it('should create query builder for dynamic table', () => {
      const qb = selectFromDynamicTable(db, 'users')
      const sql = qb.compile().sql

      expect(sql).toContain('select')
      expect(sql).toContain('"users"')
    })
  })

  describe('whereIdEquals', () => {
    it('should filter by default id column', () => {
      const qb = db.selectFrom('users').selectAll()
      const result = whereIdEquals(qb, 1)

      const sql = result.compile().sql
      expect(sql).toContain('where')
      expect(sql).toContain('"id"')
      expect(sql).toContain('=')
    })

    it('should filter by custom primary key column', () => {
      const qb = db.selectFrom('users').selectAll()
      const result = whereIdEquals(qb, 'abc-123', 'uuid')

      const sql = result.compile().sql
      expect(sql).toContain('where')
      expect(sql).toContain('"uuid"')
      expect(sql).toContain('=')
    })

    it('should work with numeric IDs', () => {
      const qb = db.selectFrom('users').selectAll()
      const result = whereIdEquals(qb, 42, 'id')

      const { sql, parameters } = result.compile()
      expect(sql).toContain('where')
      expect(parameters).toContain(42)
    })

    it('should work with string IDs', () => {
      const qb = db.selectFrom('users').selectAll()
      const result = whereIdEquals(qb, 'user-uuid-123', 'uuid')

      const { sql, parameters } = result.compile()
      expect(sql).toContain('where')
      expect(parameters).toContain('user-uuid-123')
    })

    it('should work with composite key column names', () => {
      const qb = db.selectFrom('users').selectAll()
      const result = whereIdEquals(qb, 'val', 'tenant_id')

      const sql = result.compile().sql
      expect(sql).toContain('"tenant_id"')
    })
  })

  describe('transformQueryBuilder', () => {
    it('should transform select queries', () => {
      const qb = db.selectFrom('users').selectAll()

      const transformed = transformQueryBuilder(qb, 'select', selectQb => {
        return selectQb.where('id' as any, '=', 1 as any)
      })

      const sql = transformed.compile().sql
      expect(sql).toContain('where')
    })

    it('should not transform non-select queries', () => {
      const qb = db.selectFrom('users').selectAll()

      const transformed = transformQueryBuilder(qb, 'insert', selectQb => {
        return selectQb.where('id' as any, '=', 1 as any)
      })

      // Should return unchanged
      const sql = transformed.compile().sql
      expect(sql).not.toContain('where')
    })

    it('should pass through update operations unchanged', () => {
      const qb = db.selectFrom('users').selectAll()

      const transformed = transformQueryBuilder(qb, 'update', selectQb => {
        return selectQb.where('id' as any, '=', 1 as any)
      })

      const sql = transformed.compile().sql
      expect(sql).not.toContain('where')
    })
  })

  describe('hasRawDb', () => {
    it('should return false for plain executor', () => {
      expect(hasRawDb(db)).toBe(false)
    })

    it('should return true for executor with __rawDb', () => {
      const executorWithRawDb = Object.assign(db, {
        __rawDb: db
      })
      expect(hasRawDb(executorWithRawDb)).toBe(true)
    })

    it('should return false for executor with undefined __rawDb', () => {
      const executorWithUndefinedRawDb = Object.assign({} as Kysely<TestDB>, {
        __rawDb: undefined
      })
      expect(hasRawDb(executorWithUndefinedRawDb)).toBe(false)
    })
  })

  describe('getRawDbSafe', () => {
    it('should return original executor when no __rawDb', () => {
      const result = getRawDbSafe(db)
      expect(result).toBe(db)
    })

    it('should return __rawDb when present', () => {
      const rawDb = new Kysely<TestDB>({
        dialect: {
          createAdapter: () => new SqliteAdapter(),
          createDriver: () => new DummyDriver(),
          createIntrospector: db => new SqliteIntrospector(db),
          createQueryCompiler: () => new SqliteQueryCompiler()
        }
      })

      const executorWithRawDb = Object.assign(
        new Kysely<TestDB>({
          dialect: {
            createAdapter: () => new SqliteAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: db => new SqliteIntrospector(db),
            createQueryCompiler: () => new SqliteQueryCompiler()
          }
        }),
        { __rawDb: rawDb }
      )

      const result = getRawDbSafe(executorWithRawDb)
      expect(result).toBe(rawDb)
    })
  })
})
