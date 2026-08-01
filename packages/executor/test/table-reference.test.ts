/**
 * Table reference parsing and aliased/array interception.
 *
 * Regression tests for the alias data-leak: plugins receive the BASE table
 * name (so allowlists match) plus the alias (so column qualification stays
 * valid SQL once the table is aliased).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated, type SelectQueryBuilder } from 'kysely'
import Database from 'better-sqlite3'
import {
  createExecutor,
  parseTableReference,
  type Plugin,
  type QueryBuilderContext
} from '../src/index.js'

interface TestDB {
  users: { id: Generated<number>; name: string; deleted_at: string | null }
  posts: { id: Generated<number>; user_id: number }
}

type AnySelect = SelectQueryBuilder<Record<string, Record<string, unknown>>, string, Record<string, unknown>>

describe('parseTableReference', () => {
  it('parses a plain table name', () => {
    expect(parseTableReference('users')).toEqual({ table: 'users' })
  })

  it('parses an aliased table', () => {
    expect(parseTableReference('users as u')).toEqual({ table: 'users', alias: 'u' })
  })

  it('parses a schema-qualified table', () => {
    expect(parseTableReference('auth.users')).toEqual({ table: 'users', schema: 'auth' })
  })

  it('parses schema + alias', () => {
    expect(parseTableReference('auth.users as u')).toEqual({
      table: 'users',
      schema: 'auth',
      alias: 'u'
    })
  })

  it('mirrors kysely: only lowercase " as " is the alias separator', () => {
    // kysely's parseAliasedTable splits on the literal ' as ' — uppercase AS
    // is treated as part of the table name, exactly like kysely does
    expect(parseTableReference('users AS u')).toEqual({ table: 'users AS u' })
  })

  it('trims whitespace like kysely does', () => {
    expect(parseTableReference('users  as  u')).toEqual({ table: 'users', alias: 'u' })
  })
})

describe('aliased and array table interception', () => {
  let db: Kysely<TestDB>
  let seenContexts: QueryBuilderContext[]

  const recordingPlugin = (): Plugin => ({
    name: 'recorder',
    version: '1.0.0',
    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      seenContexts.push(context)
      return qb
    }
  })

  const filterUsers = (): Plugin => ({
    name: 'filter-users',
    version: '1.0.0',
    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      if (context.operation === 'select' && context.table === 'users') {
        const reference = context.alias ?? context.table
        return (qb as unknown as AnySelect).where(
          `${reference}.deleted_at`,
          'is',
          null
        ) as QB
      }
      return qb
    }
  })

  beforeEach(async () => {
    seenContexts = []
    db = new Kysely<TestDB>({
      dialect: new SqliteDialect({ database: new Database(':memory:') })
    })
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
      .addColumn('name', 'text')
      .addColumn('deleted_at', 'text')
      .execute()
    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', c => c.primaryKey().autoIncrement())
      .addColumn('user_id', 'integer')
      .execute()
    await db
      .insertInto('users')
      .values([
        { name: 'alice', deleted_at: null },
        { name: 'bob', deleted_at: '2024-01-01' }
      ])
      .execute()
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('plugin context contains base table, alias, and raw expression', async () => {
    const executor = await createExecutor(db, [recordingPlugin()])
    await executor.selectFrom('users as u').select('u.id').execute()

    expect(seenContexts).toHaveLength(1)
    expect(seenContexts[0]).toMatchObject({
      operation: 'select',
      table: 'users',
      alias: 'u',
      tableExpression: 'users as u'
    })
  })

  it('explicit schema qualifier is exposed via context.schema', async () => {
    const executor = await createExecutor(db, [recordingPlugin()])
    // 'main' is sqlite's built-in schema
    await executor.selectFrom('main.users' as never).selectAll().execute()

    expect(seenContexts[0]).toMatchObject({
      table: 'users',
      schema: 'main',
      tableExpression: 'main.users'
    })
  })

  it('aliased select applies filter with valid alias-qualified SQL', async () => {
    const executor = await createExecutor(db, [filterUsers()])
    const rows = await executor.selectFrom('users as u').selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('alice')
  })

  it('array (cross join) form applies plugins once per table entry', async () => {
    const executor = await createExecutor(db, [recordingPlugin(), filterUsers()])
    const rows = await executor
      .selectFrom(['users as u', 'posts'])
      .select('u.id')
      .execute()

    // recorder saw both table entries
    const tables = seenContexts.map(c => `${c.table}${c.alias ? `:${c.alias}` : ''}`)
    expect(tables).toEqual(['users:u', 'posts'])
    // filter applied to the users entry (bob excluded → alice × 0 posts = 0 rows)
    expect(rows).toHaveLength(0)
  })

  it('subquery table argument passes through without interception', async () => {
    const executor = await createExecutor(db, [recordingPlugin()])
    const sub = db.selectFrom('users').select(['id', 'name']).as('u')
    const rows = await executor.selectFrom(sub).selectAll().execute()

    // No string table — plugins are not invoked, query still works
    expect(seenContexts).toHaveLength(0)
    expect(rows).toHaveLength(2)
  })

  it('update/delete on aliased tables keep base-name matching', async () => {
    const executor = await createExecutor(db, [recordingPlugin()])
    await executor
      .updateTable('users as u')
      .set({ name: 'updated' })
      .where('u.id', '=', 1)
      .execute()

    expect(seenContexts[0]).toMatchObject({ operation: 'update', table: 'users', alias: 'u' })
  })
})
