import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { loadConfig } from '../../config/loader.js'
import { CLIError } from '../../utils/errors.js'
import { isDryRun } from '../../utils/global-options.js'
import { diag, output } from '../../utils/output.js'

export interface AuditInitOptions {
  table?: string
  dialectDdl?: boolean
  dir?: string
  config?: string
  json?: boolean
}

export type AuditDialect = 'postgres' | 'mysql' | 'sqlite'

export function initCommand(): Command {
  const cmd = new Command('init')
    .description('Generate a migration that creates the audit log table')
    .option('--table <name>', "Audit table name (default: from config or 'audit_logs')")
    .option('--dialect-ddl', "Emit dialect-tuned DDL instead of the plugin's portable schema")
    .option('-d, --dir <path>', 'Migrations directory (default: from configuration)')
    .option('-c, --config <path>', 'Path to configuration file')
    .addHelpText(
      'after',
      `
By default the migration matches the portable schema @kysera/audit
auto-creates on first use: TEXT columns everywhere, JSON payloads stored
as serialized text. That works identically on PostgreSQL, MySQL and
SQLite, and is exactly what the plugin expects.

--dialect-ddl trades portability for queryability on the configured
dialect: JSONB + TIMESTAMPTZ + IDENTITY on PostgreSQL, JSON + DATETIME(3)
on MySQL, plus lookup indexes on (table_name, entity_id) and changed_at.
The plugin writes the same values either way (JSON strings and ISO
timestamps are coerced by the database), but the migration is then tied
to that dialect. On SQLite only the indexes are added.
`
    )
    .action(async (options: AuditInitOptions) => {
      try {
        await runAuditInit(options)
      } catch (error) {
        if (error instanceof CLIError) throw error
        throw new CLIError(
          `Failed to generate audit migration: ${error instanceof Error ? error.message : String(error)}`,
          'AUDIT_INIT_ERROR'
        )
      }
    })

  return cmd
}

export async function runAuditInit(options: AuditInitOptions): Promise<void> {
  const config = await loadConfig(options.config)
  const table = options.table ?? config.plugins?.audit?.auditTable ?? 'audit_logs'

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new CLIError(`Unsafe audit table name: '${table}'`, 'VALIDATION_ERROR', undefined, [
      'Use only letters, digits and underscores'
    ])
  }

  const dialect = config.database?.dialect
  let ddlDialect: AuditDialect | null = null
  if (options.dialectDdl === true) {
    if (!dialect) {
      throw new CLIError(
        '--dialect-ddl requires database.dialect in the configuration',
        'CONFIG_ERROR',
        undefined,
        [
          'Set database.dialect (postgres/mysql/sqlite) in your configuration',
          'Or omit --dialect-ddl to generate the portable schema'
        ]
      )
    }
    ddlDialect = dialect
  }

  const content = renderAuditInitMigration(table, ddlDialect)

  const directory = options.dir
    ? resolve(process.cwd(), options.dir)
    : (config.migrations?.directory ?? resolve(process.cwd(), 'migrations'))
  const filename = `${migrationTimestamp()}_create_${table}.ts`
  const filepath = join(directory, filename)

  if (existsSync(filepath)) {
    throw new CLIError(`Migration file already exists: ${filepath}`, 'FILE_EXISTS')
  }

  const mode = ddlDialect ? 'dialect' : 'portable'

  if (isDryRun()) {
    diag(`DRY RUN: not writing ${filepath}`)
    output(
      { file: filepath, table, mode, dialect: dialect ?? null, dryRun: true },
      { text: `DRY RUN: would create ${filename}` }
    )
    return
  }

  mkdirSync(directory, { recursive: true })
  writeFileSync(filepath, content, 'utf8')

  output(
    { file: filepath, table, mode, dialect: dialect ?? null },
    { text: `Migration created: ${filename}\n  ${filepath}` }
  )
  diag(`Run 'kysera migrate up' to create the '${table}' table`)
}

/**
 * Render the audit table migration.
 *
 * With `dialect` null the portable schema is emitted - column for column
 * what @kysera/audit's own table creation runs (integer autoincrement id,
 * TEXT everywhere). With a dialect, types are tuned for that database and
 * lookup indexes are added; the plugin's writes stay compatible.
 */
export function renderAuditInitMigration(table: string, dialect: AuditDialect | null): string {
  const needsSql = dialect === 'mysql'
  const importLine = needsSql
    ? "import { Kysely, sql } from 'kysely'"
    : "import { Kysely } from 'kysely'"

  const header =
    dialect === null
      ? `/**
 * Creates the '${table}' table used by @kysera/audit.
 *
 * Portable schema: identical to what the plugin auto-creates on first
 * use. JSON payloads (old_values/new_values/metadata) are stored as
 * serialized text; changed_at is an ISO-8601 string.
 */`
      : `/**
 * Creates the '${table}' table used by @kysera/audit.
 *
 * Dialect-tuned DDL for ${dialect}. Same columns as the plugin's portable
 * schema; native JSON/timestamp types where the dialect supports them,
 * plus lookup indexes for history/restore queries.
 */`

  const indexes =
    dialect === null
      ? ''
      : `

  await db.schema
    .createIndex('${table}_entity_idx')
    .on('${table}')
    .columns(['table_name', 'entity_id'])
    .execute()

  await db.schema
    .createIndex('${table}_changed_at_idx')
    .on('${table}')
    .column('changed_at')
    .execute()`

  return `${importLine}

${header}
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('${table}')
${auditColumns(dialect)}
    .execute()${indexes}
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('${table}').execute()
}
`
}

function auditColumns(dialect: AuditDialect | null): string {
  if (dialect === 'postgres') {
    return `    .addColumn('id', 'bigint', col => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn('table_name', 'text', col => col.notNull())
    .addColumn('entity_id', 'text', col => col.notNull())
    .addColumn('operation', 'text', col => col.notNull())
    .addColumn('old_values', 'jsonb')
    .addColumn('new_values', 'jsonb')
    .addColumn('changed_by', 'text')
    .addColumn('changed_at', 'timestamptz', col => col.notNull())
    .addColumn('metadata', 'jsonb')`
  }
  if (dialect === 'mysql') {
    return `    .addColumn('id', 'bigint', col => col.primaryKey().autoIncrement())
    .addColumn('table_name', 'varchar(255)', col => col.notNull())
    .addColumn('entity_id', 'varchar(255)', col => col.notNull())
    .addColumn('operation', 'varchar(16)', col => col.notNull())
    .addColumn('old_values', 'json')
    .addColumn('new_values', 'json')
    .addColumn('changed_by', 'varchar(255)')
    .addColumn('changed_at', sql\`datetime(3)\`, col => col.notNull())
    .addColumn('metadata', 'json')`
  }
  // Portable (matches @kysera/audit's createAuditTable) - also the base
  // for SQLite, where TEXT is the native representation anyway.
  return `    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    .addColumn('table_name', 'text', col => col.notNull())
    .addColumn('entity_id', 'text', col => col.notNull())
    .addColumn('operation', 'text', col => col.notNull())
    .addColumn('old_values', 'text')
    .addColumn('new_values', 'text')
    .addColumn('changed_by', 'text')
    .addColumn('changed_at', 'text', col => col.notNull())
    .addColumn('metadata', 'text')`
}

/** Local-time YYYYMMDDHHMMSS, matching 'kysera migrate create' filenames. */
function migrationTimestamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}
