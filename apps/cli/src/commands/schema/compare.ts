import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { spinner } from '../../utils/spinner.js'
import { CLIError } from '../../utils/errors.js'
import { withDatabase } from '../../utils/with-database.js'
import { createPostgresAdapter } from '@kysera/dialects'

export interface CompareOptions {
  json?: boolean
  verbose?: boolean
  config?: string
}

export function compareCommand(): Command {
  const cmd = new Command('compare')
    .description('Compare two schemas and show differences')
    .argument('<schema1>', 'First schema name')
    .argument('<schema2>', 'Second schema name')
    .option('--json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed output')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (schema1: string, schema2: string, options: CompareOptions) => {
      try {
        await compareSchemas(schema1, schema2, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to compare schemas: ${error instanceof Error ? error.message : String(error)}`,
          'SCHEMA_COMPARE_ERROR'
        )
      }
    })

  return cmd
}

async function compareSchemas(
  schema1: string,
  schema2: string,
  options: CompareOptions
): Promise<void> {
  await withDatabase({ config: options.config, verbose: options.verbose }, async (db, config) => {
    if (config.database.dialect !== 'postgres') {
      throw new CLIError(
        'Schema management is only available for PostgreSQL',
        'UNSUPPORTED_DIALECT'
      )
    }

    const compareSpinner = spinner()
    compareSpinner.start(`Comparing schemas '${schema1}' and '${schema2}'...`)

    const adapter = createPostgresAdapter()

    // Check if both schemas exist
    const [exists1, exists2] = await Promise.all([
      adapter.schemaExists(db, schema1),
      adapter.schemaExists(db, schema2)
    ])

    if (!exists1) {
      compareSpinner.fail(`Schema '${schema1}' does not exist`)
      return
    }

    if (!exists2) {
      compareSpinner.fail(`Schema '${schema2}' does not exist`)
      return
    }

    // Compare schemas
    const diff = await adapter.compareSchemas(db, schema1, schema2)

    // Get schema info for both
    const [info1, info2] = await Promise.all([
      adapter.getSchemaInfo(db, schema1),
      adapter.getSchemaInfo(db, schema2)
    ])

    compareSpinner.succeed('Schema comparison complete')

    const result = {
      schema1: {
        name: schema1,
        tableCount: info1.tableCount,
        sizeBytes: info1.sizeBytes,
        uniqueTables: diff.onlyInFirst
      },
      schema2: {
        name: schema2,
        tableCount: info2.tableCount,
        sizeBytes: info2.sizeBytes,
        uniqueTables: diff.onlyInSecond
      },
      commonTables: diff.inBoth,
      identical: diff.onlyInFirst.length === 0 && diff.onlyInSecond.length === 0
    }

    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    // Display formatted output
    console.log('')
    console.log(prism.bold('Schema Comparison'))
    console.log(prism.gray('='.repeat(60)))
    console.log('')

    // Schema info side by side
    console.log(prism.cyan('Schema Overview:'))
    console.log('')
    console.log(`  ${prism.bold(schema1.padEnd(30))} ${prism.bold(schema2)}`)
    console.log(`  ${'-'.repeat(30)} ${'-'.repeat(30)}`)
    console.log(
      `  Tables: ${String(info1.tableCount).padEnd(22)} Tables: ${info2.tableCount}`
    )
    console.log(
      `  Size: ${formatBytes(info1.sizeBytes).padEnd(24)} Size: ${formatBytes(info2.sizeBytes)}`
    )
    console.log('')

    // Tables comparison
    if (result.identical) {
      console.log(prism.green('Schemas have identical table structures'))
    } else {
      // Tables only in schema1
      if (diff.onlyInFirst.length > 0) {
        console.log(prism.red(`Tables only in '${schema1}' (${diff.onlyInFirst.length}):`))
        for (const table of diff.onlyInFirst) {
          console.log(prism.red(`  - ${table}`))
        }
        console.log('')
      }

      // Tables only in schema2
      if (diff.onlyInSecond.length > 0) {
        console.log(prism.green(`Tables only in '${schema2}' (${diff.onlyInSecond.length}):`))
        for (const table of diff.onlyInSecond) {
          console.log(prism.green(`  + ${table}`))
        }
        console.log('')
      }

      // Common tables
      if (diff.inBoth.length > 0) {
        console.log(prism.gray(`Common tables (${diff.inBoth.length}):`))
        if (options.verbose) {
          for (const table of diff.inBoth) {
            console.log(prism.gray(`  = ${table}`))
          }
        } else {
          console.log(prism.gray(`  ${diff.inBoth.slice(0, 5).join(', ')}${diff.inBoth.length > 5 ? ` ... and ${diff.inBoth.length - 5} more` : ''}`))
        }
        console.log('')
      }
    }

    // Summary
    console.log(prism.gray('-'.repeat(60)))
    console.log('')
    console.log(prism.cyan('Summary:'))
    console.log(`  Total tables in '${schema1}': ${info1.tableCount}`)
    console.log(`  Total tables in '${schema2}': ${info2.tableCount}`)
    console.log(`  Common tables: ${diff.inBoth.length}`)
    console.log(`  Unique to '${schema1}': ${diff.onlyInFirst.length}`)
    console.log(`  Unique to '${schema2}': ${diff.onlyInSecond.length}`)

    if (!result.identical) {
      console.log('')
      console.log(prism.gray('Hints:'))
      if (diff.onlyInFirst.length > 0) {
        console.log(
          `  To sync missing tables, run migrations on '${schema2}'`
        )
      }
      if (diff.onlyInSecond.length > 0) {
        console.log(
          `  Or clone: ${prism.cyan(`kysera schema clone ${schema2} new_schema`)}`
        )
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
