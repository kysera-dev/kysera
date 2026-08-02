import { Command } from 'commander'
import { prism, confirm } from '@xec-sh/kit'
import { formatTimestampForDb } from '@kysera/core'
import { spinner } from '../../utils/spinner.js'
import { CLIError, ValidationError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import {
  auditTableExists,
  auditTableMissingHint,
  parseJsonColumn,
  resolveAuditTable,
  type AuditLogRow
} from './shared.js'

export interface RestoreOptions {
  dryRun?: boolean
  force?: boolean
  json?: boolean
  config?: string
}

export function restoreCommand(): Command {
  const cmd = new Command('restore')
    .description('Restore entity from audit log')
    .argument('<audit-log-id>', 'Audit log ID to restore from')
    .option('--dry-run', 'Preview restore without executing')
    .option('--force', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (auditLogId: string, options: RestoreOptions) => {
      try {
        await restoreFromAudit(auditLogId, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to restore from audit: ${error instanceof Error ? error.message : String(error)}`,
          'RESTORE_ERROR'
        )
      }
    })

  return cmd
}

async function restoreFromAudit(auditLogId: string, options: RestoreOptions): Promise<void> {
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
  const restoreSpinner = spinner()
  restoreSpinner.start(`Fetching audit log #${auditLogId}...`)

  try {
    // Validate and parse audit log ID
    const id = parseInt(auditLogId, 10)
    if (isNaN(id)) {
      throw new ValidationError('Invalid audit log ID - must be a number')
    }

    if (!(await auditTableExists(db, auditTable))) {
      restoreSpinner.fail('Audit table not found')
      console.log('')
      for (const line of auditTableMissingHint(auditTable)) {
        console.log(prism.yellow(line))
      }
      return
    }

    // Fetch the audit log entry
    const auditLog = (await db
      .selectFrom(auditTable)
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()) as unknown as AuditLogRow | undefined

    if (!auditLog) {
      restoreSpinner.fail(`Audit log #${auditLogId} not found`)
      return
    }

    restoreSpinner.succeed('Audit log found')

    // Parse the audit log data
    const tableName = auditLog.table_name
    const entityId = auditLog.entity_id
    const action = auditLog.operation
    const oldValues = parseJsonColumn(auditLog.old_values)
    const createdAt = new Date(auditLog.changed_at)

    // Determine what to restore
    let restoreData: Record<string, unknown> | null = null
    let restoreAction = ''

    if (action === 'DELETE') {
      // Restore deleted entity
      restoreData = oldValues
      restoreAction = 'INSERT'
    } else if (action === 'UPDATE') {
      // Restore to previous state
      restoreData = oldValues
      restoreAction = 'UPDATE'
    } else if (action === 'INSERT') {
      // Delete the inserted entity
      restoreAction = 'DELETE'
    }

    // Show restore preview
    console.log('')
    console.log(prism.bold('📝 Audit Log Details:'))
    console.log(prism.gray('─'.repeat(50)))
    console.log(`  ID: ${auditLogId}`)
    console.log(`  Table: ${tableName}`)
    console.log(`  Entity ID: ${entityId}`)
    console.log(`  Operation: ${formatAction(action)}`)
    console.log(`  Timestamp: ${createdAt.toLocaleString()}`)
    console.log(`  User: ${auditLog.changed_by ?? 'system'}`)

    console.log('')
    console.log(prism.bold('🔄 Restore Plan:'))
    console.log(prism.gray('─'.repeat(50)))

    if (restoreAction === 'INSERT') {
      console.log(prism.green('  ✨ Will recreate deleted entity:'))
      if (restoreData) {
        for (const [key, value] of Object.entries(restoreData)) {
          console.log(`    ${key}: ${formatValue(value)}`)
        }
      }
    } else if (restoreAction === 'UPDATE') {
      console.log(prism.yellow('  ✏️  Will restore entity to previous state:'))

      // Check current state
      const currentEntity = await db
        .selectFrom(tableName)
        .selectAll()
        .where('id', '=', entityId)
        .executeTakeFirst()

      if (!currentEntity) {
        console.log(prism.red('  ⚠️  Entity no longer exists in database'))
        console.log(prism.gray('  Consider using a DELETE audit log to restore it'))
        return
      }

      // Show changes
      for (const [key, value] of Object.entries(restoreData ?? {})) {
        const currentValue = currentEntity[key]
        if (currentValue !== value) {
          console.log(`    ${key}: ${formatValue(currentValue)} → ${formatValue(value)}`)
        }
      }
    } else if (restoreAction === 'DELETE') {
      console.log(prism.red('  🗑️  Will delete the inserted entity'))
      console.log(`    Entity ID: ${entityId}`)
    }

    // Dry run mode
    if (options.dryRun) {
      console.log('')
      console.log(prism.yellow('Dry run mode - no changes were made'))

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              auditLog,
              restoreAction,
              restoreData
            },
            null,
            2
          )
        )
      }

      return
    }

    // Confirm restore
    if (!options.force) {
      console.log('')
      const confirmed = await confirm({
        message: 'Are you sure you want to restore from this audit log?',
        initialValue: false
      })

      if (!confirmed) {
        console.log(prism.gray('Restore cancelled'))
        return
      }
    }

    // Execute restore
    const executeSpinner = spinner()
    executeSpinner.start('Executing restore...')

    // Restore entries are written in the plugin's own schema so they show
    // up in `audit logs` / plugin queries like any other entry.
    const restoreMetadata = JSON.stringify({
      restored_from: auditLogId,
      restore_timestamp: new Date().toISOString()
    })
    const changedAt = formatTimestampForDb(new Date(), dialect)

    await db.transaction().execute(async trx => {
      if (restoreAction === 'INSERT') {
        // Recreate deleted entity
        await trx
          .insertInto(tableName)
          .values(restoreData ?? {})
          .execute()

        executeSpinner.succeed('Entity restored successfully')

        // Create audit log for the restore
        await trx
          .insertInto(auditTable)
          .values({
            table_name: tableName,
            entity_id: entityId,
            operation: 'INSERT',
            new_values: JSON.stringify(restoreData),
            changed_by: 'system',
            metadata: restoreMetadata,
            changed_at: changedAt
          })
          .execute()
      } else if (restoreAction === 'UPDATE') {
        // Get current values for audit
        const currentEntity = await trx
          .selectFrom(tableName)
          .selectAll()
          .where('id', '=', entityId)
          .executeTakeFirst()

        // Update to previous state, excluding the id column
        const updateValues = Object.fromEntries(
          Object.entries(restoreData ?? {}).filter(([key]) => key !== 'id')
        )

        await trx.updateTable(tableName).where('id', '=', entityId).set(updateValues).execute()

        executeSpinner.succeed('Entity restored to previous state')

        // Create audit log for the restore
        await trx
          .insertInto(auditTable)
          .values({
            table_name: tableName,
            entity_id: entityId,
            operation: 'UPDATE',
            old_values: JSON.stringify(currentEntity),
            new_values: JSON.stringify(restoreData),
            changed_by: 'system',
            metadata: restoreMetadata,
            changed_at: changedAt
          })
          .execute()
      } else if (restoreAction === 'DELETE') {
        // Get current values for audit
        const currentEntity = await trx
          .selectFrom(tableName)
          .selectAll()
          .where('id', '=', entityId)
          .executeTakeFirst()

        // Delete the entity
        await trx.deleteFrom(tableName).where('id', '=', entityId).execute()

        executeSpinner.succeed('Entity deleted successfully')

        // Create audit log for the restore
        await trx
          .insertInto(auditTable)
          .values({
            table_name: tableName,
            entity_id: entityId,
            operation: 'DELETE',
            old_values: JSON.stringify(currentEntity),
            changed_by: 'system',
            metadata: restoreMetadata,
            changed_at: changedAt
          })
          .execute()
      }
    })

    // Show success message
    console.log('')
    console.log(prism.green('✅ Restore completed successfully'))
    console.log(prism.gray(`Restored from audit log #${auditLogId}`))
    console.log(prism.gray(`Table: ${tableName}, Entity: ${entityId}`))

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            auditLogId,
            tableName,
            entityId,
            restoreAction
          },
          null,
          2
        )
      )
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes(auditTable)) {
      restoreSpinner.fail('Audit table not found')
      console.log('')
      for (const line of auditTableMissingHint(auditTable)) {
        console.log(prism.yellow(line))
      }
      return
    }
    throw error
  } finally {
    // Close database connection
    await db.destroy()
  }
}

function formatAction(action: string): string {
  const colors: Record<string, ((text: string) => string) | undefined> = {
    INSERT: prism.green,
    UPDATE: prism.yellow,
    DELETE: prism.red
  }

  const color = colors[action] ?? prism.white
  return color(action)
}

function formatValue(value: unknown): string {
  switch (typeof value) {
    case 'undefined':
      return prism.gray('undefined')
    case 'string':
      return `"${value}"`
    case 'boolean':
      return value ? prism.green('true') : prism.red('false')
    case 'object':
      if (value === null) return prism.gray('NULL')
      if (value instanceof Date) return value.toISOString()
      return prism.gray(JSON.stringify(value))
    default:
      return String(value)
  }
}
