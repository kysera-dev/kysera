/**
 * Unit tests for PostgresAdapter's sql-template and schema-management methods.
 *
 * These use the fake-kysely driver (real PostgresQueryCompiler, canned rows),
 * so they verify both the exact SQL the adapter emits and how it maps or
 * error-handles the driver's responses — without a live database. The same
 * surface runs against real PostgreSQL in test/multi-db.integration.test.ts.
 */

import { describe, it, expect } from 'vitest'
import { PostgresAdapter } from '../src/index.js'
import { createFakeDb, createCapturingLogger, type ExecutedQuery } from './helpers/fake-kysely.js'

const adapter = new PostgresAdapter()

describe('PostgresAdapter.getDatabaseSize (unit)', () => {
  it('parameterizes the database name and coerces bigint-as-string', async () => {
    const { db, executed } = createFakeDb('postgres', () => [{ size: '2048' }])

    const size = await adapter.getDatabaseSize(db, 'mydb')

    expect(size).toBe(2048)
    expect(executed[0]?.sql).toContain('pg_database_size($1)')
    expect(executed[0]?.parameters).toEqual(['mydb'])
  })

  it('uses current_database() when no name is given and passes numbers through', async () => {
    const { db, executed } = createFakeDb('postgres', () => [{ size: 4096 }])

    const size = await adapter.getDatabaseSize(db)

    expect(size).toBe(4096)
    expect(executed[0]?.sql).toContain('pg_database_size(current_database())')
    expect(executed[0]?.parameters).toEqual([])
  })

  it('returns 0 for empty results, null sizes, and query errors', async () => {
    const empty = createFakeDb('postgres', () => [])
    expect(await adapter.getDatabaseSize(empty.db)).toBe(0)

    const nullSize = createFakeDb('postgres', () => [{ size: null }])
    expect(await adapter.getDatabaseSize(nullSize.db)).toBe(0)

    const failing = createFakeDb('postgres', () => {
      throw new Error('connection refused')
    })
    expect(await adapter.getDatabaseSize(failing.db)).toBe(0)
  })
})

describe('PostgresAdapter.truncateTable (unit)', () => {
  it('emits TRUNCATE ... RESTART IDENTITY CASCADE with the qualified table', async () => {
    const { db, executed } = createFakeDb('postgres')

    const result = await adapter.truncateTable(db, 'users')

    expect(result).toBe(true)
    expect(executed[0]?.sql).toBe('TRUNCATE TABLE "public"."users" RESTART IDENTITY CASCADE')
  })

  it('honors the schema option', async () => {
    const { db, executed } = createFakeDb('postgres')

    await adapter.truncateTable(db, 'users', { schema: 'tenant_1' })

    expect(executed[0]?.sql).toBe('TRUNCATE TABLE "tenant_1"."users" RESTART IDENTITY CASCADE')
  })

  it('returns false when the table does not exist', async () => {
    const { db } = createFakeDb('postgres', () => {
      throw new Error('relation "public.users" does not exist')
    })

    expect(await adapter.truncateTable(db, 'users')).toBe(false)
  })

  it('logs and rethrows unexpected errors', async () => {
    const { logger, entries } = createCapturingLogger()
    const failing = new PostgresAdapter({ logger })
    const { db } = createFakeDb('postgres', () => {
      throw new Error('permission denied for table users')
    })

    await expect(failing.truncateTable(db, 'users')).rejects.toThrow('permission denied')
    expect(entries.some(e => e.level === 'error' && e.message.includes('users'))).toBe(true)
  })
})

describe('PostgresAdapter.truncateAllTables (unit)', () => {
  it('truncates all tables in a single multi-table statement', async () => {
    const { db, executed } = createFakeDb('postgres', query =>
      query.sql.startsWith('select') ? [{ table_name: 'users' }, { table_name: 'posts' }] : []
    )

    await adapter.truncateAllTables(db)

    const truncates = executed.filter(q => q.sql.startsWith('TRUNCATE'))
    expect(truncates).toHaveLength(1)
    expect(truncates[0]?.sql).toBe(
      'TRUNCATE TABLE "public"."users", "public"."posts" RESTART IDENTITY CASCADE'
    )
  })

  it('excludes the given tables and does nothing when all are excluded', async () => {
    const { db, executed } = createFakeDb('postgres', query =>
      query.sql.startsWith('select') ? [{ table_name: 'users' }] : []
    )

    await adapter.truncateAllTables(db, ['users'])

    expect(executed.filter(q => q.sql.startsWith('TRUNCATE'))).toHaveLength(0)
  })

  it('falls back to sequential truncation when the batch statement fails', async () => {
    const { logger, entries } = createCapturingLogger()
    const withLogger = new PostgresAdapter({ logger })
    const { db, executed } = createFakeDb('postgres', query => {
      if (query.sql.startsWith('select')) return [{ table_name: 'users' }, { table_name: 'posts' }]
      // Multi-table TRUNCATE fails; the per-table fallback succeeds
      if (query.sql.includes('", "')) throw new Error('deadlock detected')
      return []
    })

    await withLogger.truncateAllTables(db)

    const truncates = executed.filter(q => q.sql.startsWith('TRUNCATE'))
    expect(truncates.map(q => q.sql)).toEqual([
      'TRUNCATE TABLE "public"."users", "public"."posts" RESTART IDENTITY CASCADE',
      'TRUNCATE TABLE "public"."users" RESTART IDENTITY CASCADE',
      'TRUNCATE TABLE "public"."posts" RESTART IDENTITY CASCADE'
    ])
    expect(entries.some(e => e.level === 'warn' && e.message.includes('Batch TRUNCATE failed'))).toBe(
      true
    )
  })
})

describe('PostgresAdapter schema existence and listing (unit)', () => {
  it('schemaExists returns true/false based on information_schema.schemata', async () => {
    const found = createFakeDb('postgres', () => [{ schema_name: 'auth' }])
    expect(await adapter.schemaExists(found.db, 'auth')).toBe(true)
    expect(found.executed[0]?.sql).toContain('"information_schema"."schemata"')
    expect(found.executed[0]?.parameters).toEqual(['auth'])

    const missing = createFakeDb('postgres', () => [])
    expect(await adapter.schemaExists(missing.db, 'auth')).toBe(false)
  })

  it('schemaExists rejects invalid identifiers and swallows query errors', async () => {
    const { db } = createFakeDb('postgres')
    await expect(adapter.schemaExists(db, 'bad; DROP SCHEMA x')).rejects.toThrow(
      'Invalid schema name'
    )

    const failing = createFakeDb('postgres', () => {
      throw new Error('boom')
    })
    expect(await adapter.schemaExists(failing.db, 'auth')).toBe(false)
  })

  it('getSchemas returns names and filters system schemas in SQL', async () => {
    const { db, executed } = createFakeDb('postgres', () => [
      { schema_name: 'public' },
      { schema_name: 'tenant_1' }
    ])

    expect(await adapter.getSchemas(db)).toEqual(['public', 'tenant_1'])
    expect(executed[0]?.sql).toContain('not like')
    expect(executed[0]?.parameters).toContain('pg_%')

    const failing = createFakeDb('postgres', () => {
      throw new Error('boom')
    })
    expect(await adapter.getSchemas(failing.db)).toEqual([])
  })
})

describe('PostgresAdapter.createSchema / dropSchema (unit)', () => {
  it('creates a schema, with and without IF NOT EXISTS', async () => {
    const plain = createFakeDb('postgres')
    expect(await adapter.createSchema(plain.db, 'tenant_9')).toBe(true)
    expect(plain.executed[0]?.sql).toBe('CREATE SCHEMA "tenant_9"')

    const idempotent = createFakeDb('postgres')
    expect(await adapter.createSchema(idempotent.db, 'tenant_9', { ifNotExists: true })).toBe(true)
    expect(idempotent.executed[0]?.sql).toBe('CREATE SCHEMA IF NOT EXISTS "tenant_9"')
  })

  it('returns false when the schema already exists, rethrows other errors', async () => {
    const exists = createFakeDb('postgres', () => {
      throw new Error('schema "tenant_9" already exists')
    })
    expect(await adapter.createSchema(exists.db, 'tenant_9')).toBe(false)

    const { logger, entries } = createCapturingLogger()
    const withLogger = new PostgresAdapter({ logger })
    const denied = createFakeDb('postgres', () => {
      throw new Error('permission denied for database')
    })
    await expect(withLogger.createSchema(denied.db, 'tenant_9')).rejects.toThrow(
      'permission denied'
    )
    expect(entries.some(e => e.level === 'error')).toBe(true)
  })

  it('refuses to drop protected schemas', async () => {
    const { db, executed } = createFakeDb('postgres')

    for (const name of ['public', 'pg_catalog', 'information_schema']) {
      await expect(adapter.dropSchema(db, name)).rejects.toThrow(
        `Cannot drop protected schema: ${name}`
      )
    }
    expect(executed).toHaveLength(0)
  })

  it('drops schemas with IF EXISTS / CASCADE flags', async () => {
    const { db, executed } = createFakeDb('postgres')

    expect(await adapter.dropSchema(db, 'tenant_9')).toBe(true)
    expect(await adapter.dropSchema(db, 'tenant_9', { ifExists: true, cascade: true })).toBe(true)

    expect(executed.map(q => q.sql)).toEqual([
      'DROP SCHEMA "tenant_9"',
      'DROP SCHEMA IF EXISTS "tenant_9" CASCADE'
    ])
  })

  it('returns false for missing schemas, rethrows and logs other errors', async () => {
    const missing = createFakeDb('postgres', () => {
      throw new Error('schema "tenant_9" does not exist')
    })
    expect(await adapter.dropSchema(missing.db, 'tenant_9')).toBe(false)

    const { logger, entries } = createCapturingLogger()
    const withLogger = new PostgresAdapter({ logger })
    const busy = createFakeDb('postgres', () => {
      throw new Error('cannot drop schema because other objects depend on it')
    })
    await expect(withLogger.dropSchema(busy.db, 'tenant_9')).rejects.toThrow('depend on it')
    expect(entries.some(e => e.level === 'error')).toBe(true)
  })
})

describe('PostgresAdapter.getSchemaInfo (unit)', () => {
  const route = (query: ExecutedQuery): unknown[] => {
    if (query.sql.includes('count(*)')) return [{ count: 3 }]
    if (query.sql.includes('pg_get_userbyid')) return [{ owner: 'app_user' }]
    if (query.sql.includes('pg_total_relation_size')) return [{ size: '1048576' }]
    return []
  }

  it('aggregates table count, owner, and size (bigint delivered as string)', async () => {
    const { db } = createFakeDb('postgres', route)

    expect(await adapter.getSchemaInfo(db, 'tenant_1')).toEqual({
      name: 'tenant_1',
      tableCount: 3,
      owner: 'app_user',
      sizeBytes: 1048576
    })
  })

  it('passes numeric sizes through and defaults missing values', async () => {
    const { db } = createFakeDb('postgres', query =>
      query.sql.includes('pg_total_relation_size') ? [{ size: 512 }] : []
    )

    expect(await adapter.getSchemaInfo(db, 'tenant_1')).toEqual({
      name: 'tenant_1',
      tableCount: 0,
      owner: null,
      sizeBytes: 512
    })
  })

  it('returns a zeroed result on query errors', async () => {
    const { logger, entries } = createCapturingLogger()
    const withLogger = new PostgresAdapter({ logger })
    const { db } = createFakeDb('postgres', () => {
      throw new Error('boom')
    })

    expect(await withLogger.getSchemaInfo(db, 'tenant_1')).toEqual({
      name: 'tenant_1',
      tableCount: 0,
      owner: null,
      sizeBytes: 0
    })
    expect(entries.some(e => e.level === 'error')).toBe(true)
  })
})

describe('PostgresAdapter.getSchemaIndexes / getSchemaForeignKeys (unit)', () => {
  it('maps index rows and splits aggregated column lists', async () => {
    const { db, executed } = createFakeDb('postgres', () => [
      {
        table_name: 'users',
        index_name: 'users_email_key',
        index_type: 'btree',
        is_unique: true,
        is_primary: false,
        column_names: 'email, tenant_id'
      }
    ])

    expect(await adapter.getSchemaIndexes(db, { schema: 'auth' })).toEqual([
      {
        tableName: 'users',
        indexName: 'users_email_key',
        indexType: 'btree',
        isUnique: true,
        isPrimary: false,
        columns: ['email', 'tenant_id']
      }
    ])
    expect(executed[0]?.parameters).toEqual(['auth'])
  })

  it('maps foreign key rows to camelCase', async () => {
    const { db } = createFakeDb('postgres', () => [
      {
        constraint_name: 'posts_author_fk',
        table_name: 'posts',
        column_name: 'author_id',
        referenced_schema: 'public',
        referenced_table: 'users',
        referenced_column: 'id',
        on_delete: 'CASCADE',
        on_update: 'NO ACTION'
      }
    ])

    expect(await adapter.getSchemaForeignKeys(db)).toEqual([
      {
        constraintName: 'posts_author_fk',
        tableName: 'posts',
        columnName: 'author_id',
        referencedSchema: 'public',
        referencedTable: 'users',
        referencedColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION'
      }
    ])
  })

  it('returns empty arrays on query errors', async () => {
    const { db } = createFakeDb('postgres', () => {
      throw new Error('boom')
    })

    expect(await adapter.getSchemaIndexes(db)).toEqual([])
    expect(await adapter.getSchemaForeignKeys(db)).toEqual([])
  })
})

describe('PostgresAdapter search path management (unit)', () => {
  it('getSearchPath parses and unquotes SHOW search_path output', async () => {
    const { db } = createFakeDb('postgres', () => [{ search_path: '"$user", public, "tenant 1"' }])

    expect(await adapter.getSearchPath(db)).toEqual(['$user', 'public', 'tenant 1'])
  })

  it('getSearchPath returns [] for empty output and on errors', async () => {
    const empty = createFakeDb('postgres', () => [])
    expect(await adapter.getSearchPath(empty.db)).toEqual([])

    const failing = createFakeDb('postgres', () => {
      throw new Error('boom')
    })
    expect(await adapter.getSearchPath(failing.db)).toEqual([])
  })

  it('setSearchPath escapes each schema and validates first', async () => {
    const { db, executed } = createFakeDb('postgres')

    await adapter.setSearchPath(db, ['tenant_1', 'public'])
    expect(executed[0]?.sql).toBe('SET search_path TO "tenant_1", "public"')

    await expect(adapter.setSearchPath(db, ['ok', 'bad name'])).rejects.toThrow(
      'Invalid schema name'
    )
    // Validation happens before any SQL is sent for the invalid call
    expect(executed).toHaveLength(1)
  })

  it('withSearchPath sets the temporary path and restores the original', async () => {
    const { db, executed } = createFakeDb('postgres', query =>
      query.sql.startsWith('SHOW') ? [{ search_path: 'public' }] : []
    )

    const result = await adapter.withSearchPath(db, ['tenant_1'], () => Promise.resolve(42))

    expect(result).toBe(42)
    expect(executed.map(q => q.sql)).toEqual([
      'SHOW search_path',
      'SET search_path TO "tenant_1"',
      'SET search_path TO "public"'
    ])
  })

  it('withSearchPath restores the original path even when fn throws', async () => {
    const { db, executed } = createFakeDb('postgres', query =>
      query.sql.startsWith('SHOW') ? [{ search_path: 'public' }] : []
    )

    await expect(
      adapter.withSearchPath(db, ['tenant_1'], () => Promise.reject(new Error('fn failed')))
    ).rejects.toThrow('fn failed')
    expect(executed.at(-1)?.sql).toBe('SET search_path TO "public"')
  })

  it('withSearchPath skips restoration when the original path is empty', async () => {
    const { db, executed } = createFakeDb('postgres', query =>
      query.sql.startsWith('SHOW') ? [] : []
    )

    await adapter.withSearchPath(db, ['tenant_1'], () => Promise.resolve('ok'))

    expect(executed.map(q => q.sql)).toEqual(['SHOW search_path', 'SET search_path TO "tenant_1"'])
  })
})

describe('PostgresAdapter.cloneSchema / compareSchemas (unit)', () => {
  it('clones structure with CREATE TABLE ... (LIKE ... INCLUDING ALL)', async () => {
    const { db, executed } = createFakeDb('postgres', query =>
      query.sql.startsWith('select') ? [{ table_name: 'users' }, { table_name: 'posts' }] : []
    )

    expect(await adapter.cloneSchema(db, 'template', 'tenant_2')).toBe(true)

    const ddl = executed.map(q => q.sql)
    expect(ddl[0]).toBe('CREATE SCHEMA IF NOT EXISTS "tenant_2"')
    expect(ddl).toContain('CREATE TABLE "tenant_2"."users" (LIKE "template"."users" INCLUDING ALL)')
    expect(ddl).toContain('CREATE TABLE "tenant_2"."posts" (LIKE "template"."posts" INCLUDING ALL)')
    expect(ddl.some(s => s.startsWith('INSERT INTO'))).toBe(false)
  })

  it('copies rows when includeData is set and honors excludeTables', async () => {
    const { db, executed } = createFakeDb('postgres', query =>
      query.sql.startsWith('select') ? [{ table_name: 'users' }, { table_name: 'audit_log' }] : []
    )

    await adapter.cloneSchema(db, 'template', 'tenant_2', {
      includeData: true,
      excludeTables: ['audit_log']
    })

    const ddl = executed.map(q => q.sql)
    expect(ddl).toContain('INSERT INTO "tenant_2"."users" SELECT * FROM "template"."users"')
    expect(ddl.some(s => s.includes('audit_log'))).toBe(false)
  })

  it('logs and rethrows when cloning fails', async () => {
    const { logger, entries } = createCapturingLogger()
    const withLogger = new PostgresAdapter({ logger })
    const { db } = createFakeDb('postgres', query => {
      if (query.sql.startsWith('select')) return [{ table_name: 'users' }]
      if (query.sql.startsWith('CREATE TABLE')) throw new Error('out of disk')
      return []
    })

    await expect(withLogger.cloneSchema(db, 'template', 'tenant_2')).rejects.toThrow('out of disk')
    expect(entries.some(e => e.level === 'error' && e.message.includes('clone'))).toBe(true)
  })

  it('compareSchemas partitions tables into first/second/both, sorted', async () => {
    const { db } = createFakeDb('postgres', query => {
      const schema = query.parameters[0]
      if (schema === 'alpha') {
        return [{ table_name: 'users' }, { table_name: 'archived' }, { table_name: 'posts' }]
      }
      return [{ table_name: 'posts' }, { table_name: 'users' }, { table_name: 'settings' }]
    })

    expect(await adapter.compareSchemas(db, 'alpha', 'beta')).toEqual({
      onlyInFirst: ['archived'],
      onlyInSecond: ['settings'],
      inBoth: ['posts', 'users']
    })
  })
})
