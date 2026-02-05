import { Command } from 'commander'
import { prism, table } from '@xec-sh/kit'
import { spinner } from '../../utils/spinner.js'
import { CLIError } from '../../utils/errors.js'
import { withDatabase } from '../../utils/with-database.js'
import { createPostgresAdapter, isTenantSchema, parseTenantSchemaName } from '@kysera/dialects'

export interface InfoOptions {
  json?: boolean
  indexes?: boolean
  foreignKeys?: boolean
  verbose?: boolean
  config?: string
}

export function infoCommand(): Command {
  const cmd = new Command('info')
    .description('Show detailed information about a schema')
    .argument('<name>', 'Schema name')
    .option('--json', 'Output as JSON')
    .option('--indexes', 'Show index information')
    .option('--foreign-keys', 'Show foreign key relationships')
    .option('-v, --verbose', 'Show all details')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (name: string, options: InfoOptions) => {
      try {
        await showSchemaInfo(name, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to get schema info: ${error instanceof Error ? error.message : String(error)}`,
          'SCHEMA_INFO_ERROR'
        )
      }
    })

  return cmd
}

async function showSchemaInfo(name: string, options: InfoOptions): Promise<void> {
  await withDatabase({ config: options.config, verbose: options.verbose }, async (db, config) => {
    if (config.database.dialect !== 'postgres') {
      throw new CLIError(
        'Schema management is only available for PostgreSQL',
        'UNSUPPORTED_DIALECT'
      )
    }

    const infoSpinner = spinner()
    infoSpinner.start(`Fetching schema info for '${name}'...`)

    const adapter = createPostgresAdapter()

    // Check if schema exists
    const exists = await adapter.schemaExists(db, name)
    if (!exists) {
      infoSpinner.fail(`Schema '${name}' does not exist`)
      return
    }

    // Get basic schema info
    const info = await adapter.getSchemaInfo(db, name)

    // Get tables
    const tables = await adapter.getTables(db, { schema: name })

    // Get tenant ID if applicable
    const tenantId = parseTenantSchemaName(name)

    // Prepare result object
    const result: any = {
      name: info.name,
      owner: info.owner,
      tableCount: info.tableCount,
      sizeBytes: info.sizeBytes,
      sizeFormatted: formatBytes(info.sizeBytes),
      tables,
      isTenantSchema: tenantId !== null,
      tenantId: tenantId
    }

    // Get indexes if requested
    let indexes: any[] = []
    if (options.indexes || options.verbose) {
      indexes = await adapter.getSchemaIndexes(db, { schema: name })
      result.indexes = indexes
    }

    // Get foreign keys if requested
    let foreignKeys: any[] = []
    if (options.foreignKeys || options.verbose) {
      foreignKeys = await adapter.getSchemaForeignKeys(db, { schema: name })
      result.foreignKeys = foreignKeys
    }

    infoSpinner.succeed(`Schema info for '${name}'`)

    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    // Display formatted output
    console.log('')
    console.log(prism.bold(`Schema: ${name}`))
    console.log(prism.gray('-'.repeat(50)))
    console.log('')

    // Basic info
    console.log(prism.cyan('General Information:'))
    console.log(`  Owner: ${info.owner || 'unknown'}`)
    console.log(`  Tables: ${info.tableCount}`)
    console.log(`  Size: ${formatBytes(info.sizeBytes)}`)

    if (tenantId) {
      console.log('')
      console.log(prism.cyan('Tenant Information:'))
      console.log(`  Tenant ID: ${tenantId}`)
      console.log(`  Schema Pattern: tenant_<id>`)
    }

    // Tables list
    if (tables.length > 0) {
      console.log('')
      console.log(prism.cyan('Tables:'))
      for (const tableName of tables) {
        console.log(`  - ${tableName}`)
      }
    }

    // Indexes
    if ((options.indexes || options.verbose) && indexes.length > 0) {
      console.log('')
      console.log(prism.cyan('Indexes:'))
      const indexTable = indexes.map(idx => ({
        table: idx.tableName,
        index: idx.indexName,
        type: idx.indexType,
        unique: idx.isUnique ? 'Yes' : 'No',
        primary: idx.isPrimary ? 'Yes' : 'No',
        columns: idx.columns.join(', ')
      }))
      console.log(table(indexTable as any))
    }

    // Foreign keys
    if ((options.foreignKeys || options.verbose) && foreignKeys.length > 0) {
      console.log('')
      console.log(prism.cyan('Foreign Keys:'))
      const fkTable = foreignKeys.map(fk => ({
        constraint: fk.constraintName,
        table: fk.tableName,
        column: fk.columnName,
        references: `${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumn}`,
        onDelete: fk.onDelete,
        onUpdate: fk.onUpdate
      }))
      console.log(table(fkTable as any))
    }

    // Usage hints
    console.log('')
    console.log(prism.gray('Commands:'))
    console.log(`  Clone: ${prism.cyan(`kysera schema clone ${name} <target>`)}`)
    console.log(`  Drop: ${prism.cyan(`kysera schema drop ${name} --cascade`)}`)
    console.log(`  Compare: ${prism.cyan(`kysera schema compare ${name} <other>`)}`)
  })
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}
