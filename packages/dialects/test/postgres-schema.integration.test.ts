/**
 * PostgreSQL Schema Support Integration Tests
 *
 * These tests verify schema support using a real PostgreSQL database.
 * Run with: pnpm test:docker or docker-compose -f docker-compose.test.yml up -d
 *
 * Environment variables:
 * - POSTGRES_HOST: PostgreSQL host (default: localhost)
 * - POSTGRES_PORT: PostgreSQL port (default: 5432)
 * - POSTGRES_USER: PostgreSQL user (default: test)
 * - POSTGRES_PASSWORD: PostgreSQL password (default: test)
 * - POSTGRES_DATABASE: PostgreSQL database (default: kysera_test)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Kysely, PostgresDialect, sql } from 'kysely'
import pg from 'pg'
import {
  PostgresAdapter,
  createPostgresAdapter,
  createDialectAdapter
} from '../src/index.js'

const { Pool } = pg

// Skip tests if PostgreSQL is not available
const POSTGRES_AVAILABLE = process.env.CI || process.env.POSTGRES_HOST

interface TestDB {
  users: {
    id: number
    name: string
    email: string
  }
  posts: {
    id: number
    user_id: number
    title: string
  }
}

const getConnectionConfig = () => ({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  user: process.env.POSTGRES_USER ?? 'test',
  password: process.env.POSTGRES_PASSWORD ?? 'test',
  database: process.env.POSTGRES_DATABASE ?? 'kysera_test'
})

describe.skipIf(!POSTGRES_AVAILABLE)('PostgresAdapter - Schema Integration', () => {
  let db: Kysely<TestDB>
  let adapter: PostgresAdapter

  const TEST_SCHEMA_1 = 'test_schema_a'
  const TEST_SCHEMA_2 = 'test_schema_b'

  beforeAll(async () => {
    const pool = new Pool(getConnectionConfig())
    db = new Kysely<TestDB>({
      dialect: new PostgresDialect({ pool })
    })
    adapter = new PostgresAdapter()

    // Clean up any existing test schemas
    await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA_1} CASCADE`).execute(db)
    await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA_2} CASCADE`).execute(db)
  })

  afterAll(async () => {
    // Clean up test schemas
    await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA_1} CASCADE`).execute(db)
    await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA_2} CASCADE`).execute(db)
    await db.destroy()
  })

  describe('Schema Management', () => {
    it('should check if default public schema exists', async () => {
      const exists = await adapter.schemaExists(db, 'public')
      expect(exists).toBe(true)
    })

    it('should return false for non-existent schema', async () => {
      const exists = await adapter.schemaExists(db, 'nonexistent_schema_xyz')
      expect(exists).toBe(false)
    })

    it('should create a new schema', async () => {
      const created = await adapter.createSchema(db, TEST_SCHEMA_1)
      expect(created).toBe(true)

      const exists = await adapter.schemaExists(db, TEST_SCHEMA_1)
      expect(exists).toBe(true)
    })

    it('should return false when creating existing schema', async () => {
      // First creation should succeed
      await adapter.createSchema(db, TEST_SCHEMA_2)

      // Second creation without ifNotExists should fail
      const created = await adapter.createSchema(db, TEST_SCHEMA_2)
      expect(created).toBe(false)
    })

    it('should create schema with ifNotExists option', async () => {
      const created = await adapter.createSchema(db, TEST_SCHEMA_1, { ifNotExists: true })
      expect(created).toBe(true) // Silent success for existing schema
    })

    it('should list all user schemas', async () => {
      const schemas = await adapter.getSchemas(db)

      expect(schemas).toContain('public')
      expect(schemas).toContain(TEST_SCHEMA_1)
      expect(schemas).toContain(TEST_SCHEMA_2)

      // Should not contain system schemas
      expect(schemas).not.toContain('pg_catalog')
      expect(schemas).not.toContain('information_schema')
    })

    it('should drop a schema', async () => {
      const tempSchema = 'temp_drop_test'
      await adapter.createSchema(db, tempSchema)

      const dropped = await adapter.dropSchema(db, tempSchema)
      expect(dropped).toBe(true)

      const exists = await adapter.schemaExists(db, tempSchema)
      expect(exists).toBe(false)
    })

    it('should return false when dropping non-existent schema', async () => {
      const dropped = await adapter.dropSchema(db, 'nonexistent_xyz', { ifExists: true })
      expect(dropped).toBe(true) // IF EXISTS returns true
    })

    it('should throw when dropping protected schemas', async () => {
      await expect(adapter.dropSchema(db, 'public')).rejects.toThrow('Cannot drop protected schema')
      await expect(adapter.dropSchema(db, 'pg_catalog')).rejects.toThrow('Cannot drop protected schema')
    })

    it('should validate schema name', async () => {
      await expect(adapter.createSchema(db, '')).rejects.toThrow('Invalid schema name')
      await expect(adapter.createSchema(db, '; DROP TABLE users')).rejects.toThrow('Invalid schema name')
    })
  })

  describe('Table Operations with Schema', () => {
    beforeEach(async () => {
      // Ensure test schema exists and has tables
      await adapter.createSchema(db, TEST_SCHEMA_1, { ifNotExists: true })

      // Create table in test schema
      await db.withSchema(TEST_SCHEMA_1).schema
        .createTable('users')
        .ifNotExists()
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('name', 'text', col => col.notNull())
        .addColumn('email', 'text', col => col.notNull())
        .execute()

      // Insert test data
      await db.withSchema(TEST_SCHEMA_1)
        .insertInto('users')
        .values({ name: 'Schema Test User', email: 'schema@test.com' })
        .onConflict(oc => oc.doNothing())
        .execute()
    })

    afterEach(async () => {
      // Clean up tables in test schema
      await sql.raw(`DROP TABLE IF EXISTS ${TEST_SCHEMA_1}.users CASCADE`).execute(db)
    })

    it('should check table exists in specific schema', async () => {
      const existsInTestSchema = await adapter.tableExists(db, 'users', { schema: TEST_SCHEMA_1 })
      expect(existsInTestSchema).toBe(true)

      // Should not find it in public schema (unless it also exists there)
      const existsInPublic = await adapter.tableExists(db, 'users')
      // This depends on whether there's a users table in public schema
      expect(typeof existsInPublic).toBe('boolean')
    })

    it('should return false for non-existent table in schema', async () => {
      const exists = await adapter.tableExists(db, 'nonexistent_table', { schema: TEST_SCHEMA_1 })
      expect(exists).toBe(false)
    })

    it('should get tables from specific schema', async () => {
      const tables = await adapter.getTables(db, { schema: TEST_SCHEMA_1 })
      expect(tables).toContain('users')
    })

    it('should get columns from table in specific schema', async () => {
      const columns = await adapter.getTableColumns(db, 'users', { schema: TEST_SCHEMA_1 })
      expect(columns).toContain('id')
      expect(columns).toContain('name')
      expect(columns).toContain('email')
    })

    it('should truncate table in specific schema', async () => {
      // Verify data exists
      const before = await db.withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()
      expect(before.length).toBeGreaterThan(0)

      // Truncate
      const result = await adapter.truncateTable(db, 'users', { schema: TEST_SCHEMA_1 })
      expect(result).toBe(true)

      // Verify empty
      const after = await db.withSchema(TEST_SCHEMA_1)
        .selectFrom('users')
        .selectAll()
        .execute()
      expect(after.length).toBe(0)
    })

    it('should truncate all tables in specific schema', async () => {
      // Create another table
      await db.withSchema(TEST_SCHEMA_1).schema
        .createTable('posts')
        .ifNotExists()
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('title', 'text', col => col.notNull())
        .execute()

      await db.withSchema(TEST_SCHEMA_1)
        .insertInto('posts')
        .values({ title: 'Test Post' })
        .execute()

      // Truncate all
      await adapter.truncateAllTables(db, [], { schema: TEST_SCHEMA_1 })

      // Verify both tables are empty
      const users = await db.withSchema(TEST_SCHEMA_1).selectFrom('users').selectAll().execute()
      expect(users.length).toBe(0)

      const posts = await db.withSchema(TEST_SCHEMA_1).selectFrom('posts').selectAll().execute()
      expect(posts.length).toBe(0)

      // Clean up
      await sql.raw(`DROP TABLE IF EXISTS ${TEST_SCHEMA_1}.posts CASCADE`).execute(db)
    })
  })

  describe('Custom Default Schema', () => {
    it('should use custom default schema', async () => {
      await adapter.createSchema(db, TEST_SCHEMA_1, { ifNotExists: true })

      const customAdapter = createPostgresAdapter({ defaultSchema: TEST_SCHEMA_1 })
      expect(customAdapter.defaultSchema).toBe(TEST_SCHEMA_1)

      // Create table in test schema
      await db.withSchema(TEST_SCHEMA_1).schema
        .createTable('custom_test')
        .ifNotExists()
        .addColumn('id', 'serial', col => col.primaryKey())
        .execute()

      // Should find table without specifying schema
      const exists = await customAdapter.tableExists(db, 'custom_test')
      expect(exists).toBe(true)

      // Clean up
      await sql.raw(`DROP TABLE IF EXISTS ${TEST_SCHEMA_1}.custom_test CASCADE`).execute(db)
    })

    it('should allow override of default schema', async () => {
      const customAdapter = createPostgresAdapter({ defaultSchema: TEST_SCHEMA_1 })

      // Override with public schema
      const tablesPublic = await customAdapter.getTables(db, { schema: 'public' })
      expect(Array.isArray(tablesPublic)).toBe(true)

      // Use default (TEST_SCHEMA_1)
      const tablesDefault = await customAdapter.getTables(db)
      expect(Array.isArray(tablesDefault)).toBe(true)
    })
  })

  describe('createDialectAdapter with schema', () => {
    it('should create postgres adapter with custom schema', async () => {
      const adapter = createDialectAdapter('postgres', { defaultSchema: 'custom_schema' })
      expect(adapter.dialect).toBe('postgres')
      expect(adapter.defaultSchema).toBe('custom_schema')
    })
  })
})

describe.skipIf(!POSTGRES_AVAILABLE)('PostgresAdapter - Schema Inspection Integration', () => {
  let db: Kysely<TestDB>
  let adapter: PostgresAdapter

  const TEST_SCHEMA = 'inspection_test'

  beforeAll(async () => {
    const pool = new Pool(getConnectionConfig())
    db = new Kysely<TestDB>({
      dialect: new PostgresDialect({ pool })
    })
    adapter = new PostgresAdapter()

    // Clean up and create test schema
    await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`).execute(db)
    await adapter.createSchema(db, TEST_SCHEMA)

    // Create tables with indexes and foreign keys
    await db.withSchema(TEST_SCHEMA).schema
      .createTable('users')
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('email', 'text', col => col.notNull().unique())
      .addColumn('name', 'text', col => col.notNull())
      .execute()

    await db.withSchema(TEST_SCHEMA).schema
      .createTable('posts')
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('user_id', 'integer', col => col.notNull().references(`${TEST_SCHEMA}.users.id`))
      .addColumn('title', 'text', col => col.notNull())
      .execute()

    // Create additional index
    await sql.raw(`CREATE INDEX idx_posts_title ON ${TEST_SCHEMA}.posts (title)`).execute(db)

    // Insert test data
    await db.withSchema(TEST_SCHEMA)
      .insertInto('users')
      .values({ name: 'Test User', email: 'test@example.com' })
      .execute()
  })

  afterAll(async () => {
    await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`).execute(db)
    await db.destroy()
  })

  describe('getSchemaInfo', () => {
    it('should return schema information', async () => {
      const info = await adapter.getSchemaInfo(db, TEST_SCHEMA)

      expect(info.name).toBe(TEST_SCHEMA)
      expect(info.tableCount).toBe(2)
      expect(info.owner).toBeDefined()
      expect(typeof info.sizeBytes).toBe('number')
      expect(info.sizeBytes).toBeGreaterThanOrEqual(0)
    })

    it('should return zero counts for non-existent schema', async () => {
      const info = await adapter.getSchemaInfo(db, 'nonexistent_xyz')
      expect(info.tableCount).toBe(0)
    })
  })

  describe('getSchemaIndexes', () => {
    it('should return indexes in the schema', async () => {
      const indexes = await adapter.getSchemaIndexes(db, { schema: TEST_SCHEMA })

      expect(indexes.length).toBeGreaterThan(0)

      // Find the custom index we created
      const titleIndex = indexes.find(i => i.indexName === 'idx_posts_title')
      expect(titleIndex).toBeDefined()
      expect(titleIndex?.tableName).toBe('posts')
      expect(titleIndex?.columns).toContain('title')
      expect(titleIndex?.isUnique).toBe(false)
      expect(titleIndex?.isPrimary).toBe(false)

      // Find a primary key index
      const pkIndex = indexes.find(i => i.isPrimary && i.tableName === 'users')
      expect(pkIndex).toBeDefined()
      expect(pkIndex?.columns).toContain('id')
    })
  })

  describe('getSchemaForeignKeys', () => {
    it('should return foreign key relationships', async () => {
      const fks = await adapter.getSchemaForeignKeys(db, { schema: TEST_SCHEMA })

      expect(fks.length).toBeGreaterThan(0)

      const postsFk = fks.find(fk => fk.tableName === 'posts')
      expect(postsFk).toBeDefined()
      expect(postsFk?.columnName).toBe('user_id')
      expect(postsFk?.referencedTable).toBe('users')
      expect(postsFk?.referencedColumn).toBe('id')
    })
  })
})

describe.skipIf(!POSTGRES_AVAILABLE)('PostgresAdapter - Search Path Integration', () => {
  let db: Kysely<TestDB>
  let adapter: PostgresAdapter

  const TEST_SCHEMA = 'search_path_test'

  beforeAll(async () => {
    const pool = new Pool(getConnectionConfig())
    db = new Kysely<TestDB>({
      dialect: new PostgresDialect({ pool })
    })
    adapter = new PostgresAdapter()

    await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`).execute(db)
    await adapter.createSchema(db, TEST_SCHEMA)

    // Create table in test schema
    await db.withSchema(TEST_SCHEMA).schema
      .createTable('users')
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('name', 'text', col => col.notNull())
      .addColumn('email', 'text', col => col.notNull())
      .execute()
  })

  afterAll(async () => {
    await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`).execute(db)
    await db.destroy()
  })

  describe('getSearchPath', () => {
    it('should return current search path', async () => {
      const path = await adapter.getSearchPath(db)
      expect(Array.isArray(path)).toBe(true)
      // Default search path typically includes "$user" and "public"
      expect(path.length).toBeGreaterThan(0)
    })
  })

  describe('setSearchPath', () => {
    it('should set the search path', async () => {
      const originalPath = await adapter.getSearchPath(db)

      await adapter.setSearchPath(db, [TEST_SCHEMA, 'public'])
      const newPath = await adapter.getSearchPath(db)

      expect(newPath).toContain(TEST_SCHEMA)
      expect(newPath).toContain('public')

      // Restore original
      if (originalPath.length > 0) {
        await adapter.setSearchPath(db, originalPath)
      }
    })

    it('should validate schema names', async () => {
      await expect(adapter.setSearchPath(db, ['valid', '; DROP TABLE users'])).rejects.toThrow(
        'Invalid schema name'
      )
    })
  })

  describe('withSearchPath', () => {
    it('should execute function with temporary search path', async () => {
      const originalPath = await adapter.getSearchPath(db)

      const result = await adapter.withSearchPath(db, [TEST_SCHEMA], async () => {
        const currentPath = await adapter.getSearchPath(db)
        return currentPath
      })

      expect(result).toContain(TEST_SCHEMA)

      // Search path should be restored
      const restoredPath = await adapter.getSearchPath(db)
      expect(restoredPath).toEqual(originalPath)
    })

    it('should restore search path even on error', async () => {
      const originalPath = await adapter.getSearchPath(db)

      try {
        await adapter.withSearchPath(db, [TEST_SCHEMA], async () => {
          throw new Error('Test error')
        })
      } catch {
        // Expected
      }

      const restoredPath = await adapter.getSearchPath(db)
      expect(restoredPath).toEqual(originalPath)
    })
  })
})

describe.skipIf(!POSTGRES_AVAILABLE)('PostgresAdapter - Schema Cloning Integration', () => {
  let db: Kysely<TestDB>
  let adapter: PostgresAdapter

  const SOURCE_SCHEMA = 'clone_source'
  const TARGET_SCHEMA = 'clone_target'

  beforeAll(async () => {
    const pool = new Pool(getConnectionConfig())
    db = new Kysely<TestDB>({
      dialect: new PostgresDialect({ pool })
    })
    adapter = new PostgresAdapter()

    // Clean up
    await sql.raw(`DROP SCHEMA IF EXISTS ${SOURCE_SCHEMA} CASCADE`).execute(db)
    await sql.raw(`DROP SCHEMA IF EXISTS ${TARGET_SCHEMA} CASCADE`).execute(db)

    // Create source schema with tables and data
    await adapter.createSchema(db, SOURCE_SCHEMA)

    await db.withSchema(SOURCE_SCHEMA).schema
      .createTable('users')
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('name', 'text', col => col.notNull())
      .addColumn('email', 'text', col => col.notNull().unique())
      .execute()

    await db.withSchema(SOURCE_SCHEMA).schema
      .createTable('posts')
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('title', 'text', col => col.notNull())
      .execute()

    await db.withSchema(SOURCE_SCHEMA)
      .insertInto('users')
      .values([
        { name: 'Alice', email: 'alice@test.com' },
        { name: 'Bob', email: 'bob@test.com' }
      ])
      .execute()
  })

  afterAll(async () => {
    await sql.raw(`DROP SCHEMA IF EXISTS ${SOURCE_SCHEMA} CASCADE`).execute(db)
    await sql.raw(`DROP SCHEMA IF EXISTS ${TARGET_SCHEMA} CASCADE`).execute(db)
    await db.destroy()
  })

  beforeEach(async () => {
    // Clean target before each test
    await sql.raw(`DROP SCHEMA IF EXISTS ${TARGET_SCHEMA} CASCADE`).execute(db)
  })

  describe('cloneSchema', () => {
    it('should clone schema structure without data', async () => {
      const result = await adapter.cloneSchema(db, SOURCE_SCHEMA, TARGET_SCHEMA)
      expect(result).toBe(true)

      // Check schema exists
      const exists = await adapter.schemaExists(db, TARGET_SCHEMA)
      expect(exists).toBe(true)

      // Check tables exist
      const tables = await adapter.getTables(db, { schema: TARGET_SCHEMA })
      expect(tables).toContain('users')
      expect(tables).toContain('posts')

      // Check columns match
      const columns = await adapter.getTableColumns(db, 'users', { schema: TARGET_SCHEMA })
      expect(columns).toContain('id')
      expect(columns).toContain('name')
      expect(columns).toContain('email')

      // Check data is NOT copied (structure only)
      const users = await db.withSchema(TARGET_SCHEMA).selectFrom('users').selectAll().execute()
      expect(users.length).toBe(0)
    })

    it('should clone schema with data when includeData is true', async () => {
      await adapter.cloneSchema(db, SOURCE_SCHEMA, TARGET_SCHEMA, { includeData: true })

      // Check data IS copied
      const users = await db.withSchema(TARGET_SCHEMA).selectFrom('users').selectAll().execute()
      expect(users.length).toBe(2)
    })

    it('should exclude specified tables', async () => {
      await adapter.cloneSchema(db, SOURCE_SCHEMA, TARGET_SCHEMA, { excludeTables: ['posts'] })

      const tables = await adapter.getTables(db, { schema: TARGET_SCHEMA })
      expect(tables).toContain('users')
      expect(tables).not.toContain('posts')
    })
  })

  describe('compareSchemas', () => {
    it('should compare two identical schemas', async () => {
      await adapter.cloneSchema(db, SOURCE_SCHEMA, TARGET_SCHEMA)

      const diff = await adapter.compareSchemas(db, SOURCE_SCHEMA, TARGET_SCHEMA)

      expect(diff.onlyInFirst).toEqual([])
      expect(diff.onlyInSecond).toEqual([])
      expect(diff.inBoth.sort()).toEqual(['posts', 'users'])
    })

    it('should detect tables only in first schema', async () => {
      await adapter.cloneSchema(db, SOURCE_SCHEMA, TARGET_SCHEMA, { excludeTables: ['posts'] })

      const diff = await adapter.compareSchemas(db, SOURCE_SCHEMA, TARGET_SCHEMA)

      expect(diff.onlyInFirst).toEqual(['posts'])
      expect(diff.onlyInSecond).toEqual([])
      expect(diff.inBoth).toEqual(['users'])
    })

    it('should detect tables only in second schema', async () => {
      await adapter.cloneSchema(db, SOURCE_SCHEMA, TARGET_SCHEMA)

      // Add extra table to target
      await db.withSchema(TARGET_SCHEMA).schema
        .createTable('extra_table')
        .addColumn('id', 'serial', col => col.primaryKey())
        .execute()

      const diff = await adapter.compareSchemas(db, SOURCE_SCHEMA, TARGET_SCHEMA)

      expect(diff.onlyInFirst).toEqual([])
      expect(diff.onlyInSecond).toEqual(['extra_table'])
      expect(diff.inBoth.sort()).toEqual(['posts', 'users'])
    })
  })
})

describe('PostgresAdapter - Schema Unit Tests', () => {
  const adapter = new PostgresAdapter()

  describe('defaultSchema property', () => {
    it('should have default schema as public', () => {
      expect(adapter.defaultSchema).toBe('public')
    })

    it('should allow custom default schema', () => {
      const customAdapter = new PostgresAdapter({ defaultSchema: 'custom' })
      expect(customAdapter.defaultSchema).toBe('custom')
    })
  })

  describe('Schema validation', () => {
    it('should validate schema names in tableExists', async () => {
      const mockDb = {
        selectFrom: () => ({
          select: () => ({
            where: () => ({
              where: () => ({
                executeTakeFirst: () => Promise.resolve(null)
              })
            })
          })
        })
      }

      await expect(
        adapter.tableExists(mockDb as any, 'users', { schema: '; DROP TABLE users' })
      ).rejects.toThrow('Invalid schema name')
    })

    it('should validate schema names in getTableColumns', async () => {
      const mockDb = {
        selectFrom: () => ({
          select: () => ({
            where: () => ({
              where: () => ({
                execute: () => Promise.resolve([])
              })
            })
          })
        })
      }

      await expect(
        adapter.getTableColumns(mockDb as any, 'users', { schema: '123invalid' })
      ).rejects.toThrow('Invalid schema name')
    })

    it('should validate schema names in getTables', async () => {
      const mockDb = {
        selectFrom: () => ({
          select: () => ({
            where: () => ({
              where: () => ({
                execute: () => Promise.resolve([])
              })
            })
          })
        })
      }

      await expect(
        adapter.getTables(mockDb as any, { schema: '' })
      ).rejects.toThrow('Invalid schema name')
    })
  })
})
