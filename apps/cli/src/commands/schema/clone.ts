import { Command } from 'commander'
import { prism, confirm } from '@xec-sh/kit'
import { spinner } from '../../utils/spinner.js'
import { CLIError } from '../../utils/errors.js'
import { withDatabase } from '../../utils/with-database.js'
import { createPostgresAdapter, getTenantSchemaName } from '@kysera/dialects'

export interface CloneOptions {
  includeData?: boolean
  exclude?: string[]
  tenant?: string
  force?: boolean
  verbose?: boolean
  config?: string
}

export function cloneCommand(): Command {
  const cmd = new Command('clone')
    .description('Clone a schema structure (and optionally data) to a new schema')
    .argument('<source>', 'Source schema name')
    .argument('<target>', 'Target schema name')
    .option('--include-data', 'Include table data in the clone')
    .option('--exclude <tables...>', 'Tables to exclude from cloning')
    .option('--tenant <id>', 'Create target as tenant schema with specified ID')
    .option('--force', 'Skip confirmation prompt')
    .option('-v, --verbose', 'Show detailed output')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (source: string, target: string, options: CloneOptions) => {
      try {
        await cloneSchema(source, target, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to clone schema: ${error instanceof Error ? error.message : String(error)}`,
          'SCHEMA_CLONE_ERROR'
        )
      }
    })

  return cmd
}

async function cloneSchema(source: string, target: string, options: CloneOptions): Promise<void> {
  await withDatabase({ config: options.config, verbose: options.verbose }, async (db, config) => {
    if (config.database.dialect !== 'postgres') {
      throw new CLIError(
        'Schema management is only available for PostgreSQL',
        'UNSUPPORTED_DIALECT'
      )
    }

    // Resolve target schema name (use tenant naming convention if --tenant is specified)
    const targetSchema = options.tenant ? getTenantSchemaName(options.tenant) : target

    const adapter = createPostgresAdapter()

    // Check if source schema exists
    const sourceExists = await adapter.schemaExists(db, source)
    if (!sourceExists) {
      throw new CLIError(`Source schema '${source}' does not exist`, 'SOURCE_NOT_FOUND')
    }

    // Check if target schema already exists
    const targetExists = await adapter.schemaExists(db, targetSchema)
    if (targetExists) {
      throw new CLIError(
        `Target schema '${targetSchema}' already exists`,
        'TARGET_EXISTS',
        ['Use a different target name or drop the existing schema first']
      )
    }

    // Get source schema info
    const sourceInfo = await adapter.getSchemaInfo(db, source)

    // Confirm clone
    if (!options.force) {
      if (process.env.NODE_ENV === 'test' || !process.stdin.isTTY) {
        // Skip confirmation in non-interactive mode
      } else {
        console.log('')
        console.log(prism.bold('Clone Schema'))
        console.log(prism.gray('-'.repeat(50)))
        console.log(`  Source: ${prism.cyan(source)}`)
        console.log(`  Target: ${prism.cyan(targetSchema)}`)
        console.log(`  Tables: ${sourceInfo.tableCount}`)
        console.log(`  Size: ${formatBytes(sourceInfo.sizeBytes)}`)
        console.log(`  Include Data: ${options.includeData ? prism.green('Yes') : prism.gray('No')}`)
        if (options.exclude && options.exclude.length > 0) {
          console.log(`  Exclude: ${options.exclude.join(', ')}`)
        }
        console.log('')

        const confirmed = await confirm({
          message: `Clone schema '${source}' to '${targetSchema}'?`,
          initialValue: true
        })

        if (!confirmed) {
          console.log(prism.gray('Schema clone cancelled'))
          return
        }
      }
    }

    const cloneSpinner = spinner()
    cloneSpinner.start(
      `Cloning schema '${source}' to '${targetSchema}'${options.includeData ? ' with data' : ''}...`
    )

    await adapter.cloneSchema(db, source, targetSchema, {
      includeData: options.includeData,
      excludeTables: options.exclude
    })

    cloneSpinner.succeed(`Schema '${source}' cloned to '${targetSchema}' successfully`)

    // Get target schema info
    const targetInfo = await adapter.getSchemaInfo(db, targetSchema)

    console.log('')
    console.log(prism.cyan('Clone Summary:'))
    console.log(`  Tables cloned: ${targetInfo.tableCount}`)
    console.log(`  Size: ${formatBytes(targetInfo.sizeBytes)}`)

    if (options.tenant) {
      console.log('')
      console.log(prism.cyan('Tenant schema created:'))
      console.log(`  Schema: ${targetSchema}`)
      console.log(`  Tenant ID: ${options.tenant}`)
    }

    console.log('')
    console.log(prism.gray('Next steps:'))
    console.log(`  View schema: ${prism.cyan(`kysera schema info ${targetSchema}`)}`)
    console.log(`  Run queries: ${prism.cyan(`kysera query --schema ${targetSchema}`)}`)
  })
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}
