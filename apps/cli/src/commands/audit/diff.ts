import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { spinner } from '../../utils/spinner.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'

export interface DiffOptions {
  json?: boolean
  unified?: boolean
  color?: boolean
  config?: string
}

/** Row shape of the audit_logs table as queried by the audit commands. */
interface AuditLogRow {
  id: number
  table_name: string
  entity_id: string
  action: string
  old_values: unknown
  new_values: unknown
  user_id: string | null
  created_at: string | Date
  metadata: unknown
}

/** Reconstructed entity state; null means the entity was deleted at that point. */
type EntityState = Record<string, unknown> | null

interface EntityDiff {
  added: string[]
  removed: string[]
  changed: { field: string; from: unknown; to: unknown }[]
  unchanged: string[]
}

export function diffCommand(): Command {
  const cmd = new Command('diff')
    .description('Show entity diff between audit entries')
    .argument('<table>', 'Table name')
    .argument('<id>', 'Entity ID')
    .argument('[from]', 'From audit log ID or timestamp')
    .argument('[to]', 'To audit log ID or timestamp')
    .option('--json', 'Output as JSON')
    .option('-u, --unified', 'Show unified diff format')
    .option('--no-color', 'Disable colored output')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(
      async (
        table: string,
        entityId: string,
        from: string | undefined,
        to: string | undefined,
        options: DiffOptions
      ) => {
        try {
          await showEntityDiff(table, entityId, from, to, options)
        } catch (error) {
          if (error instanceof CLIError) {
            throw error
          }
          throw new CLIError(
            `Failed to show entity diff: ${error instanceof Error ? error.message : String(error)}`,
            'DIFF_ERROR'
          )
        }
      }
    )

  return cmd
}

async function showEntityDiff(
  tableName: string,
  entityId: string,
  from: string | undefined,
  to: string | undefined,
  options: DiffOptions
): Promise<void> {
  // Load configuration
  const config = await loadConfig(options.config)

  if (!config.database) {
    throw new CLIError('Database configuration not found', 'CONFIG_ERROR', [
      'Create a kysera.config.ts file with database configuration',
      'Or specify a config file with --config option'
    ])
  }

  // Get database connection
  const db = await getDatabaseConnection(config.database)

  if (!db) {
    throw new CLIError('Failed to connect to database', 'DATABASE_ERROR', [
      'Check your database configuration',
      'Ensure the database server is running'
    ])
  }

  const diffSpinner = spinner()
  diffSpinner.start('Fetching entity history...')

  try {
    // Get all audit logs for the entity
    const history = (await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('table_name', '=', tableName)
      .where('entity_id', '=', entityId)
      .orderBy('created_at', 'asc')
      .execute()) as unknown as AuditLogRow[]

    if (history.length === 0) {
      diffSpinner.fail(`No audit history found for ${tableName} #${entityId}`)
      return
    }

    diffSpinner.succeed(`Found ${history.length} audit entries`)

    // Determine the range to diff
    let fromLog: AuditLogRow | undefined
    let toLog: AuditLogRow | undefined

    if (from && to) {
      // Both specified
      fromLog = findLogByIdOrTime(history, from)
      toLog = findLogByIdOrTime(history, to)
    } else if (from) {
      // Only from specified, diff to latest
      fromLog = findLogByIdOrTime(history, from)
      toLog = history[history.length - 1]
    } else if (to) {
      // Only to specified, diff from earliest
      fromLog = history[0]
      toLog = findLogByIdOrTime(history, to)
    } else {
      // Neither specified, diff first to last
      if (history.length < 2) {
        diffSpinner.warn('Need at least 2 audit entries to show diff')
        return
      }
      fromLog = history[0]
      toLog = history[history.length - 1]
    }

    if (!fromLog || !toLog) {
      throw new CLIError('Could not find specified audit logs', 'LOGS_NOT_FOUND')
    }

    // Build state at each point
    const fromState = buildStateAtPoint(history, fromLog.id)
    const toState = buildStateAtPoint(history, toLog.id)

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            from: {
              id: fromLog.id,
              timestamp: fromLog.created_at,
              state: fromState
            },
            to: {
              id: toLog.id,
              timestamp: toLog.created_at,
              state: toState
            },
            diff: calculateDiff(fromState, toState)
          },
          null,
          2
        )
      )
      return
    }

    // Display diff
    console.log('')
    console.log(prism.bold(`🔄 Entity Diff: ${tableName} #${entityId}`))
    console.log(prism.gray('─'.repeat(60)))
    console.log(`  From: Audit #${fromLog.id} (${formatDate(fromLog.created_at)})`)
    console.log(`  To:   Audit #${toLog.id} (${formatDate(toLog.created_at)})`)
    console.log(prism.gray('─'.repeat(60)))

    if (options.unified) {
      // Unified diff format
      console.log('')
      showUnifiedDiff(fromState, toState, fromLog, toLog, tableName, entityId)
    } else {
      // Side-by-side diff
      console.log('')
      showSideBySideDiff(fromState, toState, options.color !== false)
    }

    // Summary
    const diff = calculateDiff(fromState, toState)
    console.log('')
    console.log(prism.gray('─'.repeat(60)))
    console.log(prism.gray('Summary:'))
    console.log(`  Added fields: ${diff.added.length}`)
    console.log(`  Removed fields: ${diff.removed.length}`)
    console.log(`  Changed fields: ${diff.changed.length}`)
    console.log(`  Unchanged fields: ${diff.unchanged.length}`)
  } catch (error) {
    if (error instanceof Error && error.message.includes('audit_logs')) {
      diffSpinner.fail('Audit logs table not found')
      console.log('')
      console.log(prism.yellow('The audit_logs table does not exist.'))
      return
    }
    throw error
  } finally {
    // Close database connection
    await db.destroy()
  }
}

function findLogByIdOrTime(history: AuditLogRow[], idOrTime: string): AuditLogRow | undefined {
  // Try as ID first
  const asId = parseInt(idOrTime, 10)
  if (!isNaN(asId)) {
    return history.find(log => log.id === asId)
  }

  // Try as timestamp
  const asDate = new Date(idOrTime)
  if (!isNaN(asDate.getTime())) {
    // Find closest log to this timestamp
    let closest = history[0]
    let minDiff = Math.abs(new Date(closest.created_at).getTime() - asDate.getTime())

    for (const log of history) {
      const diff = Math.abs(new Date(log.created_at).getTime() - asDate.getTime())
      if (diff < minDiff) {
        minDiff = diff
        closest = log
      }
    }
    return closest
  }

  return undefined
}

function buildStateAtPoint(history: AuditLogRow[], upToId: number): EntityState {
  let state: EntityState = {}

  for (const log of history) {
    if (log.id > upToId) break

    const newValues = parseJson(log.new_values)

    if (log.action === 'INSERT') {
      // Set initial state
      state = { ...newValues }
    } else if (log.action === 'UPDATE') {
      // Apply updates
      state = { ...state, ...newValues }
    } else if (log.action === 'DELETE') {
      // Entity was deleted at this point
      state = null
    }
  }

  return state
}

function calculateDiff(fromState: EntityState, toState: EntityState): EntityDiff {
  const diff: EntityDiff = {
    added: [],
    removed: [],
    changed: [],
    unchanged: []
  }

  if (!fromState) {
    if (!toState) {
      return diff
    }
    // Entity was created
    diff.added = Object.keys(toState)
    return diff
  }

  if (!toState) {
    // Entity was deleted
    diff.removed = Object.keys(fromState)
    return diff
  }

  const allKeys = new Set([...Object.keys(fromState), ...Object.keys(toState)])

  for (const key of allKeys) {
    if (!(key in fromState)) {
      diff.added.push(key)
    } else if (!(key in toState)) {
      diff.removed.push(key)
    } else if (JSON.stringify(fromState[key]) !== JSON.stringify(toState[key])) {
      diff.changed.push({
        field: key,
        from: fromState[key],
        to: toState[key]
      })
    } else {
      diff.unchanged.push(key)
    }
  }

  return diff
}

function showSideBySideDiff(fromState: EntityState, toState: EntityState, useColor: boolean): void {
  if (!fromState) {
    if (!toState) {
      console.log(prism.gray('No state at either point'))
      return
    }

    console.log(prism.green('Entity created with:'))
    for (const [key, value] of Object.entries(toState)) {
      console.log(`  + ${key}: ${formatValue(value)}`)
    }
    return
  }

  if (!toState) {
    console.log(prism.red('Entity deleted with:'))
    for (const [key, value] of Object.entries(fromState)) {
      console.log(`  - ${key}: ${formatValue(value)}`)
    }
    return
  }

  const diff = calculateDiff(fromState, toState)

  // Show changes
  for (const change of diff.changed) {
    if (useColor) {
      console.log(
        `  ${prism.yellow('~')} ${change.field}: ${formatValue(change.from)} → ${formatValue(change.to)}`
      )
    } else {
      console.log(`  ~ ${change.field}: ${formatValue(change.from)} → ${formatValue(change.to)}`)
    }
  }

  // Show additions
  for (const field of diff.added) {
    if (useColor) {
      console.log(`  ${prism.green('+')} ${field}: ${formatValue(toState[field])}`)
    } else {
      console.log(`  + ${field}: ${formatValue(toState[field])}`)
    }
  }

  // Show removals
  for (const field of diff.removed) {
    if (useColor) {
      console.log(`  ${prism.red('-')} ${field}: ${formatValue(fromState[field])}`)
    } else {
      console.log(`  - ${field}: ${formatValue(fromState[field])}`)
    }
  }
}

function showUnifiedDiff(
  fromState: EntityState,
  toState: EntityState,
  fromLog: AuditLogRow,
  toLog: AuditLogRow,
  table: string,
  entityId: string
): void {
  console.log(`--- ${table}/${entityId} (Audit #${fromLog.id})`)
  console.log(`+++ ${table}/${entityId} (Audit #${toLog.id})`)
  console.log(
    `@@ -${fromLog.id},${String(fromLog.created_at)} +${toLog.id},${String(toLog.created_at)} @@`
  )

  if (!fromState) {
    if (!toState) {
      // No state at either point: nothing beyond the headers to print
      return
    }

    console.log(prism.green('+Entity created'))
    for (const [key, value] of Object.entries(toState)) {
      console.log(prism.green(`+${key}: ${formatValue(value)}`))
    }
    return
  }

  if (!toState) {
    console.log(prism.red('-Entity deleted'))
    for (const [key, value] of Object.entries(fromState)) {
      console.log(prism.red(`-${key}: ${formatValue(value)}`))
    }
    return
  }

  const diff = calculateDiff(fromState, toState)
  const allKeys = [
    ...diff.unchanged,
    ...diff.changed.map(c => c.field),
    ...diff.added,
    ...diff.removed
  ]

  for (const key of allKeys.sort()) {
    if (diff.removed.includes(key)) {
      console.log(prism.red(`-${key}: ${formatValue(fromState[key])}`))
    } else if (diff.added.includes(key)) {
      console.log(prism.green(`+${key}: ${formatValue(toState[key])}`))
    } else if (diff.changed.find(c => c.field === key)) {
      console.log(prism.red(`-${key}: ${formatValue(fromState[key])}`))
      console.log(prism.green(`+${key}: ${formatValue(toState[key])}`))
    } else {
      console.log(` ${key}: ${formatValue(fromState[key])}`)
    }
  }
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return (JSON.parse(value) ?? {}) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return (value ?? {}) as Record<string, unknown>
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleString()
}

function formatValue(value: unknown): string {
  switch (typeof value) {
    case 'undefined':
      return 'undefined'
    case 'string':
      return `"${value}"`
    case 'boolean':
      return value ? 'true' : 'false'
    case 'object':
      if (value === null) return 'NULL'
      if (value instanceof Date) return value.toISOString()
      return JSON.stringify(value)
    default:
      return String(value)
  }
}
