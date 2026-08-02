import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// Mock dependencies
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn()
}))

vi.mock('@xec-sh/kit', () => ({
  log: {
    message: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    warn: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  },
  prism: {
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    gray: (s: string) => s,
    blue: (s: string) => s,
    red: (s: string) => s,
    bold: (s: string) => s
  },
  strip: (s: string) => s,
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    message: vi.fn(),
    text: '',
    isCancelled: false
  })),
  confirm: vi.fn(() => Promise.resolve(true))
}))

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    message: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('../../../src/config/loader.js', () => ({
  loadConfig: vi.fn()
}))

vi.mock('../../../src/utils/database.js', () => ({
  getDatabaseConnection: vi.fn()
}))

vi.mock('../../../src/commands/generate/introspector.js', async () => {
  const mockConstructor: any = vi.fn().mockImplementation(function (this: any) {
    this.getTables = vi.fn()
    this.getTableInfo = vi.fn()
    this.introspect = vi.fn()
    return this
  })
  return { DatabaseIntrospector: mockConstructor }
})

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { loadConfig } from '../../../src/config/loader.js'
import { getDatabaseConnection } from '../../../src/utils/database.js'
import { DatabaseIntrospector } from '../../../src/commands/generate/introspector.js'
import type { TableColumn, TableInfo } from '../../../src/commands/generate/introspector.js'
import { databaseCommand, renderDatabaseSchema } from '../../../src/commands/generate/database.js'
import { KyselyTypeMapper } from '../../../src/commands/generate/type-mapper.js'
import {
  buildTableFilter,
  globToRegExp,
  internalTables
} from '../../../src/commands/generate/table-filter.js'

function col(name: string, dataType: string, extra: Partial<TableColumn> = {}): TableColumn {
  return {
    name,
    dataType,
    isNullable: false,
    isPrimaryKey: false,
    isForeignKey: false,
    isAutoIncrement: false,
    ...extra
  }
}

function table(name: string, columns: TableColumn[]): TableInfo {
  return { name, columns, indexes: [] }
}

const pgUsers = table('users', [
  col('id', 'integer', {
    isPrimaryKey: true,
    isAutoIncrement: true,
    defaultValue: "nextval('users_id_seq'::regclass)"
  }),
  col('email', 'character varying', { maxLength: 255 }),
  col('bio', 'text', { isNullable: true }),
  col('balance', 'numeric'),
  col('views', 'bigint'),
  col('settings', 'jsonb', { isNullable: true }),
  col('tags', 'ARRAY', { udtName: '_text' }),
  col('created_at', 'timestamp with time zone', { defaultValue: 'now()' })
])

const pgPosts = table('posts', [
  col('id', 'integer', { isPrimaryKey: true, isAutoIncrement: true }),
  col('user_id', 'integer', { isForeignKey: true, referencedTable: 'users' }),
  col('title', 'text')
])

const sqliteUsers = table('users', [
  col('id', 'INTEGER', { isPrimaryKey: true, isAutoIncrement: true }),
  col('email', 'TEXT'),
  col('name', 'TEXT', { isNullable: true }),
  col('settings', 'JSON', { isNullable: true }),
  col('created_at', 'TIMESTAMP', { defaultValue: 'CURRENT_TIMESTAMP' })
])

const renderOptions = {
  dialect: 'postgres' as const,
  withHelpers: false,
  command: 'kysera generate database -o ./src/db/schema.ts'
}

describe('renderDatabaseSchema', () => {
  it('emits a real Database interface (not a comment)', () => {
    const out = renderDatabaseSchema([pgUsers, pgPosts], renderOptions)

    expect(out).toContain('export interface Database {')
    expect(out).toContain('  users: UsersTable')
    expect(out).toContain('  posts: PostsTable')
    expect(out).not.toContain('// Add this to your Database interface')
  })

  it('wraps auto-increment and defaulted columns in Generated', () => {
    const out = renderDatabaseSchema([pgUsers], renderOptions)

    expect(out).toContain('id: Generated<number>')
    expect(out).toContain('created_at: Generated<Timestamp>')
    expect(out).not.toContain('id: number | null')
  })

  it('maps postgres driver realities: bigint/numeric/json/timestamp/arrays', () => {
    const out = renderDatabaseSchema([pgUsers], renderOptions)

    expect(out).toContain('views: Int8')
    expect(out).toContain('balance: Numeric')
    expect(out).toContain('settings: Json | null')
    expect(out).toContain('tags: string[]')
    expect(out).toContain(
      'export type Int8 = ColumnType<string, string | number | bigint, string | number | bigint>'
    )
    expect(out).toContain(
      'export type Numeric = ColumnType<string, number | string, number | string>'
    )
    expect(out).toContain('export type Json = ColumnType<JsonValue, string, string>')
    expect(out).toContain('export type JsonValue = JsonArray | JsonObject | JsonPrimitive')
    expect(out).toContain('export type Timestamp = ColumnType<Date, Date | string, Date | string>')
    expect(out).toContain("import type { ColumnType, Generated } from 'kysely'")
  })

  it('emits nullable columns as T | null', () => {
    const out = renderDatabaseSchema([pgUsers], renderOptions)
    expect(out).toContain('bio: string | null')
  })

  it('is deterministic regardless of input table order', () => {
    const a = renderDatabaseSchema([pgUsers, pgPosts], renderOptions)
    const b = renderDatabaseSchema([pgPosts, pgUsers], renderOptions)
    expect(a).toBe(b)
    expect(a.indexOf('PostsTable')).toBeLessThan(a.indexOf('UsersTable'))
  })

  it('contains the generation command and dialect in the header, no timestamp', () => {
    const out = renderDatabaseSchema([pgUsers], renderOptions)
    expect(out).toContain('Generated by `kysera generate database -o ./src/db/schema.ts`')
    expect(out).toContain('Dialect: postgres')
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('emits Selectable/Insertable/Updateable aliases with --with-helpers', () => {
    const out = renderDatabaseSchema([pgUsers], { ...renderOptions, withHelpers: true })

    expect(out).toContain(
      "import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'"
    )
    expect(out).toContain('export type Users = Selectable<UsersTable>')
    expect(out).toContain('export type NewUsers = Insertable<UsersTable>')
    expect(out).toContain('export type UsersUpdate = Updateable<UsersTable>')
  })

  it('maps sqlite json/bool/date columns to driver realities and skips unused aliases', () => {
    const out = renderDatabaseSchema([sqliteUsers], { ...renderOptions, dialect: 'sqlite' })

    expect(out).toContain('settings: string | null')
    expect(out).toContain('created_at: Generated<string>')
    expect(out).toContain("import type { Generated } from 'kysely'")
    expect(out).not.toContain('ColumnType')
    expect(out).not.toContain('JsonValue')
  })

  it('maps mysql datetime to Date and json to Json', () => {
    const events = table('events', [
      col('id', 'bigint', { isPrimaryKey: true, isAutoIncrement: true }),
      col('payload', 'json'),
      col('happened_at', 'datetime')
    ])
    const out = renderDatabaseSchema([events], { ...renderOptions, dialect: 'mysql' })

    expect(out).toContain('id: Generated<number>')
    expect(out).toContain('payload: Json')
    expect(out).toContain('happened_at: Date')
  })

  it('quotes non-identifier table and column names', () => {
    const odd = table('user-things', [col('full name', 'text')])
    const out = renderDatabaseSchema([odd], renderOptions)

    expect(out).toContain('export interface UserThingsTable {')
    expect(out).toContain("  'full name': string")
    expect(out).toContain("  'user-things': UserThingsTable")
  })

  it('deduplicates colliding interface names', () => {
    const a = table('user_things', [col('id', 'integer')])
    const b = table('userThings', [col('id', 'integer')])
    const out = renderDatabaseSchema([a, b], renderOptions)

    expect(out).toContain('export interface UserThingsTable {')
    expect(out).toContain('export interface UserThings2Table {')
  })

  it('renders an empty schema without imports', () => {
    const out = renderDatabaseSchema([], renderOptions)
    expect(out).toContain('export interface Database {')
    expect(out).not.toContain("from 'kysely'")
  })
})

describe('KyselyTypeMapper', () => {
  it('wraps nullable defaulted columns as Generated<T | null>', () => {
    const mapper = new KyselyTypeMapper('postgres')
    const type = mapper.columnType(col('note', 'text', { isNullable: true, defaultValue: "''" }))
    expect(type).toBe('Generated<string | null>')
  })

  it('maps postgres arrays via udt element type', () => {
    const mapper = new KyselyTypeMapper('postgres')
    expect(mapper.scalarType(col('a', 'ARRAY', { udtName: '_int4' }))).toBe('number[]')
    expect(mapper.scalarType(col('b', 'ARRAY', { udtName: '_mystery' }))).toBe('unknown[]')
  })

  it('maps USER-DEFINED (enums) to string', () => {
    const mapper = new KyselyTypeMapper('postgres')
    expect(mapper.scalarType(col('status', 'USER-DEFINED', { udtName: 'order_status' }))).toBe(
      'string'
    )
  })

  it('resolves sqlite declared types via affinity', () => {
    const mapper = new KyselyTypeMapper('sqlite')
    expect(mapper.scalarType(col('a', 'VARCHAR(255)'))).toBe('string')
    expect(mapper.scalarType(col('b', 'BOOLEAN'))).toBe('number')
    expect(mapper.scalarType(col('c', 'DATETIME'))).toBe('string')
    expect(mapper.scalarType(col('d', 'BLOB'))).toBe('Buffer')
    expect(mapper.scalarType(col('e', 'BIGINT'))).toBe('number')
  })

  it('tracks which helpers and imports are needed', () => {
    const mapper = new KyselyTypeMapper('postgres')
    expect(mapper.needsColumnType).toBe(false)
    expect(mapper.needsGenerated).toBe(false)

    mapper.columnType(col('id', 'integer', { isAutoIncrement: true }))
    expect(mapper.needsGenerated).toBe(true)
    expect(mapper.needsColumnType).toBe(false)

    mapper.columnType(col('amount', 'numeric'))
    expect(mapper.needsColumnType).toBe(true)
    expect(mapper.helperDeclarations().join('\n')).toContain('export type Numeric')
  })
})

describe('table filtering', () => {
  it('derives internal tables from config', () => {
    expect(internalTables({})).toContain('migrations')
    expect(internalTables({})).toContain('kysera_migration_lock')
    expect(internalTables({ migrations: { tableName: 'schema_history' } })).toContain(
      'schema_history'
    )
  })

  it('excludes internal tables by default', () => {
    const filter = buildTableFilter({ internal: ['migrations', 'kysera_migration_lock'] })
    expect(filter('users')).toBe(true)
    expect(filter('migrations')).toBe(false)
    expect(filter('kysera_migration_lock')).toBe(false)
  })

  it('narrows to include patterns and re-includes internal tables', () => {
    const filter = buildTableFilter({ include: 'user*,migrations', internal: ['migrations'] })
    expect(filter('users')).toBe(true)
    expect(filter('user_roles')).toBe(true)
    expect(filter('posts')).toBe(false)
    expect(filter('migrations')).toBe(true)
  })

  it('lets exclude win over include', () => {
    const filter = buildTableFilter({ include: 'user*', exclude: 'user_secrets', internal: [] })
    expect(filter('users')).toBe(true)
    expect(filter('user_secrets')).toBe(false)
  })

  it('supports ? and * globs', () => {
    expect(globToRegExp('user?').test('users')).toBe(true)
    expect(globToRegExp('user?').test('user')).toBe(false)
    expect(globToRegExp('audit.*').test('auditXlog')).toBe(false)
    expect(globToRegExp('audit.*').test('audit.log')).toBe(true)
  })
})

describe('generate database command', () => {
  let mockIntrospector: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockIntrospector = {
      getTables: vi.fn().mockResolvedValue(['kysera_migration_lock', 'migrations', 'users']),
      getTableInfo: vi.fn().mockResolvedValue(sqliteUsers),
      introspect: vi.fn()
    }
    ;(DatabaseIntrospector as Mock).mockImplementation(function (this: any) {
      Object.assign(this, mockIntrospector)
      return this
    })
    ;(existsSync as Mock).mockReturnValue(false)
    ;(readFileSync as Mock).mockReturnValue('')
    ;(loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'sqlite', database: './app.db' }
    })
    ;(getDatabaseConnection as Mock).mockResolvedValue({ destroy: vi.fn() })
  })

  describe('command configuration', () => {
    it('is named database with db-types alias', () => {
      const command = databaseCommand()
      expect(command.name()).toBe('database')
      expect(command.aliases()).toContain('db-types')
    })

    it('defaults output to ./src/db/schema.ts', () => {
      const command = databaseCommand()
      const opt = command.options.find(o => o.long === '--output')
      expect(opt?.defaultValue).toBe('./src/db/schema.ts')
    })

    it('exposes include/exclude/helpers/watch/poll-interval/json flags', () => {
      const command = databaseCommand()
      const longs = command.options.map(o => o.long)
      expect(longs).toEqual(
        expect.arrayContaining([
          '--include',
          '--exclude',
          '--with-helpers',
          '--watch',
          '--poll-interval',
          '--json'
        ])
      )
      expect(command.options.find(o => o.long === '--poll-interval')?.defaultValue).toBe('2')
    })
  })

  describe('generation', () => {
    it('writes one schema file with the Database interface', async () => {
      await databaseCommand().parseAsync(['node', 'test'])

      expect(writeFileSync).toHaveBeenCalledTimes(1)
      const [path, content] = (writeFileSync as Mock).mock.calls[0]
      expect(String(path)).toContain('schema.ts')
      expect(content).toContain('export interface UsersTable {')
      expect(content).toContain('id: Generated<number>')
      expect(content).toContain('export interface Database {')
      expect(content).toContain('users: UsersTable')
    })

    it('skips internal tables by default', async () => {
      await databaseCommand().parseAsync(['node', 'test'])

      expect(mockIntrospector.getTableInfo).toHaveBeenCalledWith('users')
      expect(mockIntrospector.getTableInfo).not.toHaveBeenCalledWith('migrations')
      expect(mockIntrospector.getTableInfo).not.toHaveBeenCalledWith('kysera_migration_lock')
    })

    it('applies --exclude globs', async () => {
      mockIntrospector.getTables.mockResolvedValue(['posts', 'users'])

      await databaseCommand().parseAsync(['node', 'test', '--exclude', 'post*'])

      expect(mockIntrospector.getTableInfo).toHaveBeenCalledWith('users')
      expect(mockIntrospector.getTableInfo).not.toHaveBeenCalledWith('posts')
    })

    it('applies --include globs and re-includes internal tables', async () => {
      mockIntrospector.getTables.mockResolvedValue(['migrations', 'posts', 'users'])

      await databaseCommand().parseAsync(['node', 'test', '--include', 'users,migrations'])

      expect(mockIntrospector.getTableInfo).toHaveBeenCalledWith('users')
      expect(mockIntrospector.getTableInfo).toHaveBeenCalledWith('migrations')
      expect(mockIntrospector.getTableInfo).not.toHaveBeenCalledWith('posts')
    })

    it('does not rewrite an unchanged file', async () => {
      await databaseCommand().parseAsync(['node', 'test'])
      const [, content] = (writeFileSync as Mock).mock.calls[0]

      ;(existsSync as Mock).mockReturnValue(true)
      ;(readFileSync as Mock).mockReturnValue(content)

      await databaseCommand().parseAsync(['node', 'test'])
      expect(writeFileSync).toHaveBeenCalledTimes(1)
    })

    it('emits a {file, tables, written} summary with --json', async () => {
      const writes: string[] = []
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: unknown): boolean => {
          writes.push(String(chunk))
          return true
        })

      try {
        await databaseCommand().parseAsync(['node', 'test', '--json'])
      } finally {
        stdoutSpy.mockRestore()
      }

      const summary = JSON.parse(writes.join(''))
      expect(summary.file).toContain('schema.ts')
      expect(summary.tables).toEqual(['users'])
      expect(summary.written).toBe(true)
    })

    it('respects -o output path', async () => {
      await databaseCommand().parseAsync(['node', 'test', '-o', './types/db.ts'])
      const [path] = (writeFileSync as Mock).mock.calls[0]
      expect(String(path)).toMatch(/types\/db\.ts$/)
    })

    it('rejects an invalid --poll-interval', async () => {
      await expect(
        databaseCommand().parseAsync(['node', 'test', '--poll-interval', 'abc'])
      ).rejects.toThrow(/poll-interval/)
    })

    it('closes the database connection', async () => {
      const destroy = vi.fn()
      ;(getDatabaseConnection as Mock).mockResolvedValue({ destroy })

      await databaseCommand().parseAsync(['node', 'test'])
      expect(destroy).toHaveBeenCalled()
    })
  })
})
