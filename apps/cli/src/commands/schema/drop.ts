import { Command } from 'commander'
import { prism, confirm } from '@xec-sh/kit'
import { spinner } from '../../utils/spinner.js'
import { CLIError } from '../../utils/errors.js'
import { withDatabase } from '../../utils/with-database.js'
import { createPostgresAdapter } from '@kysera/dialects'

export interface DropOptions {
  cascade?: boolean
  ifExists?: boolean
  force?: boolean
  verbose?: boolean
  config?: string
}

export function dropCommand(): Command {
  const cmd = new Command('drop')
    .description('Drop a database schema')
    .argument('<name>', 'Schema name to drop')
    .option('--cascade', 'Drop all objects in the schema (CASCADE)')
    .option('--if-exists', 'Do not error if schema does not exist')
    .option('--force', 'Skip confirmation prompt')
    .option('-v, --verbose', 'Show detailed output')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (name: string, options: DropOptions) => {
      try {
        await dropSchema(name, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to drop schema: ${error instanceof Error ? error.message : String(error)}`,
          'SCHEMA_DROP_ERROR'
        )
      }
    })

  return cmd
}

async function dropSchema(name: string, options: DropOptions): Promise<void> {
  await withDatabase({ config: options.config, verbose: options.verbose }, async (db, config) => {
    if (config.database.dialect !== 'postgres') {
      throw new CLIError(
        'Schema management is only available for PostgreSQL',
        'UNSUPPORTED_DIALECT'
      )
    }

    // Prevent dropping protected schemas
    const protectedSchemas = ['public', 'pg_catalog', 'information_schema']
    if (protectedSchemas.includes(name)) {
      throw new CLIError(
        `Cannot drop protected schema: ${name}`,
        'PROTECTED_SCHEMA',
        ['The public, pg_catalog, and information_schema schemas cannot be dropped']
      )
    }

    const adapter = createPostgresAdapter()

    // Check if schema exists
    const exists = await adapter.schemaExists(db, name)
    if (!exists) {
      if (options.ifExists) {
        console.log(prism.yellow(`Schema '${name}' does not exist`))
        return
      }
      throw new CLIError(`Schema '${name}' does not exist`, 'SCHEMA_NOT_FOUND')
    }

    // Get schema info for confirmation
    const info = await adapter.getSchemaInfo(db, name)

    // Confirm deletion
    if (!options.force) {
      if (process.env.NODE_ENV === 'test' || !process.stdin.isTTY) {
        throw new CLIError(
          'Schema drop requires confirmation',
          'DROP_REQUIRES_CONFIRMATION',
          undefined,
          ['Use --force flag to skip confirmation']
        )
      }

      console.log('')
      console.log(prism.red(`Warning: You are about to drop schema '${name}'`))
      console.log(prism.yellow(`  Tables: ${info.tableCount}`))
      console.log(prism.yellow(`  Size: ${formatBytes(info.sizeBytes)}`))
      if (options.cascade) {
        console.log(prism.red('  CASCADE: All objects in the schema will be dropped!'))
      }
      console.log('')

      const confirmed = await confirm({
        message: `Are you sure you want to drop schema '${name}'?`,
        initialValue: false
      })

      if (!confirmed) {
        console.log(prism.gray('Schema drop cancelled'))
        return
      }

      if (info.tableCount > 0 && !options.cascade) {
        console.log(prism.red('Schema contains tables. Use --cascade to drop all objects.'))
        return
      }
    }

    const dropSpinner = spinner()
    dropSpinner.start(`Dropping schema '${name}'...`)

    const dropped = await adapter.dropSchema(db, name, {
      ifExists: options.ifExists,
      cascade: options.cascade
    })

    if (dropped) {
      dropSpinner.succeed(`Schema '${name}' dropped successfully`)
    } else {
      dropSpinner.warn(`Schema '${name}' does not exist`)
    }
  })
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}
