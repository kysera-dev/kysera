import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { spinner } from '../../utils/spinner.js'
import { logger } from '../../utils/logger.js'
import { diag, isJsonMode, output } from '../../utils/output.js'
import { CLIError } from '../../utils/errors.js'
import { withDatabase } from '../../utils/with-database.js'
import { DatabaseIntrospector, type IntrospectorDialect, type TableInfo } from './introspector.js'
import { KyselyTypeMapper } from './type-mapper.js'
import { buildTableFilter, internalTables } from './table-filter.js'

export interface DatabaseTypesOptions {
  output?: string
  config?: string
  schema?: string
  include?: string
  exclude?: string
  withHelpers?: boolean
  watch?: boolean
  pollInterval?: string
  json?: boolean
}

interface GenerationSummary {
  file: string
  tables: string[]
  written: boolean
}

const DEFAULT_OUTPUT = './src/db/schema.ts'
const DEFAULT_POLL_INTERVAL_SECONDS = 2

export function databaseCommand(): Command {
  const cmd = new Command('database')
    .alias('db-types')
    .description(
      'Generate a single Kysely schema file (table interfaces + Database) from the connected database'
    )
    .option('-o, --output <path>', 'Output file', DEFAULT_OUTPUT)
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-s, --schema <name>', 'PostgreSQL schema name (default: public)')
    .option(
      '--include <patterns>',
      'Comma-separated table globs to include (also re-includes internal tables)'
    )
    .option('--exclude <patterns>', 'Comma-separated table globs to exclude (wins over include)')
    .option('--with-helpers', 'Emit Selectable/Insertable/Updateable aliases per table', false)
    .option(
      '--watch',
      'Keep running: poll the schema and regenerate when it changes (Ctrl+C to stop)'
    )
    .option(
      '--poll-interval <seconds>',
      'Schema poll interval used by --watch',
      String(DEFAULT_POLL_INTERVAL_SECONDS)
    )
    .option('--json', 'Output a {file, tables, written} summary as JSON (one line per --watch run)')
    .action(async (options: DatabaseTypesOptions) => {
      try {
        await generateDatabaseTypes(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to generate database types: ${error instanceof Error ? error.message : String(error)}`,
          'GENERATE_DATABASE_ERROR'
        )
      }
    })

  return cmd
}

async function generateDatabaseTypes(options: DatabaseTypesOptions): Promise<void> {
  const pollIntervalMs = parsePollInterval(options.pollInterval)

  await withDatabase(
    { config: options.config, schema: options.schema },
    async (db, config, schema) => {
      const dialect = config.database.dialect
      const introspector = new DatabaseIntrospector(db, dialect, schema)
      const filter = buildTableFilter({
        include: options.include,
        exclude: options.exclude,
        internal: internalTables(config)
      })
      const outputPath = resolve(options.output ?? DEFAULT_OUTPUT)
      const header = reconstructCommand(options)

      const generateOnce = async (): Promise<{ content: string; tables: string[] }> => {
        const allTables = await introspector.getTables()
        const selected = allTables.filter(filter)
        const tables: TableInfo[] = []
        for (const table of selected) {
          tables.push(await introspector.getTableInfo(table))
        }
        const content = renderDatabaseSchema(tables, {
          dialect,
          withHelpers: options.withHelpers === true,
          command: header
        })
        return { content, tables: tables.map(table => table.name).sort(compareNames) }
      }

      const writeIfChanged = (content: string): boolean => {
        const existing = existsSync(outputPath) ? readFileSync(outputPath, 'utf-8') : undefined
        if (existing === content) {
          return false
        }
        mkdirSync(dirname(outputPath), { recursive: true })
        writeFileSync(outputPath, content, 'utf-8')
        return true
      }

      const jsonMode = options.json === true || isJsonMode()

      if (options.watch !== true) {
        const generateSpinner = spinner()
        generateSpinner.start(
          `Introspecting database${schema !== 'public' ? ` (schema: ${schema})` : ''}...`
        )
        let result: { content: string; tables: string[] }
        try {
          result = await generateOnce()
        } catch (error) {
          generateSpinner.fail('Introspection failed')
          throw error
        }
        generateSpinner.succeed(
          `Found ${result.tables.length} table${result.tables.length !== 1 ? 's' : ''}`
        )

        const written = writeIfChanged(result.content)
        const summary: GenerationSummary = { file: outputPath, tables: result.tables, written }

        if (jsonMode) {
          output(summary, { format: 'json' })
          return
        }
        reportHuman(summary)
        return
      }

      // Watch mode: poll the schema and regenerate whenever the rendered
      // output changes. The rendered file doubles as the schema hash —
      // introspection results are deterministic, so identical schemas
      // always render to identical content.
      diag(`Watching schema (poll every ${pollIntervalMs / 1000}s) — press Ctrl+C to stop`)

      let timer: NodeJS.Timeout | undefined
      const stopPromise = new Promise<'stop'>(resolveStop => {
        process.once('SIGINT', () => {
          resolveStop('stop')
        })
      })
      const sleep = (): Promise<'tick'> =>
        new Promise<'tick'>(resolveSleep => {
          timer = setTimeout(() => {
            resolveSleep('tick')
          }, pollIntervalMs)
        })

      let lastContent: string | undefined
      for (;;) {
        try {
          const { content, tables } = await generateOnce()
          if (content !== lastContent) {
            const written = writeIfChanged(content)
            lastContent = content
            const summary: GenerationSummary = { file: outputPath, tables, written }
            if (jsonMode) {
              // One compact JSON line per regeneration so the stream stays
              // machine-parseable.
              process.stdout.write(`${JSON.stringify(summary)}\n`)
            } else {
              reportHuman(summary)
            }
          }
        } catch (error) {
          // Keep watching through transient failures (connection loss,
          // mid-migration states); the next poll retries.
          diag(`Introspection failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        const wake = await Promise.race([sleep(), stopPromise])
        if (wake === 'stop') {
          break
        }
      }
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      diag('Watch stopped')
    }
  )
}

function reportHuman(summary: GenerationSummary): void {
  const location = prism.cyan(relative(process.cwd(), summary.file))
  const tables = `${summary.tables.length} table${summary.tables.length !== 1 ? 's' : ''}`
  if (summary.written) {
    logger.info(`${prism.green('OK')} Generated ${location} (${tables})`)
  } else {
    logger.info(`${prism.green('OK')} ${location} already up to date (${tables})`)
  }
}

function parsePollInterval(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_POLL_INTERVAL_SECONDS * 1000
  }
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new CLIError(`Invalid --poll-interval: ${value}`, 'VALIDATION_ERROR', undefined, [
      'Pass a positive number of seconds, e.g. --poll-interval 5'
    ])
  }
  return seconds * 1000
}

/**
 * The command line to embed in the generated header. Only schema-affecting
 * flags are included so reruns with cosmetic flags (--json, --watch) do not
 * change the file.
 */
function reconstructCommand(options: DatabaseTypesOptions): string {
  const parts = ['kysera generate database']
  parts.push('-o', options.output ?? DEFAULT_OUTPUT)
  if (options.schema !== undefined) parts.push('-s', options.schema)
  if (options.include !== undefined) parts.push('--include', options.include)
  if (options.exclude !== undefined) parts.push('--exclude', options.exclude)
  if (options.withHelpers === true) parts.push('--with-helpers')
  return parts.join(' ')
}

export interface RenderDatabaseSchemaOptions {
  dialect: IntrospectorDialect
  withHelpers: boolean
  /** Command line shown in the generated header. */
  command: string
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function propertyKey(name: string): string {
  return IDENTIFIER_RE.test(name) ? name : `'${name.replace(/'/g, "\\'")}'`
}

/**
 * PascalCase identifier from a table name; any non-alphanumeric character
 * acts as a word separator so quoted table names ('user-things') still
 * yield valid interface names.
 */
function pascalName(name: string): string {
  const pascal = name
    .split(/[^A-Za-z0-9]+/u)
    .filter(part => part !== '')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  if (pascal === '') return 'Table'
  return /^[0-9]/.test(pascal) ? `T${pascal}` : pascal
}

/** Deterministic, locale-independent name ordering. */
function compareNames(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Render the complete schema file: helper aliases, one interface per table
 * (columns in database order), the aggregated `Database` interface and —
 * optionally — Selectable/Insertable/Updateable aliases per table.
 *
 * Output is deterministic for a given schema: tables are sorted by name and
 * no timestamps are embedded, so regenerated files diff cleanly.
 */
export function renderDatabaseSchema(
  tables: TableInfo[],
  options: RenderDatabaseSchemaOptions
): string {
  const mapper = new KyselyTypeMapper(options.dialect)
  const sorted = [...tables].sort((a, b) => compareNames(a.name, b.name))

  // Assign unique interface names (snake_case tables can collide after
  // PascalCase conversion).
  const interfaceNames = new Map<string, string>()
  const taken = new Set<string>()
  for (const table of sorted) {
    const base = pascalName(table.name)
    let name = `${base}Table`
    let suffix = 2
    while (taken.has(name)) {
      name = `${base}${suffix}Table`
      suffix += 1
    }
    taken.add(name)
    interfaceNames.set(table.name, name)
  }

  const tableBlocks: string[] = []
  for (const table of sorted) {
    const lines = [`export interface ${interfaceNames.get(table.name) ?? ''} {`]
    for (const column of table.columns) {
      lines.push(`  ${propertyKey(column.name)}: ${mapper.columnType(column)}`)
    }
    lines.push('}')
    tableBlocks.push(lines.join('\n'))
  }

  const databaseLines = ['export interface Database {']
  for (const table of sorted) {
    databaseLines.push(`  ${propertyKey(table.name)}: ${interfaceNames.get(table.name) ?? ''}`)
  }
  databaseLines.push('}')

  const helperBlocks: string[] = []
  if (options.withHelpers) {
    for (const table of sorted) {
      const tableInterface = interfaceNames.get(table.name) ?? ''
      const entity = tableInterface.replace(/Table$/, '')
      helperBlocks.push(
        [
          `export type ${entity} = Selectable<${tableInterface}>`,
          `export type New${entity} = Insertable<${tableInterface}>`,
          `export type ${entity}Update = Updateable<${tableInterface}>`
        ].join('\n')
      )
    }
  }

  const kyselyImports: string[] = []
  if (mapper.needsColumnType) kyselyImports.push('ColumnType')
  if (mapper.needsGenerated) kyselyImports.push('Generated')
  if (options.withHelpers) kyselyImports.push('Insertable', 'Selectable', 'Updateable')

  const sections: string[] = []
  sections.push(
    [
      '/**',
      ' * Kysely database schema types.',
      ' *',
      ` * Generated by \`${options.command}\`.`,
      ' * Do not edit this file manually — rerun the command to refresh it.',
      ' *',
      ` * Dialect: ${options.dialect}`,
      ' */'
    ].join('\n')
  )
  if (kyselyImports.length > 0) {
    sections.push(`import type { ${kyselyImports.join(', ')} } from 'kysely'`)
  }
  const helperDeclarations = mapper.helperDeclarations()
  if (helperDeclarations.length > 0) {
    sections.push(helperDeclarations.join('\n'))
  }
  sections.push(...tableBlocks)
  sections.push(databaseLines.join('\n'))
  sections.push(...helperBlocks)

  return `${sections.join('\n\n')}\n`
}
