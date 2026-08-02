import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { formatTimestampForDb } from '@kysera/core'
import { guardDestructive } from '../../utils/guard.js'
import { spinner } from '../../utils/spinner.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { auditTableExists, auditTableMissingHint, resolveAuditTable } from './shared.js'

export interface CleanupOptions {
  olderThan?: string
  table?: string
  dryRun?: boolean
  force?: boolean
  /** Always set: commander applies a '1000' default. */
  batchSize: string
  config?: string
}

export function cleanupCommand(): Command {
  const cmd = new Command('cleanup')
    .description('Clean up old audit logs')
    .option('--older-than <duration>', 'Delete logs older than duration (30d, 3m, 1y)')
    .option('-t, --table <name>', 'Clean specific table only')
    .option('--dry-run', 'Preview cleanup without deleting')
    .option('--force', 'Skip confirmation prompt')
    .option('--batch-size <n>', 'Delete in batches', '1000')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: CleanupOptions) => {
      try {
        await cleanupAuditLogs(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to cleanup audit logs: ${error instanceof Error ? error.message : String(error)}`,
          'CLEANUP_ERROR'
        )
      }
    })

  return cmd
}

async function cleanupAuditLogs(options: CleanupOptions): Promise<void> {
  // Validate options
  if (!options.olderThan) {
    throw new CLIError('Duration is required', 'MISSING_DURATION', undefined, [
      'Specify --older-than with a duration (e.g., 30d, 3m, 1y)'
    ])
  }

  // Parse duration (default to 30 days if not specified)
  const cutoffDate = parseDuration(options.olderThan || '30d')
  const now = new Date()

  if (cutoffDate >= now) {
    throw new CLIError('Invalid duration: cutoff date is in the future', 'INVALID_DURATION')
  }

  // Load configuration
  const config = await loadConfig(options.config)

  if (!config.database) {
    throw new CLIError('Database configuration not found', 'CONFIG_ERROR', undefined, [
      'Create a kysera.config.ts file with database configuration',
      'Or specify a config file with --config option'
    ])
  }

  // Get database connection
  const db = await getDatabaseConnection(config.database)

  if (!db) {
    throw new CLIError('Failed to connect to database', 'DATABASE_ERROR', undefined, [
      'Check your database configuration',
      'Ensure the database server is running'
    ])
  }

  const auditTable = resolveAuditTable(config)
  const dialect = config.database.dialect
  // changed_at is stored as text in the plugin's own format
  const cutoff = formatTimestampForDb(cutoffDate, dialect)
  const analyzeSpinner = spinner()
  analyzeSpinner.start('Analyzing audit logs to clean up...')

  try {
    if (!(await auditTableExists(db, auditTable))) {
      analyzeSpinner.fail('Audit table not found')
      console.log('')
      for (const line of auditTableMissingHint(auditTable)) {
        console.log(prism.yellow(line))
      }
      return
    }

    // Build query to count logs to delete
    let countQuery = db
      .selectFrom(auditTable)
      .select(db.fn.countAll().as('count'))
      .where('changed_at', '<', cutoff)

    if (options.table) {
      countQuery = countQuery.where('table_name', '=', options.table)
    }

    const countResult = await countQuery.executeTakeFirst()
    const totalToDelete = Number(countResult?.count ?? 0)

    if (totalToDelete === 0) {
      analyzeSpinner.succeed('No audit logs to clean up')
      return
    }

    // Get statistics about logs to delete
    let statsQuery = db.selectFrom(auditTable).where('changed_at', '<', cutoff)

    if (options.table) {
      statsQuery = statsQuery.where('table_name', '=', options.table)
    }

    const tableStats = (await statsQuery
      .select(['table_name'])
      .select(db.fn.count('table_name').as('count'))
      .groupBy('table_name')
      .execute()) as { table_name: string; count: unknown }[]

    const oldestLog = (await statsQuery
      .select('changed_at')
      .orderBy('changed_at', 'asc')
      .limit(1)
      .executeTakeFirst()) as { changed_at: string | Date } | undefined

    const newestLog = (await statsQuery
      .select('changed_at')
      .orderBy('changed_at', 'desc')
      .limit(1)
      .executeTakeFirst()) as { changed_at: string | Date } | undefined

    analyzeSpinner.succeed(`Found ${totalToDelete.toLocaleString()} audit logs to clean up`)

    // Show cleanup preview
    console.log('')
    console.log(prism.bold('🧹 Cleanup Preview:'))
    console.log(prism.gray('─'.repeat(50)))
    console.log(`  Cutoff Date: ${cutoffDate.toLocaleString()}`)
    console.log(`  Logs to Delete: ${totalToDelete.toLocaleString()}`)
    console.log(
      `  Date Range: ${formatDate(oldestLog?.changed_at)} → ${formatDate(newestLog?.changed_at)}`
    )

    if (tableStats.length > 0) {
      console.log('')
      console.log(prism.cyan('  By Table:'))
      for (const stat of tableStats) {
        console.log(`    ${stat.table_name}: ${Number(stat.count).toLocaleString()} logs`)
      }
    }

    // Calculate space savings (approximate)
    const estimatedSize = totalToDelete * 500 // Assume average 500 bytes per log
    console.log('')
    console.log(`  Estimated Space Savings: ${formatBytes(estimatedSize)}`)

    // Dry run mode
    if (options.dryRun) {
      console.log('')
      console.log(prism.yellow('Dry run mode - no changes were made'))
      return
    }

    // Confirm deletion: audit logs cannot be recovered once deleted
    const proceed = await guardDestructive(
      `Permanently delete ${totalToDelete.toLocaleString()} audit logs? Deleted logs cannot be recovered.`,
      { force: options.force }
    )
    if (!proceed) {
      console.error(prism.gray('Cleanup cancelled'))
      return
    }

    // Execute cleanup
    const deleteSpinner = spinner()
    deleteSpinner.start('Deleting audit logs...')

    const batchSize = parseInt(options.batchSize || '1000', 10)
    if (isNaN(batchSize) || batchSize <= 0) {
      throw new CLIError('Invalid batch size - must be a positive number')
    }
    let deletedCount = 0
    let batchCount = 0

    // Delete in batches for better performance
    while (deletedCount < totalToDelete) {
      // Get IDs to delete in this batch
      let batchQuery = db
        .selectFrom(auditTable)
        .select('id')
        .where('changed_at', '<', cutoff)
        .limit(batchSize)

      if (options.table) {
        batchQuery = batchQuery.where('table_name', '=', options.table)
      }

      const batchIds = (await batchQuery.execute()) as { id: unknown }[]

      if (batchIds.length === 0) {
        break
      }

      // Delete the batch
      const ids = batchIds.map(row => row.id)
      await db.deleteFrom(auditTable).where('id', 'in', ids).execute()

      deletedCount += batchIds.length
      batchCount++

      deleteSpinner.text = `Deleting audit logs... ${deletedCount.toLocaleString()}/${totalToDelete.toLocaleString()}`

      // Add a small delay to avoid overwhelming the database
      if (batchCount % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    deleteSpinner.succeed(`Deleted ${deletedCount.toLocaleString()} audit logs`)

    // Show summary
    console.log('')
    console.log(prism.green('✅ Cleanup completed successfully'))
    console.log(
      prism.gray(
        `Deleted ${deletedCount.toLocaleString()} audit logs older than ${options.olderThan}`
      )
    )
    console.log(prism.gray(`Space saved: ~${formatBytes(estimatedSize)}`))

    // Suggest optimization
    if (config.database.dialect === 'postgres') {
      console.log('')
      console.log(prism.gray('💡 Tip: Run VACUUM to reclaim disk space:'))
      console.log(prism.gray(`   VACUUM ANALYZE ${auditTable};`))
    } else if (config.database.dialect === 'mysql') {
      console.log('')
      console.log(prism.gray('💡 Tip: Run OPTIMIZE TABLE to reclaim disk space:'))
      console.log(prism.gray(`   OPTIMIZE TABLE ${auditTable};`))
    }
  } finally {
    // Close database connection
    await db.destroy()
  }
}

function parseDuration(duration: string): Date {
  const match = /^(\d+)([dmy])$/.exec(duration)
  if (!match) {
    throw new CLIError(`Invalid duration format: ${duration}`, 'INVALID_DURATION', undefined, [
      'Use format like: 30d (days), 3m (months), 1y (years)'
    ])
  }

  const value = parseInt(match[1], 10)
  if (isNaN(value) || value <= 0) {
    throw new CLIError('Invalid retention period value - must be a positive number')
  }
  const unit = match[2]
  const now = new Date()

  switch (unit) {
    case 'd': // days
      return new Date(now.getTime() - value * 24 * 60 * 60 * 1000)
    case 'm': {
      // months
      const monthsAgo = new Date(now)
      monthsAgo.setMonth(monthsAgo.getMonth() - value)
      return monthsAgo
    }
    case 'y': {
      // years
      const yearsAgo = new Date(now)
      yearsAgo.setFullYear(yearsAgo.getFullYear() - value)
      return yearsAgo
    }
    default:
      throw new CLIError(`Invalid duration unit: ${unit}`, 'INVALID_DURATION')
  }
}

function formatDate(date: string | Date | undefined): string {
  if (!date) return 'N/A'
  return new Date(date).toLocaleDateString()
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i]
}
