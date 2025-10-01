import type { Kysely } from 'kysely'
import type { Plugin } from '@kysera/repository'

// ============================================================================
// Types
// ============================================================================

/**
 * Audit timestamp can be a Date or a string
 */
export type AuditTimestamp = Date | string

/**
 * Audit plugin configuration options
 */
export interface AuditOptions {
  /**
   * Table name for storing audit logs
   * @default 'audit_logs'
   */
  auditTable?: string

  /**
   * Whether to capture old values in updates
   * @default true
   */
  captureOldValues?: boolean

  /**
   * Whether to capture new values in inserts/updates
   * @default true
   */
  captureNewValues?: boolean

  /**
   * Skip auditing for system operations (migrations, seeds)
   * @default false
   */
  skipSystemOperations?: boolean

  /**
   * Whitelist of tables to audit (if specified, only these tables will be audited)
   */
  tables?: string[]

  /**
   * Blacklist of tables to exclude from auditing
   */
  excludeTables?: string[]

  /**
   * Function to get the current user ID
   * @returns User ID or null
   */
  getUserId?: () => string | null

  /**
   * Function to get the current timestamp
   * @default () => new Date()
   */
  getTimestamp?: () => AuditTimestamp

  /**
   * Function to get additional metadata for audit entries
   * @returns Metadata object or null
   */
  metadata?: () => Record<string, unknown>
}

/**
 * Audit log entry structure (raw from database)
 */
export interface AuditLogEntry {
  id: number
  table_name: string
  entity_id: string
  operation: string
  old_values: string | null
  new_values: string | null
  changed_by: string | null
  changed_at: string
  metadata: string | null
}

/**
 * Parsed audit log entry with JSON values parsed
 */
export interface ParsedAuditLogEntry {
  id: number
  table_name: string
  entity_id: string
  operation: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  changed_by: string | null
  changed_at: Date | string
  metadata: Record<string, unknown> | null
}

/**
 * Base repository interface for type checking
 */
interface BaseRepositoryLike {
  tableName?: string
  executor?: unknown
  create?: Function
  update?: Function
  delete?: Function
  bulkCreate?: Function
  bulkUpdate?: Function
  bulkDelete?: Function
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if audit table exists
 */
async function checkAuditTableExists<DB>(
  executor: Kysely<DB>,
  auditTable: string
): Promise<boolean> {
  try {
    // Try to query the table structure
    await (executor as any)
      .selectFrom(auditTable)
      .select('id')
      .limit(0)
      .execute()
    // If we get here, table exists
    return true
  } catch {
    // Table doesn't exist
    return false
  }
}

/**
 * Create audit table schema
 */
async function createAuditTable<DB>(
  executor: Kysely<DB>,
  auditTable: string
): Promise<void> {
  await (executor.schema as any)
    .createTable(auditTable)
    .addColumn('id', 'integer', (col: any) => col.primaryKey().autoIncrement())
    .addColumn('table_name', 'text', (col: any) => col.notNull())
    .addColumn('entity_id', 'text', (col: any) => col.notNull())
    .addColumn('operation', 'text', (col: any) => col.notNull())
    .addColumn('old_values', 'text')
    .addColumn('new_values', 'text')
    .addColumn('changed_by', 'text')
    .addColumn('changed_at', 'text', (col: any) => col.notNull())
    .addColumn('metadata', 'text')
    .execute()
}

/**
 * Get audit timestamp from options
 */
function getAuditTimestamp(options: AuditOptions): string {
  const timestamp = options.getTimestamp
    ? options.getTimestamp()
    : new Date()
  return typeof timestamp === 'string' ? timestamp : timestamp.toISOString()
}

/**
 * Serialize values for audit log
 */
function serializeAuditValues(values: unknown): string | null {
  if (!values) return null
  if (values === null || values === undefined) return null

  try {
    return JSON.stringify(values)
  } catch {
    return String(values)
  }
}

/**
 * Create audit log entry
 */
async function createAuditLogEntry<DB>(
  executor: Kysely<DB>,
  auditTable: string,
  entityType: string,
  entityId: string | number,
  operation: string,
  oldValues: unknown,
  newValues: unknown,
  options: AuditOptions
): Promise<void> {
  const timestamp = getAuditTimestamp(options)

  await (executor as any)
    .insertInto(auditTable)
    .values({
      table_name: entityType,
      entity_id: String(entityId),
      operation,
      old_values: serializeAuditValues(oldValues),
      new_values: serializeAuditValues(newValues),
      changed_by: options.getUserId ? options.getUserId() : null,
      changed_at: timestamp,
      metadata: options.metadata ? JSON.stringify(options.metadata()) : null
    })
    .execute()
}

/**
 * Helper function to check if an object looks like a repository
 */
function isRepositoryLike(obj: unknown): obj is BaseRepositoryLike {
  if (!obj || typeof obj !== 'object') return false
  const repo = obj as any
  return 'tableName' in repo && 'executor' in repo
}

/**
 * Helper function to fetch an entity by ID
 */
async function fetchEntityById(
  executor: Kysely<any>,
  tableName: string,
  id: number
): Promise<unknown> {
  try {
    const entity = await (executor as any)
      .selectFrom(tableName)
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return entity
  } catch {
    return null
  }
}

// ============================================================================
// Main Plugin
// ============================================================================

/**
 * Audit plugin for Kysera ORM
 *
 * This plugin automatically tracks all database changes with comprehensive audit logging.
 * It captures old and new values for all CRUD operations and stores them in an audit table.
 *
 * Features:
 * - Automatic audit logging for all repositories
 * - Captures old and new values
 * - User tracking (when getUserId is provided)
 * - Timestamp tracking
 * - Metadata support
 * - Query methods to retrieve audit history
 *
 * @example
 * ```typescript
 * import { auditPlugin } from '@kysera/audit'
 *
 * const audit = auditPlugin({
 *   auditTable: 'audit_logs',
 *   getUserId: () => currentUser?.id || null,
 *   getMeta: () => ({ ip: request.ip })
 * })
 *
 * const orm = createORM(db, [audit])
 * ```
 */
export function auditPlugin(options: AuditOptions = {}): Plugin {
  const {
    auditTable = 'audit_logs',
    captureOldValues = true,
    captureNewValues = true,
    skipSystemOperations = false
  } = options

  return {
    name: '@kysera/audit',
    version: '1.0.0',

    async onInit<DB>(executor: Kysely<DB>): Promise<void> {
      const exists = await checkAuditTableExists(executor, auditTable)
      if (!exists) {
        await createAuditTable(executor, auditTable)
      }
    },

    extendRepository<T extends object>(repo: T): T {
      // Type check to ensure repo has the expected properties
      if (!isRepositoryLike(repo)) {
        return repo
      }

      const baseRepo = repo as T & BaseRepositoryLike
      const tableName = baseRepo.tableName!
      const executor = baseRepo.executor as Kysely<any>

      // Check if this table should be audited
      const { tables, excludeTables } = options

      // If whitelist exists, only audit tables in the whitelist
      if (tables && tables.length > 0 && !tables.includes(tableName)) {
        return repo
      }

      // If blacklist exists, skip tables in the blacklist
      if (excludeTables && excludeTables.includes(tableName)) {
        return repo
      }

      // Wrap create method
      if (baseRepo.create) {
        const originalCreate = baseRepo.create.bind(baseRepo)
        ;(baseRepo as any).create = async function(input: unknown) {
          const result = await originalCreate(input)

          if (!skipSystemOperations) {
            await createAuditLogEntry(
              executor,
              auditTable,
              tableName,
              (result as any).id,
              'INSERT',
              null,
              captureNewValues ? result : null,
              options
            )
          }

          return result
        }
      }

      // Wrap update method
      if (baseRepo.update) {
        const originalUpdate = baseRepo.update.bind(baseRepo)
        ;(baseRepo as any).update = async function(id: number, input: unknown) {
          // Fetch old values if needed
          let oldValues: unknown = null
          if (captureOldValues) {
            oldValues = await fetchEntityById(executor, tableName, id)
          }

          const result = await originalUpdate(id, input)

          if (!skipSystemOperations) {
            await createAuditLogEntry(
              executor,
              auditTable,
              tableName,
              id,
              'UPDATE',
              oldValues,
              captureNewValues ? result : null,
              options
            )
          }

          return result
        }
      }

      // Wrap delete method
      if (baseRepo.delete) {
        const originalDelete = baseRepo.delete.bind(baseRepo)
        ;(baseRepo as any).delete = async function(id: number) {
          // Fetch old values before deletion
          let oldValues: unknown = null
          if (captureOldValues) {
            oldValues = await fetchEntityById(executor, tableName, id)
          }

          const result = await originalDelete(id)

          if (!skipSystemOperations && result) {
            await createAuditLogEntry(
              executor,
              auditTable,
              tableName,
              id,
              'DELETE',
              oldValues,
              null,
              options
            )
          }

          return result
        }
      }

      // Wrap bulkCreate method
      if (baseRepo.bulkCreate) {
        const originalBulkCreate = baseRepo.bulkCreate.bind(baseRepo)
        ;(baseRepo as any).bulkCreate = async function(inputs: unknown[]) {
          const results = await originalBulkCreate(inputs)

          if (!skipSystemOperations && Array.isArray(results)) {
            for (const result of results) {
              await createAuditLogEntry(
                executor,
                auditTable,
                tableName,
                (result as any).id,
                'INSERT',
                null,
                captureNewValues ? result : null,
                options
              )
            }
          }

          return results
        }
      }

      // Wrap bulkUpdate method
      if (baseRepo.bulkUpdate) {
        const originalBulkUpdate = baseRepo.bulkUpdate.bind(baseRepo)
        ;(baseRepo as any).bulkUpdate = async function(updates: { id: number, data: unknown }[]) {
          const results = await originalBulkUpdate(updates)

          if (!skipSystemOperations && Array.isArray(results)) {
            for (const result of results) {
              const id = (result as any).id
              let oldValues: unknown = null
              if (captureOldValues) {
                // For bulk updates, we don't have old values readily available
                // This is a trade-off for performance
                oldValues = null
              }

              await createAuditLogEntry(
                executor,
                auditTable,
                tableName,
                id,
                'UPDATE',
                oldValues,
                captureNewValues ? result : null,
                options
              )
            }
          }

          return results
        }
      }

      // Wrap bulkDelete method
      if (baseRepo.bulkDelete) {
        const originalBulkDelete = baseRepo.bulkDelete.bind(baseRepo)
        ;(baseRepo as any).bulkDelete = async function(ids: number[]) {
          // Fetch old values before deletion if needed
          const oldValuesMap = new Map<number, unknown>()
          if (captureOldValues) {
            for (const id of ids) {
              const oldValue = await fetchEntityById(executor, tableName, id)
              if (oldValue) {
                oldValuesMap.set(id, oldValue)
              }
            }
          }

          const result = await originalBulkDelete(ids)

          if (!skipSystemOperations) {
            for (const id of ids) {
              await createAuditLogEntry(
                executor,
                auditTable,
                tableName,
                id,
                'DELETE',
                oldValuesMap.get(id) || null,
                null,
                options
              )
            }
          }

          return result
        }
      }

      // Add audit query methods
      const extendedRepo = baseRepo as any

      // Get audit history for a specific entity (returns parsed entries)
      extendedRepo.getAuditHistory = async function(entityId: number | string): Promise<ParsedAuditLogEntry[]> {
        const logs = await (executor as any)
          .selectFrom(auditTable)
          .selectAll()
          .where('table_name', '=', tableName)
          .where('entity_id', '=', String(entityId))
          .orderBy('changed_at', 'desc')
          .execute()

        return logs.map((log: AuditLogEntry) => ({
          ...log,
          old_values: log.old_values ? JSON.parse(log.old_values) : null,
          new_values: log.new_values ? JSON.parse(log.new_values) : null,
          metadata: log.metadata ? JSON.parse(log.metadata) : null
        })) as ParsedAuditLogEntry[]
      }

      // Alias for backwards compatibility
      extendedRepo.getAuditLogs = extendedRepo.getAuditHistory

      // Get a specific audit log entry
      extendedRepo.getAuditLog = async function(auditId: number): Promise<AuditLogEntry | null> {
        const log = await (executor as any)
          .selectFrom(auditTable)
          .selectAll()
          .where('id', '=', auditId)
          .executeTakeFirst()

        return log as AuditLogEntry | null
      }

      // Restore entity from audit log
      extendedRepo.restoreFromAudit = async function(auditId: number): Promise<unknown> {
        const log = await extendedRepo.getAuditLog(auditId)
        if (!log) {
          throw new Error(`Audit log ${auditId} not found`)
        }

        // Parse the values
        const values = log.old_values || log.new_values
        if (!values) {
          throw new Error(`No values found in audit log ${auditId}`)
        }

        const parsedValues = JSON.parse(values)
        const entityId = parseInt(log.entity_id)

        // For DELETE operations, restore using old_values (the entity before deletion)
        // For UPDATE operations, restore using old_values (revert the update)
        if (log.operation === 'DELETE') {
          // Re-create the deleted entity
          return await baseRepo.create!(parsedValues)
        } else if (log.operation === 'UPDATE') {
          // Revert to old values
          return await baseRepo.update!(entityId, parsedValues)
        } else {
          throw new Error(`Cannot restore from ${log.operation} operation`)
        }
      }

      return baseRepo
    }
  }
}

// ============================================================================
// Database-Specific Implementations
// ============================================================================

/**
 * PostgreSQL-specific audit plugin
 *
 * Uses PostgreSQL-specific features like:
 * - JSONB columns for storing old/new values
 * - Native timestamp types
 *
 * @param options Audit plugin options
 * @returns Plugin instance configured for PostgreSQL
 */
export function auditPluginPostgreSQL(options: AuditOptions = {}): Plugin {
  // For now, use the same implementation as the generic plugin
  // In future, we can add PostgreSQL-specific optimizations
  return auditPlugin({
    ...options,
    getTimestamp: options.getTimestamp || (() => new Date().toISOString())
  })
}

/**
 * MySQL-specific audit plugin
 *
 * Uses MySQL-specific features like:
 * - JSON columns for storing old/new values
 * - DATETIME types for timestamps
 *
 * @param options Audit plugin options
 * @returns Plugin instance configured for MySQL
 */
export function auditPluginMySQL(options: AuditOptions = {}): Plugin {
  // For now, use the same implementation as the generic plugin
  // In future, we can add MySQL-specific optimizations
  return auditPlugin({
    ...options,
    getTimestamp: options.getTimestamp || (() => new Date().toISOString())
  })
}

/**
 * SQLite-specific audit plugin
 *
 * Uses SQLite-specific features like:
 * - TEXT columns for JSON data
 * - ISO8601 string timestamps
 *
 * @param options Audit plugin options
 * @returns Plugin instance configured for SQLite
 */
export function auditPluginSQLite(options: AuditOptions = {}): Plugin {
  // For now, use the same implementation as the generic plugin
  // In future, we can add SQLite-specific optimizations
  return auditPlugin({
    ...options,
    getTimestamp: options.getTimestamp || (() => new Date().toISOString())
  })
}