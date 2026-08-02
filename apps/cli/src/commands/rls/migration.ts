import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { loadConfig } from '../../config/loader.js'
import { CLIError } from '../../utils/errors.js'
import { isDryRun } from '../../utils/global-options.js'
import { diag, output } from '../../utils/output.js'
import { loadRLSSchemaModule, requirePostgresDialect } from './schema-loader.js'

export interface RlsMigrationOptions {
  dir?: string
  name?: string
  schema?: string
  policyPrefix?: string
  force?: boolean
  functions?: boolean
  config?: string
  json?: boolean
}

export function migrationCommand(): Command {
  const cmd = new Command('migration')
    .description('Generate a Kysely migration file applying native PostgreSQL RLS policies')
    .argument('<schema-module>', 'Path to a module exporting a defineRLSSchema(...) result')
    .option('-d, --dir <path>', 'Migrations directory (default: from configuration)')
    .option('-n, --name <name>', 'Migration name', 'rls_policies')
    .option('-s, --schema <name>', 'PostgreSQL schema name', 'public')
    .option('--policy-prefix <prefix>', 'Prefix for generated policy names', 'rls')
    .option('--no-force', 'Skip FORCE ROW LEVEL SECURITY (table owners bypass RLS)')
    .option('--no-functions', 'Omit the RLS context helper functions from the migration')
    .option('-c, --config <path>', 'Path to configuration file')
    .addHelpText(
      'after',
      `
Writes <timestamp>_rls_policies.ts into the configured migrations
directory. The migration's up() enables row security and creates the
policies; down() drops them again. See 'kysera rls generate --help' for
the expected schema module shape.
`
    )
    .action(async (schemaModule: string, options: RlsMigrationOptions) => {
      try {
        await generateRlsMigration(schemaModule, options)
      } catch (error) {
        if (error instanceof CLIError) throw error
        throw new CLIError(
          `RLS migration generation failed: ${error instanceof Error ? error.message : String(error)}`,
          'RLS_MIGRATION_ERROR'
        )
      }
    })

  return cmd
}

export async function generateRlsMigration(
  schemaModule: string,
  options: RlsMigrationOptions
): Promise<void> {
  const config = await loadConfig(options.config)
  requirePostgresDialect(config)

  const rlsSchema = await loadRLSSchemaModule(schemaModule)

  const { RLSMigrationGenerator } = await import('@kysera/rls/native')
  const name = sanitizeMigrationName(options.name ?? 'rls_policies')
  const content = new RLSMigrationGenerator().generateMigration(rlsSchema, {
    name,
    includeContextFunctions: options.functions !== false,
    schemaName: options.schema ?? 'public',
    policyPrefix: options.policyPrefix ?? 'rls',
    force: options.force !== false
  })

  const directory = options.dir
    ? resolve(process.cwd(), options.dir)
    : (config.migrations?.directory ?? resolve(process.cwd(), 'migrations'))
  const filename = `${migrationTimestamp()}_${name}.ts`
  const filepath = join(directory, filename)

  if (existsSync(filepath)) {
    throw new CLIError(`Migration file already exists: ${filepath}`, 'FILE_EXISTS')
  }

  if (isDryRun()) {
    diag(`DRY RUN: not writing ${filepath}`)
    output({ file: filepath, dryRun: true }, { text: `DRY RUN: would create ${filename}` })
    return
  }

  mkdirSync(directory, { recursive: true })
  writeFileSync(filepath, content, 'utf8')

  output({ file: filepath }, { text: `Migration created: ${filename}\n  ${filepath}` })
  diag(`Run 'kysera migrate up' to apply the RLS policies`)
}

function sanitizeMigrationName(name: string): string {
  const safe = name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()
  if (!safe.replace(/_/g, '')) {
    throw new CLIError(`Invalid migration name: '${name}'`, 'VALIDATION_ERROR')
  }
  return safe
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
