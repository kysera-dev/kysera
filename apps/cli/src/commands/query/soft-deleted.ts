import { Command } from 'commander'
import { prism, spinner, table, confirm, select } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'

export interface SoftDeletedOptions {
  action?: 'list' | 'restore' | 'purge' | 'stats'
  column?: string
  since?: string
  until?: string
  limit?: string
  ids?: string
  force?: boolean
  dryRun?: boolean
  json?: boolean
  config?: string
}

interface SoftDeletedRecord {
  table: string
  id: any
  deletedAt: Date
  data: any
}

interface SoftDeleteStats {
  table: string
  totalDeleted: number
  deletedToday: number
  deletedThisWeek: number
  deletedThisMonth: number
  oldestDeletion?: Date
  newestDeletion?: Date
  storageSize?: number
}

export function softDeletedCommand(): Command {
  const cmd = new Command('soft-deleted')
    .description('Manage soft-deleted records')
    .argument('<table>', 'Table name')
    .option('-a, --action <type>', 'Action to perform (list/restore/purge/stats)', 'list')
    .option('-c, --column <name>', 'Soft delete column name', 'deleted_at')
    .option('-s, --since <datetime>', 'Deleted since datetime (ISO 8601)')
    .option('-u, --until <datetime>', 'Deleted until datetime (ISO 8601)')
    .option('-l, --limit <n>', 'Limit number of results', '100')
    .option('-i, --ids <list>', 'Comma-separated list of IDs')
    .option('--force', 'Skip confirmation prompts')
    .option('--dry-run', 'Preview changes without executing')
    .option('--json', 'Output as JSON')
    .option('--config <path>', 'Path to configuration file')
    .action(async (tableName: string, options: SoftDeletedOptions) => {
      try {
        await manageSoftDeleted(tableName, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to manage soft-deleted records: ${error instanceof Error ? error.message : String(error)}`,
          'SOFT_DELETE_ERROR'
        )
      }
    })

  return cmd
}

async function manageSoftDeleted(tableName: string, options: SoftDeletedOptions): Promise<void> {
  // Load configuration
  const config = await loadConfig(options.config)

  if (!config?.database) {
    throw new CLIError(
      'Database configuration not found',
      'CONFIG_ERROR',
      [
        'Create a kysera.config.ts file with database configuration',
        'Or specify a config file with --config option'
      ]
    )
  }

  // Get database connection
  const db = await getDatabaseConnection(config.database)

  if (!db) {
    throw new CLIError(
      'Failed to connect to database',
      'DATABASE_ERROR',
      ['Check your database configuration', 'Ensure the database server is running']
    )
  }

  try {
    // Verify table exists
    const tables = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_name', '=', tableName)
      .execute()

    if (tables.length === 0) {
      throw new CLIError(`Table '${tableName}' not found`, 'TABLE_NOT_FOUND')
    }

    // Verify soft delete column exists
    const deletedAtColumn = options.column || 'deleted_at'
    const columns = await db
      .selectFrom('information_schema.columns')
      .select('column_name')
      .where('table_name', '=', tableName)
      .where('column_name', '=', deletedAtColumn)
      .execute()

    if (columns.length === 0) {
      throw new CLIError(
        `Soft delete column '${deletedAtColumn}' not found in table '${tableName}'`,
        'COLUMN_NOT_FOUND',
        [
          'This table may not support soft deletes',
          'Use --column to specify a different soft delete column',
          'Common soft delete columns: deleted_at, deleted, is_deleted'
        ]
      )
    }

    // Execute action
    switch (options.action) {
      case 'list':
        await listSoftDeleted(db, tableName, deletedAtColumn, options)
        break
      case 'restore':
        await restoreSoftDeleted(db, tableName, deletedAtColumn, options)
        break
      case 'purge':
        await purgeSoftDeleted(db, tableName, deletedAtColumn, options)
        break
      case 'stats':
        await showSoftDeleteStats(db, tableName, deletedAtColumn, options)
        break
      default:
        throw new CLIError(
          `Invalid action: ${options.action}`,
          'INVALID_ACTION',
          ['Valid actions are: list, restore, purge, stats']
        )
    }

  } finally {
    // Close database connection
    await db.destroy()
  }
}

async function listSoftDeleted(
  db: any,
  tableName: string,
  deletedAtColumn: string,
  options: SoftDeletedOptions
): Promise<void> {
  const listSpinner = spinner()
  listSpinner.start('Fetching soft-deleted records...')

  try {
    // Build query
    let query = db
      .selectFrom(tableName)
      .selectAll()
      .where(deletedAtColumn, 'is not', null)

    // Apply filters
    if (options.since) {
      const sinceDate = new Date(options.since)
      query = query.where(deletedAtColumn, '>=', sinceDate)
    }

    if (options.until) {
      const untilDate = new Date(options.until)
      query = query.where(deletedAtColumn, '<=', untilDate)
    }

    if (options.ids) {
      const ids = options.ids.split(',').map(id => id.trim())
      query = query.where('id', 'in', ids)
    }

    // Order by deletion time
    query = query.orderBy(deletedAtColumn, 'desc')

    // Apply limit
    const limit = parseInt(options.limit || '100', 10)
    query = query.limit(limit)

    // Execute query
    const records = await query.execute()

    listSpinner.succeed(`Found ${records.length} soft-deleted record${records.length !== 1 ? 's' : ''}`)

    if (records.length === 0) {
      console.log(prism.gray('No soft-deleted records found'))
      return
    }

    // Display results
    if (options.json) {
      console.log(JSON.stringify(records, null, 2))
    } else {
      console.log('')
      console.log(prism.bold(`🗑️  Soft-Deleted Records in ${tableName}`))
      console.log(prism.gray('─'.repeat(60)))

      // Format records for display
      const displayRecords = records.map((record: any) => {
        const formatted: any = {
          ID: record.id,
          'Deleted At': formatDate(record[deletedAtColumn])
        }

        // Add a few key fields
        const keyFields = Object.keys(record)
          .filter(k => !['id', deletedAtColumn].includes(k))
          .slice(0, 3)

        for (const field of keyFields) {
          const value = record[field]
          if (value === null) {
            formatted[field] = prism.gray('NULL')
          } else if (typeof value === 'string' && value.length > 30) {
            formatted[field] = value.substring(0, 27) + '...'
          } else {
            formatted[field] = String(value)
          }
        }

        return formatted
      })

      console.log(table(displayRecords))

      // Show actions
      console.log('')
      console.log(prism.cyan('Available Actions:'))
      console.log('  • Restore: kysera query soft-deleted', tableName, '--action restore --ids <id1,id2,...>')
      console.log('  • Purge:   kysera query soft-deleted', tableName, '--action purge --ids <id1,id2,...>')
      console.log('  • Stats:   kysera query soft-deleted', tableName, '--action stats')

      if (records.length >= limit) {
        console.log('')
        console.log(prism.gray(`Showing first ${limit} records. Use --limit to show more.`))
      }
    }

  } catch (error) {
    listSpinner.fail('Failed to fetch soft-deleted records')
    throw error
  }
}

async function restoreSoftDeleted(
  db: any,
  tableName: string,
  deletedAtColumn: string,
  options: SoftDeletedOptions
): Promise<void> {
  const restoreSpinner = spinner()
  restoreSpinner.start('Preparing to restore records...')

  try {
    // Build query to find records to restore
    let query = db
      .selectFrom(tableName)
      .selectAll()
      .where(deletedAtColumn, 'is not', null)

    if (options.ids) {
      const ids = options.ids.split(',').map(id => id.trim())
      query = query.where('id', 'in', ids)
    } else if (options.since || options.until) {
      if (options.since) {
        query = query.where(deletedAtColumn, '>=', new Date(options.since))
      }
      if (options.until) {
        query = query.where(deletedAtColumn, '<=', new Date(options.until))
      }
    } else {
      restoreSpinner.fail('No records specified')
      console.log('')
      console.log(prism.yellow('Please specify records to restore:'))
      console.log('  --ids <list>     Restore specific IDs')
      console.log('  --since <date>   Restore records deleted since date')
      console.log('  --until <date>   Restore records deleted until date')
      return
    }

    // Get records to restore
    const records = await query.execute()

    if (records.length === 0) {
      restoreSpinner.warn('No records found to restore')
      return
    }

    restoreSpinner.succeed(`Found ${records.length} record${records.length !== 1 ? 's' : ''} to restore`)

    // Show preview
    console.log('')
    console.log(prism.cyan('Records to Restore:'))
    for (const record of records.slice(0, 10)) {
      console.log(`  • ID: ${record.id} (deleted ${formatDate(record[deletedAtColumn])})`)
    }
    if (records.length > 10) {
      console.log(`  ... and ${records.length - 10} more`)
    }

    // Dry run mode
    if (options.dryRun) {
      console.log('')
      console.log(prism.yellow('Dry run mode - no changes were made'))
      return
    }

    // Confirm restore
    if (!options.force) {
      console.log('')
      const confirmed = await confirm({
        message: `Restore ${records.length} record${records.length !== 1 ? 's' : ''}?`,
        initialValue: false
      })

      if (!confirmed) {
        console.log(prism.gray('Restore cancelled'))
        return
      }
    }

    // Execute restore
    const executeSpinner = spinner()
    executeSpinner.start('Restoring records...')

    const ids = records.map(r => r.id)
    await db
      .updateTable(tableName)
      .set({ [deletedAtColumn]: null })
      .where('id', 'in', ids)
      .execute()

    executeSpinner.succeed(`Restored ${records.length} record${records.length !== 1 ? 's' : ''}`)

    // Log to audit if available
    if (await tableExists(db, 'audit_logs')) {
      await db
        .insertInto('audit_logs')
        .values({
          table_name: tableName,
          action: 'RESTORE',
          entity_id: ids.length === 1 ? ids[0] : `${ids.length} records`,
          user_id: 'system',
          metadata: JSON.stringify({ restored_ids: ids }),
          created_at: new Date()
        })
        .execute()
    }

  } catch (error) {
    restoreSpinner.fail('Failed to restore records')
    throw error
  }
}

async function purgeSoftDeleted(
  db: any,
  tableName: string,
  deletedAtColumn: string,
  options: SoftDeletedOptions
): Promise<void> {
  const purgeSpinner = spinner()
  purgeSpinner.start('Preparing to purge records...')

  try {
    // Build query to find records to purge
    let query = db
      .selectFrom(tableName)
      .selectAll()
      .where(deletedAtColumn, 'is not', null)

    if (options.ids) {
      const ids = options.ids.split(',').map(id => id.trim())
      query = query.where('id', 'in', ids)
    } else if (options.since || options.until) {
      if (options.since) {
        query = query.where(deletedAtColumn, '>=', new Date(options.since))
      }
      if (options.until) {
        query = query.where(deletedAtColumn, '<=', new Date(options.until))
      }
    } else {
      // Default: purge records older than 30 days
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      query = query.where(deletedAtColumn, '<=', thirtyDaysAgo)
    }

    // Get records to purge
    const records = await query.execute()

    if (records.length === 0) {
      purgeSpinner.warn('No records found to purge')
      return
    }

    purgeSpinner.succeed(`Found ${records.length} record${records.length !== 1 ? 's' : ''} to purge`)

    // Show preview
    console.log('')
    console.log(prism.red('⚠️  WARNING: Permanent Deletion'))
    console.log(prism.gray('These records will be permanently deleted:'))
    console.log('')
    for (const record of records.slice(0, 10)) {
      console.log(`  • ID: ${record.id} (deleted ${formatDate(record[deletedAtColumn])})`)
    }
    if (records.length > 10) {
      console.log(`  ... and ${records.length - 10} more`)
    }

    // Dry run mode
    if (options.dryRun) {
      console.log('')
      console.log(prism.yellow('Dry run mode - no changes were made'))
      return
    }

    // Confirm purge
    if (!options.force) {
      console.log('')
      const confirmed = await confirm({
        message: prism.red(`Permanently delete ${records.length} record${records.length !== 1 ? 's' : ''}?`),
        initialValue: false
      })

      if (!confirmed) {
        console.log(prism.gray('Purge cancelled'))
        return
      }

      // Double confirmation for large purges
      if (records.length > 100) {
        const doubleConfirmed = await confirm({
          message: prism.red('This will delete over 100 records. Are you absolutely sure?'),
          initialValue: false
        })

        if (!doubleConfirmed) {
          console.log(prism.gray('Purge cancelled'))
          return
        }
      }
    }

    // Execute purge
    const executeSpinner = spinner()
    executeSpinner.start('Purging records...')

    const ids = records.map(r => r.id)

    // Log to audit before deletion if available
    if (await tableExists(db, 'audit_logs')) {
      for (const record of records) {
        await db
          .insertInto('audit_logs')
          .values({
            table_name: tableName,
            action: 'PURGE',
            entity_id: record.id,
            old_values: JSON.stringify(record),
            user_id: 'system',
            created_at: new Date()
          })
          .execute()
      }
    }

    // Delete records
    await db
      .deleteFrom(tableName)
      .where('id', 'in', ids)
      .execute()

    executeSpinner.succeed(`Purged ${records.length} record${records.length !== 1 ? 's' : ''}`)

    // Show storage reclaimed (estimate)
    const estimatedSize = records.length * 500 // Assume 500 bytes per record
    console.log(prism.gray(`Estimated space reclaimed: ${formatBytes(estimatedSize)}`))

  } catch (error) {
    purgeSpinner.fail('Failed to purge records')
    throw error
  }
}

async function showSoftDeleteStats(
  db: any,
  tableName: string,
  deletedAtColumn: string,
  options: SoftDeletedOptions
): Promise<void> {
  const statsSpinner = spinner()
  statsSpinner.start('Calculating soft delete statistics...')

  try {
    // Get total count
    const totalResult = await db
      .selectFrom(tableName)
      .select(db.fn.countAll().as('count'))
      .where(deletedAtColumn, 'is not', null)
      .executeTakeFirst()
    const totalDeleted = Number(totalResult?.count || 0)

    if (totalDeleted === 0) {
      statsSpinner.succeed('No soft-deleted records found')
      return
    }

    // Get date ranges
    const now = new Date()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const weekAgo = new Date(now)
    weekAgo.setDate(weekAgo.getDate() - 7)
    const monthAgo = new Date(now)
    monthAgo.setMonth(monthAgo.getMonth() - 1)

    // Get counts by period
    const todayResult = await db
      .selectFrom(tableName)
      .select(db.fn.countAll().as('count'))
      .where(deletedAtColumn, '>=', today)
      .executeTakeFirst()
    const deletedToday = Number(todayResult?.count || 0)

    const weekResult = await db
      .selectFrom(tableName)
      .select(db.fn.countAll().as('count'))
      .where(deletedAtColumn, '>=', weekAgo)
      .executeTakeFirst()
    const deletedThisWeek = Number(weekResult?.count || 0)

    const monthResult = await db
      .selectFrom(tableName)
      .select(db.fn.countAll().as('count'))
      .where(deletedAtColumn, '>=', monthAgo)
      .executeTakeFirst()
    const deletedThisMonth = Number(monthResult?.count || 0)

    // Get oldest and newest deletions
    const oldestResult = await db
      .selectFrom(tableName)
      .select(deletedAtColumn)
      .where(deletedAtColumn, 'is not', null)
      .orderBy(deletedAtColumn, 'asc')
      .limit(1)
      .executeTakeFirst()
    const oldestDeletion = oldestResult ? new Date(oldestResult[deletedAtColumn]) : undefined

    const newestResult = await db
      .selectFrom(tableName)
      .select(deletedAtColumn)
      .where(deletedAtColumn, 'is not', null)
      .orderBy(deletedAtColumn, 'desc')
      .limit(1)
      .executeTakeFirst()
    const newestDeletion = newestResult ? new Date(newestResult[deletedAtColumn]) : undefined

    statsSpinner.succeed('Statistics calculated')

    // Display results
    if (options.json) {
      const stats: SoftDeleteStats = {
        table: tableName,
        totalDeleted,
        deletedToday,
        deletedThisWeek,
        deletedThisMonth,
        oldestDeletion,
        newestDeletion,
        storageSize: totalDeleted * 500 // Estimate
      }
      console.log(JSON.stringify(stats, null, 2))
    } else {
      console.log('')
      console.log(prism.bold(`📊 Soft Delete Statistics for ${tableName}`))
      console.log(prism.gray('─'.repeat(60)))

      console.log('')
      console.log(prism.cyan('Overview:'))
      console.log(`  Total Soft-Deleted: ${totalDeleted.toLocaleString()}`)
      console.log(`  Deleted Today: ${deletedToday.toLocaleString()}`)
      console.log(`  Deleted This Week: ${deletedThisWeek.toLocaleString()}`)
      console.log(`  Deleted This Month: ${deletedThisMonth.toLocaleString()}`)

      if (oldestDeletion) {
        console.log(`  Oldest Deletion: ${formatDate(oldestDeletion)}`)
      }
      if (newestDeletion) {
        console.log(`  Newest Deletion: ${formatDate(newestDeletion)}`)
      }

      // Storage estimate
      const estimatedSize = totalDeleted * 500
      console.log('')
      console.log(prism.cyan('Storage:'))
      console.log(`  Estimated Size: ${formatBytes(estimatedSize)}`)

      // Retention recommendations
      console.log('')
      console.log(prism.cyan('Recommendations:'))

      const oldRecords = totalDeleted - deletedThisMonth
      if (oldRecords > 1000) {
        console.log(prism.yellow(`  ⚠ ${oldRecords.toLocaleString()} records are older than 30 days`))
        console.log('    Consider purging old soft-deleted records to reclaim storage')
      }

      if (deletedToday > 100) {
        console.log(prism.yellow(`  ⚠ High deletion rate today (${deletedToday} records)`))
        console.log('    Review deletion patterns to ensure no issues')
      }

      // Suggested actions
      console.log('')
      console.log(prism.gray('Suggested Actions:'))
      console.log('  • List recent deletions: --action list --since yesterday')
      console.log('  • Purge old records: --action purge --until "30 days ago"')
      console.log('  • Restore specific IDs: --action restore --ids <id1,id2>')
    }

  } catch (error) {
    statsSpinner.fail('Failed to calculate statistics')
    throw error
  }
}

async function tableExists(db: any, tableName: string): Promise<boolean> {
  try {
    const tables = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_name', '=', tableName)
      .execute()
    return tables.length > 0
  } catch {
    return false
  }
}

function formatDate(date: any): string {
  if (!date) return 'N/A'
  const d = new Date(date)
  return d.toLocaleString()
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i]
}