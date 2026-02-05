import { Command } from 'commander'
import { prism, table } from '@xec-sh/kit'
import { spinner } from '../../utils/spinner.js'
import { CLIError } from '../../utils/errors.js'
import { withDatabase } from '../../utils/with-database.js'
import { createPostgresAdapter, isTenantSchema, parseTenantSchemaName } from '@kysera/dialects'

export interface ListOptions {
  json?: boolean
  tenant?: boolean
  verbose?: boolean
  config?: string
}

export function listCommand(): Command {
  const cmd = new Command('list')
    .description('List all database schemas')
    .option('--json', 'Output as JSON')
    .option('--tenant', 'Only show tenant schemas')
    .option('-v, --verbose', 'Show detailed information')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: ListOptions) => {
      try {
        await listSchemas(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to list schemas: ${error instanceof Error ? error.message : String(error)}`,
          'SCHEMA_LIST_ERROR'
        )
      }
    })

  return cmd
}

async function listSchemas(options: ListOptions): Promise<void> {
  await withDatabase({ config: options.config, verbose: options.verbose }, async (db, config) => {
    if (config.database.dialect !== 'postgres') {
      throw new CLIError(
        'Schema management is only available for PostgreSQL',
        'UNSUPPORTED_DIALECT',
        ['PostgreSQL schemas allow multi-tenant and modular database architectures']
      )
    }

    const listSpinner = spinner()
    listSpinner.start('Fetching schemas...')

    const adapter = createPostgresAdapter()
    let schemas = await adapter.getSchemas(db)

    // Filter tenant schemas if requested
    if (options.tenant) {
      schemas = schemas.filter(s => isTenantSchema(s))
    }

    if (schemas.length === 0) {
      listSpinner.warn('No schemas found')
      return
    }

    listSpinner.succeed(`Found ${schemas.length} schema${schemas.length !== 1 ? 's' : ''}`)

    if (options.verbose) {
      // Get detailed info for each schema
      const schemaInfos = await Promise.all(
        schemas.map(async schemaName => {
          const info = await adapter.getSchemaInfo(db, schemaName)
          const tenantId = parseTenantSchemaName(schemaName)
          return {
            name: schemaName,
            tables: info.tableCount,
            owner: info.owner || 'unknown',
            size: formatBytes(info.sizeBytes),
            tenant: tenantId || '-'
          }
        })
      )

      if (options.json) {
        console.log(JSON.stringify(schemaInfos, null, 2))
      } else {
        console.log('')
        console.log(prism.bold('Database Schemas'))
        console.log('')
        console.log(table(schemaInfos as any))
      }
    } else {
      if (options.json) {
        console.log(JSON.stringify(schemas, null, 2))
      } else {
        console.log('')
        console.log(prism.bold('Database Schemas'))
        console.log('')
        for (const schema of schemas) {
          const isTenant = isTenantSchema(schema)
          const prefix = isTenant ? prism.cyan('  [tenant]') : '         '
          console.log(`${prefix} ${schema}`)
        }
        console.log('')
        console.log(prism.gray(`Use ${prism.cyan('--verbose')} for detailed information`))
      }
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
