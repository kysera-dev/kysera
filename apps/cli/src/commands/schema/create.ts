import { Command } from 'commander'
import { prism, confirm } from '@xec-sh/kit'
import { spinner } from '../../utils/spinner.js'
import { CLIError } from '../../utils/errors.js'
import { withDatabase } from '../../utils/with-database.js'
import { createPostgresAdapter, getTenantSchemaName } from '@kysera/dialects'

export interface CreateOptions {
  tenant?: string
  ifNotExists?: boolean
  force?: boolean
  verbose?: boolean
  config?: string
}

export function createCommand(): Command {
  const cmd = new Command('create')
    .description('Create a new database schema')
    .argument('<name>', 'Schema name to create')
    .option('--tenant <id>', 'Create as tenant schema with specified ID')
    .option('--if-not-exists', 'Do not error if schema already exists')
    .option('--force', 'Skip confirmation prompt')
    .option('-v, --verbose', 'Show detailed output')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (name: string, options: CreateOptions) => {
      try {
        await createSchema(name, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to create schema: ${error instanceof Error ? error.message : String(error)}`,
          'SCHEMA_CREATE_ERROR'
        )
      }
    })

  return cmd
}

async function createSchema(name: string, options: CreateOptions): Promise<void> {
  await withDatabase({ config: options.config, verbose: options.verbose }, async (db, config) => {
    if (config.database.dialect !== 'postgres') {
      throw new CLIError(
        'Schema management is only available for PostgreSQL',
        'UNSUPPORTED_DIALECT'
      )
    }

    // Resolve schema name (use tenant naming convention if --tenant is specified)
    const schemaName = options.tenant ? getTenantSchemaName(options.tenant) : name

    const adapter = createPostgresAdapter()

    // Check if schema already exists
    const exists = await adapter.schemaExists(db, schemaName)
    if (exists) {
      if (options.ifNotExists) {
        console.log(prism.yellow(`Schema '${schemaName}' already exists`))
        return
      }
      throw new CLIError(`Schema '${schemaName}' already exists`, 'SCHEMA_EXISTS')
    }

    // Confirm creation
    if (!options.force) {
      if (process.env.NODE_ENV === 'test' || !process.stdin.isTTY) {
        // Skip confirmation in non-interactive mode
      } else {
        const confirmed = await confirm({
          message: `Create schema '${schemaName}'?`,
          initialValue: true
        })

        if (!confirmed) {
          console.log(prism.gray('Schema creation cancelled'))
          return
        }
      }
    }

    const createSpinner = spinner()
    createSpinner.start(`Creating schema '${schemaName}'...`)

    const created = await adapter.createSchema(db, schemaName, {
      ifNotExists: options.ifNotExists
    })

    if (created) {
      createSpinner.succeed(`Schema '${schemaName}' created successfully`)

      if (options.tenant) {
        console.log('')
        console.log(prism.cyan('Tenant schema created with naming convention:'))
        console.log(`  Schema: ${schemaName}`)
        console.log(`  Tenant ID: ${options.tenant}`)
        console.log('')
        console.log(prism.gray('Next steps:'))
        console.log(`  1. Run migrations in the new schema:`)
        console.log(`     ${prism.cyan(`kysera migrate up --schema ${schemaName}`)}`)
        console.log(`  2. Or clone from a template schema:`)
        console.log(`     ${prism.cyan(`kysera schema clone template ${schemaName}`)}`)
      }
    } else {
      createSpinner.warn(`Schema '${schemaName}' already exists`)
    }
  })
}
