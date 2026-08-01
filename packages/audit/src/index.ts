import type { Kysely } from 'kysely'
import type { Plugin, BaseRepositoryLike } from '@kysera/executor'
import { isRepositoryLike, isKyseraExecutor, getPlugins } from '@kysera/executor'
import { NotFoundError, AuditError, AuditRestoreError, AuditMissingValuesError, shouldApplyToTable, type KyseraLogger, silentLogger, formatTimestampForDb, detectDialect } from '@kysera/core'
import type { Dialect } from '@kysera/core'
import { VERSION } from './version.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Interface for Kysely query builder with dynamic table access
 * This allows runtime table name selection while maintaining some type safety
 */
interface DynamicQueryBuilder {
  selectFrom: (table: string) => DynamicSelectQueryBuilder
  insertInto: (table: string) => DynamicInsertQueryBuilder
  schema: DynamicSchemaBuilder
}

/**
 * Interface for Kysely select query builder with dynamic operations
 */
interface DynamicSelectQueryBuilder {
  selectAll: () => DynamicSelectQueryBuilder
  select: (column: string) => DynamicSelectQueryBuilder
  where: (column: string, operator: string, value: unknown) => DynamicSelectQueryBuilder
  orderBy: (column: string, direction: 'asc' | 'desc') => DynamicSelectQueryBuilder
  limit: (count: number) => DynamicSelectQueryBuilder
  offset: (count: number) => DynamicSelectQueryBuilder
  execute: () => Promise<unknown[]>
  executeTakeFirst: () => Promise<unknown | undefined>
}

/**
 * Interface for Kysely insert query builder with dynamic operations
 */
interface DynamicInsertQueryBuilder {
  values: (values: Record<string, unknown> | Record<string, unknown>[]) => DynamicInsertQueryBuilder
  execute: () => Promise<unknown>
}

/**
 * Interface for Kysely schema builder with dynamic operations
 */
interface DynamicSchemaBuilder {
  createTable: (tableName: string) => DynamicCreateTableBuilder
}

/**
 * Interface for Kysely create table builder with dynamic operations
 */
interface DynamicCreateTableBuilder {
  addColumn: (
    name: string,
    type: string,
    callback?: (col: DynamicColumnBuilder) => DynamicColumnBuilder
  ) => DynamicCreateTableBuilder
  execute: () => Promise<void>
}

/**
 * Interface for Kysely column builder with dynamic operations
 */
interface DynamicColumnBuilder {
  primaryKey: () => DynamicColumnBuilder
  autoIncrement: () => DynamicColumnBuilder
  notNull: () => DynamicColumnBuilder
}

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
   * Primary key column name
   * Supports both numeric IDs and string IDs (e.g., UUIDs)
   * @default 'id'
   */
  primaryKeyColumn?: string

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

  /**
   * Logger for audit operations
   * @default silentLogger
   */
  logger?: KyseraLogger
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
 * Pagination options for audit queries
 */
export interface AuditPaginationOptions {
  /** Maximum number of records to return */
  limit?: number
  /** Number of records to skip (for pagination) */
  offset?: number
}

/**
 * Filters for querying table audit logs
 */
export interface AuditFilters extends AuditPaginationOptions {
  /** Filter by operation type ('INSERT', 'UPDATE', 'DELETE') */
  operation?: string
  /** Filter by user ID (changed_by field) */
  userId?: string
  /** Filter by start date (inclusive) - accepts Date, ISO string, or unix timestamp (ms) */
  startDate?: Date | string | number
  /** Filter by end date (inclusive) - accepts Date, ISO string, or unix timestamp (ms) */
  endDate?: Date | string | number
}

/**
 * Audit repository extension methods added by the audit plugin.
 * Use this interface for type annotations when working with audited repositories.
 *
 * @example
 * ```typescript
 * import type { AuditRepositoryExtensions, ParsedAuditLogEntry } from '@kysera/audit';
 *
 * // Type-safe access to audit methods
 * const userRepo = orm.createRepository(...) as Repository<User, DB> & AuditRepositoryExtensions<User>;
 *
 * const history: ParsedAuditLogEntry[] = await userRepo.getAuditHistory(123);
 * const restored: User = await userRepo.restoreFromAudit(42);
 * ```
 */
export interface AuditRepositoryExtensions<T = unknown> {
  /**
   * Get audit history for a specific entity
   * @param entityId - The entity ID to get history for (supports both numeric and string IDs)
   * @param options - Optional pagination options (limit, offset)
   * @returns Array of parsed audit log entries, most recent first
   */
  getAuditHistory(
    entityId: number | string,
    options?: AuditPaginationOptions
  ): Promise<ParsedAuditLogEntry[]>

  /**
   * Alias for getAuditHistory (backwards compatibility)
   * @param entityId - The entity ID to get history for
   * @param options - Optional pagination options (limit, offset)
   * @returns Array of parsed audit log entries, most recent first
   */
  getAuditLogs(
    entityId: number | string,
    options?: AuditPaginationOptions
  ): Promise<ParsedAuditLogEntry[]>

  /**
   * Get a specific audit log entry by its ID
   * @param auditId - The audit log ID
   * @returns Raw audit log entry or null if not found
   */
  getAuditLog(auditId: number): Promise<AuditLogEntry | null>

  /**
   * Get audit logs for entire table with optional filters and pagination
   * @param filters - Optional filters to apply (includes limit, offset for pagination)
   * @returns Array of parsed audit log entries, most recent first
   */
  getTableAuditLogs(filters?: AuditFilters): Promise<ParsedAuditLogEntry[]>

  /**
   * Get all changes made by a specific user for this table
   * @param userId - The user ID to filter by
   * @param options - Optional pagination options (limit, offset)
   * @returns Array of parsed audit log entries, most recent first
   */
  getUserChanges(userId: string, options?: AuditPaginationOptions): Promise<ParsedAuditLogEntry[]>

  /**
   * Restore entity from audit log.
   *
   * - For DELETE operations: Re-creates the deleted entity using old_values
   * - For UPDATE operations: Reverts entity to old_values (the state before the update)
   * - For INSERT operations: Throws error (cannot restore)
   *
   * @param auditId - The audit log ID to restore from
   * @returns Restored entity
   * @throws Error if audit log not found, operation not restorable, or old_values not captured
   */
  restoreFromAudit(auditId: number): Promise<T>
}

/**
 * Base repository interface for audit plugin with typed methods.
 * Extends BaseRepositoryLike from @kysera/executor with audit-specific bulk operations.
 */
interface AuditBaseRepository<T = unknown> {
  tableName: string
  executor: Kysely<unknown>
  create?: (data: Partial<T>) => Promise<T>
  update?: (id: number | string, data: Partial<T>) => Promise<T>
  delete?: (id: number | string) => Promise<boolean>
  bulkCreate?: (data: Partial<T>[]) => Promise<T[]>
  bulkUpdate?: (updates: { id: number | string; data: Partial<T> }[]) => Promise<T[]>
  bulkDelete?: (ids: (number | string)[]) => Promise<number>
}

/**
 * Optional transaction rebinding exposed by @kysera/repository repositories.
 * Used by the atomic execution path to rebuild the repository on a transaction.
 */
interface TransactionBindableRepository {
  withTransaction?: (trx: Kysely<unknown>) => object
}

/**
 * Audit query methods without restoreFromAudit (which is built separately
 * because it needs the audited create/update methods).
 */
type AuditQueryMethods = Omit<AuditRepositoryExtensions, 'restoreFromAudit'>

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Marker set (non-enumerable) on repositories already extended by the audit
 * plugin. It makes extendRepository idempotent: extending twice would wrap
 * create/update/delete twice and double-write audit entries. Symbol.for() is
 * used so independently loaded copies of this module share the marker.
 */
const AUDIT_EXTENDED = Symbol.for('kysera.audit.extended')

/**
 * Per-executor lock for audit table creation to prevent race conditions.
 * Outer key: Kysely executor instance (WeakMap for automatic cleanup on GC).
 * Inner key: audit table name, Value: Promise that resolves when table creation is complete.
 */
const auditTableCreationLocks = new WeakMap<object, Map<string, Promise<void>>>()

/**
 * Check if audit table exists
 */
async function checkAuditTableExists<DB>(
  executor: Kysely<DB>,
  auditTable: string
): Promise<boolean> {
  try {
    // Try to query the table structure
    // Cast to DynamicQueryBuilder for runtime table access
    const dynamicExecutor = executor as unknown as DynamicQueryBuilder
    await dynamicExecutor.selectFrom(auditTable).select('id').limit(0).execute()
    // If we get here, table exists
    return true
  } catch (error) {
    // Table doesn't exist or query failed - expected behavior for table existence check
    silentLogger.debug('Audit table check failed', {
      auditTable,
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

/**
 * Create audit table schema
 */
async function createAuditTable<DB>(executor: Kysely<DB>, auditTable: string): Promise<void> {
  // Cast to DynamicSchemaBuilder for dynamic table creation with runtime column types
  const dynamicSchema = executor.schema as unknown as DynamicSchemaBuilder
  await dynamicSchema
    .createTable(auditTable)
    .addColumn('id', 'integer', (col: DynamicColumnBuilder) => col.primaryKey().autoIncrement())
    .addColumn('table_name', 'text', (col: DynamicColumnBuilder) => col.notNull())
    .addColumn('entity_id', 'text', (col: DynamicColumnBuilder) => col.notNull())
    .addColumn('operation', 'text', (col: DynamicColumnBuilder) => col.notNull())
    .addColumn('old_values', 'text')
    .addColumn('new_values', 'text')
    .addColumn('changed_by', 'text')
    .addColumn('changed_at', 'text', (col: DynamicColumnBuilder) => col.notNull())
    .addColumn('metadata', 'text')
    .execute()
}

/**
 * Ensure the audit table exists, using a lock to prevent race conditions.
 * The lock map acts as both a mutex and a "verified" cache:
 * - If a promise exists for this executor+table, we just await it (table already created or in progress).
 * - Otherwise we create the promise, store it synchronously, then await it.
 * On success the promise stays cached so subsequent calls take the fast path;
 * on failure the entry is removed so a transient error (e.g. a dropped
 * connection during init) does not poison every future call.
 */
async function ensureAuditTable<DB>(executor: Kysely<DB>, auditTable: string): Promise<void> {
  let tableLocks = auditTableCreationLocks.get(executor)
  if (!tableLocks) {
    tableLocks = new Map<string, Promise<void>>()
    auditTableCreationLocks.set(executor, tableLocks)
  }

  // Fast path: table already verified (or creation in progress)
  if (tableLocks.has(auditTable)) {
    await tableLocks.get(auditTable)
    return
  }

  const promise = (async () => {
    const exists = await checkAuditTableExists(executor, auditTable)
    if (!exists) {
      await createAuditTable(executor, auditTable)
    }
  })()

  tableLocks.set(auditTable, promise)
  // Clear the cache entry on failure so the next caller retries; awaiting
  // `promise` below still surfaces the original rejection to this caller.
  promise.catch(() => {
    tableLocks.delete(auditTable)
  })
  await promise
}

/**
 * Get audit timestamp from options, formatted for the detected dialect.
 */
function getAuditTimestamp(options: AuditOptions, dialect?: Dialect): string {
  const timestamp = options.getTimestamp ? options.getTimestamp() : new Date()
  if (typeof timestamp === 'string') return timestamp
  return formatTimestampForDb(timestamp, dialect)
}

/**
 * Format a date value for use in audit log queries.
 * Handles Date objects, ISO strings, and unix timestamps (milliseconds).
 *
 * @param date - Date value to format
 * @param dialect - Database dialect for correct timestamp formatting
 * @returns Formatted timestamp string appropriate for the dialect
 */
function formatDateForQuery(date: Date | string | number, dialect?: Dialect): string {
  if (typeof date === 'number') {
    return formatTimestampForDb(new Date(date), dialect)
  }
  if (typeof date === 'string') {
    return formatTimestampForDb(new Date(date), dialect)
  }
  return formatTimestampForDb(date, dialect)
}

/**
 * Tag key for values JSON cannot represent natively. Tagged values are stored
 * as `{"$kysera": "<kind>", "value": "<string>"}` and converted back by
 * auditJsonReviver in the restore path, so BigInt and Date round-trip through
 * the audit log instead of throwing (BigInt) or degrading to strings (Date).
 */
const SERIAL_TAG = '$kysera'

/**
 * JSON.stringify replacer implementing the tagged serialization.
 * JSON.stringify calls toJSON() before the replacer, so Dates arrive here
 * already converted to strings; the original value is still available on the
 * holder object (`this[key]`).
 */
function auditJsonReplacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  const original = this[key]
  if (original instanceof Date) {
    return { [SERIAL_TAG]: 'date', value: original.toISOString() }
  }
  if (typeof value === 'bigint') {
    return { [SERIAL_TAG]: 'bigint', value: value.toString() }
  }
  return value
}

/**
 * JSON.parse reviver converting tagged values (see auditJsonReplacer) back to
 * their original types. Used when parsing audit values for restoreFromAudit.
 */
function auditJsonReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'object' && value !== null && SERIAL_TAG in value) {
    const tagged = value as { [SERIAL_TAG]?: unknown; value?: unknown }
    if (tagged[SERIAL_TAG] === 'bigint' && typeof tagged.value === 'string') {
      return BigInt(tagged.value)
    }
    if (tagged[SERIAL_TAG] === 'date' && typeof tagged.value === 'string') {
      return new Date(tagged.value)
    }
  }
  return value
}

/**
 * Safely parse JSON with error handling
 * @param value - The JSON string to parse
 * @param defaultValue - Default value to return on parse failure
 * @param logger - Logger for error messages
 * @param reviver - Optional JSON.parse reviver (used by the restore path to
 *   convert tagged BigInt/Date values back to their original types)
 * @returns Parsed JSON value or default value
 */
function safeParseJSON<T>(
  value: string | null | undefined,
  defaultValue: T | null = null,
  logger: KyseraLogger = silentLogger,
  reviver?: (key: string, value: unknown) => unknown
): T | null {
  if (!value) return defaultValue
  try {
    return JSON.parse(value, reviver) as T
  } catch (error) {
    logger.warn(
      `[Kysera Audit] Failed to parse JSON in audit log (data may be corrupted): ${value.substring(0, 100)}`,
      error
    )
    return defaultValue
  }
}

/**
 * Serialize values for audit log using tagged serialization for BigInt/Date.
 * When the payload as a whole cannot be serialized (circular structure), each
 * top-level column is serialized in isolation so only the offending columns
 * are replaced with an `{"$kysera": "unserializable"}` placeholder — sibling
 * columns are preserved instead of discarding the whole payload.
 */
function serializeAuditValues(values: unknown, logger: KyseraLogger = silentLogger): string | null {
  if (values === null || values === undefined) return null

  try {
    return JSON.stringify(values, auditJsonReplacer)
  } catch (error) {
    logger.warn(
      '[Kysera Audit] Failed to stringify audit values (possible circular reference). ' +
        'Falling back to per-column serialization.',
      { error: error instanceof Error ? error.message : String(error) }
    )

    if (typeof values === 'object' && !Array.isArray(values)) {
      const salvaged: Record<string, unknown> = {}
      for (const [column, columnValue] of Object.entries(values as Record<string, unknown>)) {
        try {
          JSON.stringify(columnValue, auditJsonReplacer)
          salvaged[column] = columnValue
        } catch {
          salvaged[column] = { [SERIAL_TAG]: 'unserializable' }
        }
      }
      // Cannot throw: every retained column was verified serializable above
      return JSON.stringify(salvaged, auditJsonReplacer)
    }

    // Non-object payloads (e.g. a circular array) cannot be salvaged per column
    return JSON.stringify({ [SERIAL_TAG]: 'unserializable' })
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
  options: AuditOptions,
  dialect?: Dialect
): Promise<void> {
  // Use dialect-aware timestamp formatting (CRIT-1: SQLite doesn't support CURRENT_TIMESTAMP in VALUES)
  const timestamp = options.getTimestamp ? getAuditTimestamp(options, dialect) : formatTimestampForDb(new Date(), dialect)

  // Cast to DynamicQueryBuilder for runtime table access
  const dynamicExecutor = executor as unknown as DynamicQueryBuilder
  await dynamicExecutor
    .insertInto(auditTable)
    .values({
      table_name: entityType,
      entity_id: String(entityId),
      operation,
      old_values: serializeAuditValues(oldValues, options.logger ?? silentLogger),
      new_values: serializeAuditValues(newValues, options.logger ?? silentLogger),
      changed_by: options.getUserId ? options.getUserId() : null,
      changed_at: timestamp,
      metadata: options.metadata ? JSON.stringify(options.metadata()) : null
    })
    .execute()
}

/**
 * Helper function to fetch an entity by ID
 */
async function fetchEntityById(
  executor: Kysely<unknown>,
  tableName: string,
  id: number | string,
  primaryKeyColumn: string
): Promise<unknown> {
  try {
    // Cast to DynamicQueryBuilder for runtime table access
    const dynamicExecutor = executor as unknown as DynamicQueryBuilder
    const entity = await dynamicExecutor
      .selectFrom(tableName)
      .selectAll()
      .where(primaryKeyColumn, '=', id)
      .executeTakeFirst()
    return entity ?? null
  } catch (error) {
    // Entity not found or query failed - expected when capturing old values for audit
    silentLogger.debug('Failed to fetch entity for audit', {
      tableName,
      id,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

/**
 * Helper function to fetch multiple entities by IDs in a single query.
 * This is optimized for bulk operations and avoids N+1 query problems.
 *
 * @param executor - Kysely executor (database or transaction)
 * @param tableName - Name of the table to query
 * @param ids - Array of entity IDs to fetch
 * @param primaryKeyColumn - Name of the primary key column
 * @returns Map of ID to entity (only includes found entities)
 *
 * @example
 * ```typescript
 * const entities = await fetchEntitiesByIds(db, 'users', [1, 2, 3], 'id')
 * console.log(entities.get(1)) // User with id 1 or undefined
 * console.log(entities.get(2)) // User with id 2 or undefined
 * ```
 */
async function fetchEntitiesByIds(
  executor: Kysely<unknown>,
  tableName: string,
  ids: (number | string)[],
  primaryKeyColumn: string
): Promise<Map<number | string, unknown>> {
  const entityMap = new Map<number | string, unknown>()

  if (ids.length === 0) {
    return entityMap
  }

  try {
    // Fetch all entities in a single query
    // Cast to DynamicQueryBuilder for runtime table access
    const dynamicExecutor = executor as unknown as DynamicQueryBuilder
    const entities = await dynamicExecutor
      .selectFrom(tableName)
      .selectAll()
      .where(primaryKeyColumn, 'in', ids)
      .execute()

    // Build map for O(1) lookups
    if (Array.isArray(entities)) {
      for (const entity of entities) {
        const id = (entity as Record<string, unknown>)[primaryKeyColumn]
        if (id !== undefined) {
          entityMap.set(id as number | string, entity)
        }
      }
    }

    return entityMap
  } catch (error) {
    // Bulk fetch failed - return empty map, audit will continue with null old values
    silentLogger.warn('Failed to bulk fetch entities for audit', {
      tableName,
      count: ids.length,
      error: error instanceof Error ? error.message : String(error)
    })
    return entityMap
  }
}

/**
 * Extract primary key value from an entity
 */
function extractPrimaryKey(entity: unknown, primaryKeyColumn: string): string | number {
  const record = entity as Record<string, unknown>
  const pkValue = record[primaryKeyColumn]
  if (pkValue === undefined || pkValue === null) {
    throw new AuditError(`Primary key '${primaryKeyColumn}' not found in entity`)
  }
  return pkValue as string | number
}

/**
 * Prepare audit entry for batch insert
 */
function prepareAuditEntry(
  tableName: string,
  entityId: string | number,
  operation: string,
  oldValues: unknown,
  newValues: unknown,
  options: AuditOptions,
  dialect?: Dialect
): Record<string, unknown> {
  const timestamp = options.getTimestamp ? getAuditTimestamp(options, dialect) : formatTimestampForDb(new Date(), dialect)

  return {
    table_name: tableName,
    entity_id: String(entityId),
    operation,
    old_values: serializeAuditValues(oldValues, options.logger ?? silentLogger),
    new_values: serializeAuditValues(newValues, options.logger ?? silentLogger),
    changed_by: options.getUserId ? options.getUserId() : null,
    changed_at: timestamp,
    metadata: options.metadata ? JSON.stringify(options.metadata()) : null
  }
}

/**
 * Create multiple audit log entries in a single batch INSERT.
 * This function optimizes bulk operations by avoiding N+1 query patterns.
 */
async function createBulkAuditLogEntries<DB>(
  executor: Kysely<DB>,
  auditTable: string,
  entries: Record<string, unknown>[]
): Promise<void> {
  if (entries.length === 0) {
    return
  }

  const dynamicExecutor = executor as unknown as DynamicQueryBuilder
  await dynamicExecutor.insertInto(auditTable).values(entries).execute()
}

// ============================================================================
// Repository Extension Helpers
// ============================================================================

/**
 * Determine whether audited mutations on this repository can be executed
 * atomically (mutation + audit entry in one implicit transaction), and if so,
 * return the executor's resolved plugin list needed to rebuild the repository
 * on a transaction. Returns null when the sequential path must be used:
 * - the executor is already a transaction (the caller controls atomicity),
 * - the executor is a plain Kysely instance without plugin metadata,
 * - the repository has no withTransaction() to rebind with, or
 * - this audit plugin is not part of the executor's plugin chain (a rebuilt
 *   repository would silently skip audit logging).
 */
function resolveAtomicPlugins(
  executor: Kysely<unknown>,
  baseRepo: object,
  selfPlugin: Plugin
): readonly Plugin[] | null {
  if (executor.isTransaction) return null
  if (!isKyseraExecutor(executor)) return null
  if (typeof (baseRepo as TransactionBindableRepository).withTransaction !== 'function') return null

  const plugins = getPlugins(executor)
  return plugins.includes(selfPlugin) ? plugins : null
}

/**
 * Execute a repository mutation atomically with its audit log entry.
 *
 * Repository methods are bound to the executor they were created with, so a
 * mutation cannot simply be re-run inside `executor.transaction().execute()`:
 * it would still execute on the root executor — outside the transaction on
 * pooled drivers, and deadlocking on single-connection drivers like SQLite.
 * Instead, the repository is rebuilt on the transaction via `withTransaction()`
 * and — unless withTransaction already re-applied the plugin chain (repos from
 * `createORM().createRepository()` do since the plugin-aware withTransaction) —
 * the plugin chain is re-applied here in resolved order. The re-dispatched
 * call then runs the same plugin stack; this audit plugin sees a transaction
 * executor and takes the same-transaction path, so mutation and audit entry
 * commit or roll back together.
 *
 * Returns null when atomic execution is not possible (see
 * resolveAtomicPlugins); callers then use the sequential (best-effort) path.
 */
function executeAtomically<R>(
  executor: Kysely<unknown>,
  baseRepo: object,
  atomicPlugins: readonly Plugin[] | null,
  method: string,
  args: readonly unknown[]
): Promise<R> | null {
  if (!atomicPlugins) return null

  const withTransaction = (baseRepo as TransactionBindableRepository).withTransaction
  if (typeof withTransaction !== 'function') return null

  return executor.transaction().execute(async trx => {
    let txRepo: object = withTransaction.call(baseRepo, trx as unknown as Kysely<unknown>)
    // A plugin-aware withTransaction returns an already-extended repository
    // (marker present); only re-apply the chain for plain rebinds
    if ((txRepo as Record<symbol, unknown>)[AUDIT_EXTENDED] !== true) {
      for (const plugin of atomicPlugins) {
        if (plugin.extendRepository) {
          txRepo = plugin.extendRepository(txRepo)
        }
      }
    }

    const fn = (txRepo as Record<string, unknown>)[method]
    if (typeof fn !== 'function') {
      // Unreachable in practice: withTransaction() mirrors the base repository
      throw new AuditError(
        `Cannot execute '${method}' atomically: method missing on transaction-bound repository`
      )
    }
    return (await fn.apply(txRepo, args as unknown[])) as R
  })
}

/**
 * Wrap the create method with audit logging.
 * Returns the wrapped method (or undefined when the repository has no create);
 * the caller assembles the extended repository without mutating the original.
 */
function wrapCreateMethod<T = unknown>(
  baseRepo: AuditBaseRepository<T>,
  executor: Kysely<unknown>,
  atomicPlugins: readonly Plugin[] | null,
  auditTable: string,
  tableName: string,
  primaryKeyColumn: string,
  captureNewValues: boolean,
  skipSystemOperations: boolean,
  options: AuditOptions,
  dialect?: Dialect
): ((input: Partial<T>) => Promise<T>) | undefined {
  if (!baseRepo.create) return undefined

  const originalCreate = baseRepo.create.bind(baseRepo)

  return async function (input: Partial<T>): Promise<T> {
    if (!skipSystemOperations) {
      const atomic = executeAtomically<T>(executor, baseRepo, atomicPlugins, 'create', [input])
      if (atomic) return await atomic
    }

    const result = await originalCreate(input)

    if (!skipSystemOperations) {
      const pkValue = extractPrimaryKey(result, primaryKeyColumn)
      await createAuditLogEntry(
        executor,
        auditTable,
        tableName,
        pkValue,
        'INSERT',
        null,
        captureNewValues ? result : null,
        options,
        dialect
      )
    }

    return result
  }
}

/**
 * Wrap the update method with audit logging.
 * Returns the wrapped method (or undefined when the repository has no update).
 */
function wrapUpdateMethod<T = unknown>(
  baseRepo: AuditBaseRepository<T>,
  executor: Kysely<unknown>,
  atomicPlugins: readonly Plugin[] | null,
  auditTable: string,
  tableName: string,
  primaryKeyColumn: string,
  captureOldValues: boolean,
  captureNewValues: boolean,
  skipSystemOperations: boolean,
  options: AuditOptions,
  dialect?: Dialect
): ((id: number | string, input: Partial<T>) => Promise<T>) | undefined {
  if (!baseRepo.update) return undefined

  const originalUpdate = baseRepo.update.bind(baseRepo)
  return async function (id: number | string, input: Partial<T>): Promise<T> {
    if (!skipSystemOperations) {
      const atomic = executeAtomically<T>(executor, baseRepo, atomicPlugins, 'update', [id, input])
      if (atomic) return await atomic
    }

    // Fetch old values if needed
    let oldValues: unknown = null
    if (captureOldValues) {
      oldValues = await fetchEntityById(executor, tableName, id, primaryKeyColumn)
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
        options,
        dialect
      )
    }

    return result
  }
}

/**
 * Wrap the delete method with audit logging.
 * Returns the wrapped method (or undefined when the repository has no delete).
 */
function wrapDeleteMethod<T = unknown>(
  baseRepo: AuditBaseRepository<T>,
  executor: Kysely<unknown>,
  atomicPlugins: readonly Plugin[] | null,
  auditTable: string,
  tableName: string,
  primaryKeyColumn: string,
  captureOldValues: boolean,
  skipSystemOperations: boolean,
  options: AuditOptions,
  dialect?: Dialect
): ((id: number | string) => Promise<boolean>) | undefined {
  if (!baseRepo.delete) return undefined

  const originalDelete = baseRepo.delete.bind(baseRepo)
  return async function (id: number | string): Promise<boolean> {
    if (!skipSystemOperations) {
      const atomic = executeAtomically<boolean>(executor, baseRepo, atomicPlugins, 'delete', [id])
      if (atomic) return await atomic
    }

    // Fetch old values before deletion
    let oldValues: unknown = null
    if (captureOldValues) {
      oldValues = await fetchEntityById(executor, tableName, id, primaryKeyColumn)
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
        options,
        dialect
      )
    }

    return result
  }
}

/**
 * Wrap the bulkCreate method with audit logging
 *
 * **Performance Optimization:** Uses batch INSERT for all audit entries in a single query.
 * - Old approach (N+1): 100 records = 100 separate INSERT queries
 * - New approach: 100 records = 1 batch INSERT query
 * - Performance gain: ~100x faster for large batches
 */
function wrapBulkCreateMethod<T = unknown>(
  baseRepo: AuditBaseRepository<T>,
  executor: Kysely<unknown>,
  atomicPlugins: readonly Plugin[] | null,
  auditTable: string,
  tableName: string,
  primaryKeyColumn: string,
  captureNewValues: boolean,
  skipSystemOperations: boolean,
  options: AuditOptions,
  dialect?: Dialect
): ((inputs: Partial<T>[]) => Promise<T[]>) | undefined {
  if (!baseRepo.bulkCreate) return undefined

  const originalBulkCreate = baseRepo.bulkCreate.bind(baseRepo)
  return async function (inputs: Partial<T>[]): Promise<T[]> {
    if (!skipSystemOperations) {
      const atomic = executeAtomically<T[]>(executor, baseRepo, atomicPlugins, 'bulkCreate', [inputs])
      if (atomic) return await atomic
    }

    const results = await originalBulkCreate(inputs)

    if (!skipSystemOperations && Array.isArray(results) && results.length > 0) {
      // Prepare all audit entries in memory
      const auditEntries = results.map(result => {
        const pkValue = extractPrimaryKey(result, primaryKeyColumn)
        return prepareAuditEntry(
          tableName,
          pkValue,
          'INSERT',
          null,
          captureNewValues ? result : null,
          options,
          dialect
        )
      })

      // Batch insert all audit entries in one query
      await createBulkAuditLogEntries(executor, auditTable, auditEntries)
    }

    return results
  }
}

/**
 * Wrap the bulkUpdate method with audit logging
 *
 * **Performance Optimization:** Uses batch queries for both fetching old values and inserting audit entries.
 * - Old values: 1 batch SELECT with WHERE IN clause (not N individual queries)
 * - Audit entries: 1 batch INSERT (not N individual queries)
 * - Performance gain: ~100x faster for large batches
 */
function wrapBulkUpdateMethod<T = unknown>(
  baseRepo: AuditBaseRepository<T>,
  executor: Kysely<unknown>,
  atomicPlugins: readonly Plugin[] | null,
  auditTable: string,
  tableName: string,
  primaryKeyColumn: string,
  captureOldValues: boolean,
  captureNewValues: boolean,
  skipSystemOperations: boolean,
  options: AuditOptions,
  dialect?: Dialect
): ((updates: { id: number | string; data: Partial<T> }[]) => Promise<T[]>) | undefined {
  if (!baseRepo.bulkUpdate) return undefined

  const originalBulkUpdate = baseRepo.bulkUpdate.bind(baseRepo)
  return async function (
    updates: { id: number | string; data: Partial<T> }[]
  ): Promise<T[]> {
    if (!skipSystemOperations) {
      const atomic = executeAtomically<T[]>(executor, baseRepo, atomicPlugins, 'bulkUpdate', [updates])
      if (atomic) return await atomic
    }

    // Fetch old values before update if needed
    // Use bulk fetch to avoid N+1 queries (performance optimization)
    const oldValuesMap = new Map<number | string, unknown>()
    if (captureOldValues) {
      const ids = updates.map(u => u.id)
      const fetchedOldValues = await fetchEntitiesByIds(executor, tableName, ids, primaryKeyColumn)
      // Copy to our map
      for (const [id, entity] of fetchedOldValues) {
        oldValuesMap.set(id, entity)
      }
    }

    const results = await originalBulkUpdate(updates)

    if (!skipSystemOperations && Array.isArray(results) && results.length > 0) {
      // Prepare all audit entries in memory
      const auditEntries = results.map(result => {
        const pkValue = extractPrimaryKey(result, primaryKeyColumn)
        return prepareAuditEntry(
          tableName,
          pkValue,
          'UPDATE',
          oldValuesMap.get(pkValue) ?? null,
          captureNewValues ? result : null,
          options,
          dialect
        )
      })

      // Batch insert all audit entries in one query
      await createBulkAuditLogEntries(executor, auditTable, auditEntries)
    }

    return results
  }
}

/**
 * Wrap the bulkDelete method with audit logging
 *
 * **Performance Optimization:** Uses batch queries for both fetching old values and inserting audit entries.
 * - Old values: 1 batch SELECT with WHERE IN clause (not N individual queries)
 * - Audit entries: 1 batch INSERT (not N individual queries)
 * - Performance gain: ~100x faster for large batches
 */
function wrapBulkDeleteMethod<T = unknown>(
  baseRepo: AuditBaseRepository<T>,
  executor: Kysely<unknown>,
  atomicPlugins: readonly Plugin[] | null,
  auditTable: string,
  tableName: string,
  primaryKeyColumn: string,
  captureOldValues: boolean,
  skipSystemOperations: boolean,
  options: AuditOptions,
  dialect?: Dialect
): ((ids: (number | string)[]) => Promise<number>) | undefined {
  if (!baseRepo.bulkDelete) return undefined

  const originalBulkDelete = baseRepo.bulkDelete.bind(baseRepo)
  return async function (ids: (number | string)[]): Promise<number> {
    if (!skipSystemOperations) {
      const atomic = executeAtomically<number>(executor, baseRepo, atomicPlugins, 'bulkDelete', [ids])
      if (atomic) return await atomic
    }

    // Fetch old values before deletion if needed
    // Use bulk fetch to avoid N+1 queries (performance optimization)
    const oldValuesMap = new Map<number | string, unknown>()
    if (captureOldValues) {
      const fetchedOldValues = await fetchEntitiesByIds(executor, tableName, ids, primaryKeyColumn)
      // Copy to our map
      for (const [id, entity] of fetchedOldValues) {
        oldValuesMap.set(id, entity)
      }
    }

    const result = await originalBulkDelete(ids)

    if (!skipSystemOperations && ids.length > 0) {
      // Prepare all audit entries in memory
      const auditEntries = ids.map(id =>
        prepareAuditEntry(tableName, id, 'DELETE', oldValuesMap.get(id) ?? null, null, options, dialect)
      )

      // Batch insert all audit entries in one query
      await createBulkAuditLogEntries(executor, auditTable, auditEntries)
    }

    return result
  }
}

/**
 * Helper function to parse audit log entries
 */
function parseAuditLogEntries(logs: unknown[], logger: KyseraLogger): ParsedAuditLogEntry[] {
  if (!Array.isArray(logs)) {
    return []
  }

  return logs.map((log: unknown) => {
    const auditLog = log as AuditLogEntry
    return {
      ...auditLog,
      old_values: safeParseJSON<Record<string, unknown>>(auditLog.old_values, null, logger),
      new_values: safeParseJSON<Record<string, unknown>>(auditLog.new_values, null, logger),
      metadata: safeParseJSON<Record<string, unknown>>(auditLog.metadata, null, logger)
    }
  }) as ParsedAuditLogEntry[]
}

/**
 * Build the restoreFromAudit method.
 *
 * `create`/`update` are the audit-wrapped methods of the extended repository,
 * so restore operations are themselves audited (and atomic where supported),
 * matching the behavior of regular repository mutations.
 *
 * Values are parsed with auditJsonReviver so tagged BigInt/Date values (see
 * auditJsonReplacer) are written back with their original types instead of as
 * tagged JSON objects or strings.
 */
function createRestoreMethod<T = unknown>(
  getAuditLog: (auditId: number) => Promise<AuditLogEntry | null>,
  create: ((data: Partial<T>) => Promise<T>) | undefined,
  update: ((id: number | string, data: Partial<T>) => Promise<T>) | undefined,
  primaryKeyColumn: string,
  logger: KyseraLogger
): (auditId: number) => Promise<T> {
  return async function (auditId: number): Promise<T> {
    const log = await getAuditLog(auditId)
    if (!log) {
      throw new NotFoundError('AuditLog', { id: auditId })
    }

    // For DELETE operations, restore using old_values (the entity before deletion)
    if (log.operation === 'DELETE') {
      if (!log.old_values) {
        throw new AuditMissingValuesError(auditId)
      }

      const parsedValues = safeParseJSON<Record<string, unknown>>(
        log.old_values,
        null,
        logger,
        auditJsonReviver
      )
      if (!parsedValues) {
        throw new AuditMissingValuesError(auditId)
      }

      if (!create) {
        throw new AuditRestoreError(auditId, 'DELETE', 'Repository does not support create operation')
      }

      return await create(parsedValues as Partial<T>)
    }

    // For UPDATE operations, restore using old_values (revert the update)
    if (log.operation === 'UPDATE') {
      if (!log.old_values) {
        throw new AuditMissingValuesError(auditId)
      }

      const parsedValues = safeParseJSON<Record<string, unknown>>(
        log.old_values,
        null,
        logger,
        auditJsonReviver
      )
      if (!parsedValues) {
        throw new AuditMissingValuesError(auditId)
      }

      const entityId = parsedValues[primaryKeyColumn]
      if (entityId === undefined || entityId === null) {
        throw new AuditRestoreError(
          auditId,
          'UPDATE',
          `Primary key '${primaryKeyColumn}' not found in audit log old_values`
        )
      }

      if (!update) {
        throw new AuditRestoreError(auditId, 'UPDATE', 'Repository does not support update operation')
      }

      return await update(entityId as number | string, parsedValues as Partial<T>)
    }

    // INSERT operations cannot be restored (the entity already exists)
    throw new AuditRestoreError(
      auditId,
      log.operation,
      'Cannot restore INSERT operations. Only DELETE (re-creates entity) and UPDATE (reverts to old values) operations can be restored.'
    )
  }
}

/**
 * Build the audit query methods (getAuditHistory, getAuditLog, ...).
 * Returns a plain object so the caller can compose the extended repository
 * without mutating the original one.
 */
function createAuditQueryMethods(
  executor: Kysely<unknown>,
  auditTable: string,
  tableName: string,
  logger: KyseraLogger,
  dialect?: Dialect
): AuditQueryMethods {
  // Get audit history for a specific entity (returns parsed entries)
  const getAuditHistory = async function (
    entityId: number | string,
    options?: AuditPaginationOptions
  ): Promise<ParsedAuditLogEntry[]> {
    // Cast to DynamicQueryBuilder for runtime table access
    const dynamicExecutor = executor as unknown as DynamicQueryBuilder
    let query = dynamicExecutor
      .selectFrom(auditTable)
      .selectAll()
      .where('table_name', '=', tableName)
      .where('entity_id', '=', String(entityId))
      .orderBy('changed_at', 'desc')

    // Apply pagination if provided
    if (options?.limit !== undefined) {
      query = query.limit(options.limit)
    }
    if (options?.offset !== undefined) {
      query = query.offset(options.offset)
    }

    const logs = await query.execute()
    return parseAuditLogEntries(logs, logger)
  }

  // Alias for backwards compatibility
  const getAuditLogs = async function (
    entityId: number | string,
    options?: AuditPaginationOptions
  ): Promise<ParsedAuditLogEntry[]> {
    return await getAuditHistory(entityId, options)
  }

  // Get a specific audit log entry
  const getAuditLog = async function (auditId: number): Promise<AuditLogEntry | null> {
    // Cast to DynamicQueryBuilder for runtime table access
    const dynamicExecutor = executor as unknown as DynamicQueryBuilder
    const log = await dynamicExecutor
      .selectFrom(auditTable)
      .selectAll()
      .where('id', '=', auditId)
      .executeTakeFirst()

    return (log as AuditLogEntry | undefined) ?? null
  }

  // Get audit logs for entire table with optional filters and pagination
  const getTableAuditLogs = async function (
    filters?: AuditFilters
  ): Promise<ParsedAuditLogEntry[]> {
    // Cast to DynamicQueryBuilder for runtime table access
    const dynamicExecutor = executor as unknown as DynamicQueryBuilder
    let query = dynamicExecutor
      .selectFrom(auditTable)
      .selectAll()
      .where('table_name', '=', tableName)

    // Apply filters
    if (filters?.operation) {
      query = query.where('operation', '=', filters.operation)
    }
    if (filters?.userId) {
      query = query.where('changed_by', '=', filters.userId)
    }
    if (filters?.startDate) {
      const formattedStart = formatDateForQuery(filters.startDate, dialect)
      query = query.where('changed_at', '>=', formattedStart)
    }
    if (filters?.endDate) {
      const formattedEnd = formatDateForQuery(filters.endDate, dialect)
      query = query.where('changed_at', '<=', formattedEnd)
    }

    query = query.orderBy('changed_at', 'desc')

    if (filters?.limit !== undefined) {
      query = query.limit(filters.limit)
    }
    if (filters?.offset !== undefined) {
      query = query.offset(filters.offset)
    }

    const logs = await query.execute()
    return parseAuditLogEntries(logs, logger)
  }

  // Get all changes made by a specific user for this table
  const getUserChanges = async function (
    userId: string,
    options?: AuditPaginationOptions
  ): Promise<ParsedAuditLogEntry[]> {
    // Cast to DynamicQueryBuilder for runtime table access
    const dynamicExecutor = executor as unknown as DynamicQueryBuilder
    let query = dynamicExecutor
      .selectFrom(auditTable)
      .selectAll()
      .where('table_name', '=', tableName)
      .where('changed_by', '=', userId)
      .orderBy('changed_at', 'desc')

    // Apply pagination if provided
    if (options?.limit !== undefined) {
      query = query.limit(options.limit)
    }
    if (options?.offset !== undefined) {
      query = query.offset(options.offset)
    }

    const logs = await query.execute()
    return parseAuditLogEntries(logs, logger)
  }

  return { getAuditHistory, getAuditLogs, getAuditLog, getTableAuditLogs, getUserChanges }
}

// ============================================================================
// Main Plugin
// ============================================================================

/**
 * Audit plugin for Kysera
 *
 * This plugin automatically tracks all database changes with comprehensive audit logging.
 * It captures old and new values for all CRUD operations and stores them in an audit table.
 *
 * ## Features
 * - Automatic audit logging for all repositories
 * - Captures old and new values for INSERT, UPDATE, DELETE operations
 * - User tracking (when getUserId is provided)
 * - Timestamp tracking
 * - Metadata support for custom context
 * - Query methods to retrieve and analyze audit history
 * - **Optimized bulk operations** - Uses single query to fetch old values
 * - **Configurable primary key** - Supports both numeric and string IDs (e.g., UUIDs)
 *
 * ## Transaction Behavior
 *
 * **IMPORTANT**: Audit logs are transaction-aware and respect ACID properties.
 * There are two execution paths:
 *
 * - ✅ **Inside a transaction** (repository bound to a transaction executor):
 *   audit entries are written on the same transaction as the audited operation,
 *   so both commit or roll back together
 * - ✅ **Outside a transaction** (repository created via `createORM`/`createExecutor`
 *   on the root executor): each audited mutation is re-dispatched through a
 *   transaction-bound copy of the repository (built with `withTransaction()` plus
 *   the full plugin chain), wrapping the mutation and its audit entry in one
 *   implicit transaction. A failed audit write rolls the mutation back, so data
 *   and audit trail can never diverge
 * - ⚠️ **Fallback (best effort)**: when the repository cannot be rebound — plain
 *   Kysely executor without plugin metadata, or a repository without
 *   `withTransaction()` — the audit entry is written sequentially after the
 *   mutation and a failed audit write does NOT roll the mutation back
 *
 * ### Correct Transaction Usage
 *
 * ```typescript
 * // ✅ CORRECT: Audit logs are part of transaction
 * await db.transaction().execute(async (trx) => {
 *   const repos = createRepositories(trx)  // Use transaction executor
 *   await repos.users.create({ email: 'test@example.com' })
 *   // If transaction rolls back, audit log will also roll back
 *   throw new Error('Rollback')  // Both user and audit log rolled back ✅
 * })
 * ```
 *
 * ### Incorrect Usage (Common Mistake)
 *
 * ```typescript
 * // ❌ INCORRECT: Using db instead of trx for repositories
 * await db.transaction().execute(async (trx) => {
 *   const repos = createRepositories(db)  // Wrong! Using db, not trx
 *   await repos.users.create({ email: 'test@example.com' })
 *   throw new Error('Rollback')  // User rolled back, audit written in its own transaction ❌
 * })
 * ```
 *
 * **Rule**: Always pass the transaction executor to repositories inside transactions.
 *
 * ## Bulk Operation Performance
 *
 * Bulk operations (bulkUpdate, bulkDelete) are optimized to avoid N+1 query problems:
 *
 * - **Old approach** (N+1 queries): Fetched each entity individually in a loop
 * - **New approach** (1 query): Fetches all entities in a single `WHERE id IN (...)` query
 * - **Performance gain**: 10-100x faster for large batches (e.g., 100 records: 100 queries → 1 query)
 *
 * Example performance comparison for bulkDelete with 100 records:
 * - Sequential fetching: ~1000ms (100 queries × 10ms each)
 * - Optimized bulk fetch: ~10ms (1 query)
 * - **100x improvement** ⚡
 *
 * @example
 * ```typescript
 * import { auditPlugin } from '@kysera/audit'
 *
 * const audit = auditPlugin({
 *   auditTable: 'audit_logs',
 *   primaryKeyColumn: 'id',  // or 'uuid' for UUID primary keys
 *   getUserId: () => currentUser?.id || null,
 *   metadata: () => ({ ip: request.ip }),
 *   captureOldValues: true,  // Capture state before changes
 *   captureNewValues: true   // Capture state after changes
 * })
 *
 * const orm = createORM(db, [audit])
 * ```
 *
 * @example Transaction-aware audit logging
 * ```typescript
 * // Audit logs are automatically part of the transaction
 * await db.transaction().execute(async (trx) => {
 *   const repos = createRepositories(trx)
 *
 *   // All operations and their audit logs are atomic
 *   const user = await repos.users.create({ email: 'test@example.com' })
 *   await repos.posts.create({ user_id: user.id, title: 'First Post' })
 *
 *   // If this throws, both operations AND their audit logs roll back
 *   if (someCondition) throw new Error('Rollback everything')
 * })
 * ```
 *
 * @example Bulk operations with optimized performance
 * ```typescript
 * // Bulk update - single query to fetch old values
 * await repos.users.bulkUpdate([
 *   { id: 1, data: { status: 'active' } },
 *   { id: 2, data: { status: 'active' } },
 *   // ... 100 more updates
 * ])
 * // Old values fetched in 1 query instead of 102 queries ⚡
 *
 * // Bulk delete - single query to fetch old values
 * await repos.users.bulkDelete([1, 2, 3, ..., 100])
 * // Old values fetched in 1 query instead of 100 queries ⚡
 * ```
 *
 * @example Custom primary key (UUID)
 * ```typescript
 * // Support for UUID primary keys
 * const audit = auditPlugin({
 *   primaryKeyColumn: 'uuid'
 * })
 *
 * // Works with string IDs
 * await userRepo.create({ uuid: '550e8400-e29b-41d4-a716-446655440000', name: 'John' })
 * const history = await userRepo.getAuditHistory('550e8400-e29b-41d4-a716-446655440000')
 * ```
 */
export function auditPlugin(options: AuditOptions = {}): Plugin {
  const {
    auditTable = 'audit_logs',
    primaryKeyColumn = 'id',
    captureOldValues = true,
    captureNewValues = true,
    skipSystemOperations = false,
    logger = silentLogger
  } = options

  // Track the executor so onDestroy can clean up the correct lock entry
  let lastExecutor: object | null = null
  // Detected dialect, set in onInit for dialect-aware timestamp formatting
  let detectedDialect: Dialect | undefined

  // Named self-reference: extendRepository uses it to verify this plugin is
  // part of the executor's chain before taking the atomic execution path
  const plugin: Plugin = {
    name: '@kysera/audit',
    version: VERSION,
    priority: 50, // AUDIT plugin: runs after security (1000), filters (500), and transforms (100)

    async onInit<DB>(executor: Kysely<DB>): Promise<void> {
      lastExecutor = executor
      detectedDialect = detectDialect(executor)
      await ensureAuditTable(executor, auditTable)
    },

    onDestroy() {
      // Clean up locks for the executor this plugin was initialised with
      if (lastExecutor) {
        auditTableCreationLocks.delete(lastExecutor)
        lastExecutor = null
      }
      logger.debug('Audit plugin destroyed, cleared table creation locks')
    },

    extendRepository<T extends object>(repo: T): T {
      // Type check to ensure repo has the expected properties
      if (!isRepositoryLike(repo)) {
        return repo
      }

      // Idempotence guard: extending an already-extended repository would
      // wrap the mutation methods twice and double-write audit entries
      if ((repo as Record<symbol, unknown>)[AUDIT_EXTENDED] === true) {
        return repo
      }

      const baseRepo = repo as BaseRepositoryLike
      const tableName = baseRepo.tableName ?? ''
      const executor = baseRepo.executor as Kysely<unknown> | undefined

      if (!executor) {
        return repo
      }

      // Check if this table should be audited
      if (!shouldApplyToTable(tableName, { tables: options.tables, excludeTables: options.excludeTables })) {
        return repo
      }

      // Typed read-only view of the repository; the original is never mutated
      const auditRepo = baseRepo as unknown as AuditBaseRepository

      // Non-null when mutations can run atomically with their audit entries
      const atomicPlugins = resolveAtomicPlugins(executor, auditRepo, plugin)

      const create = wrapCreateMethod(
        auditRepo,
        executor,
        atomicPlugins,
        auditTable,
        tableName,
        primaryKeyColumn,
        captureNewValues,
        skipSystemOperations,
        options,
        detectedDialect
      )
      const update = wrapUpdateMethod(
        auditRepo,
        executor,
        atomicPlugins,
        auditTable,
        tableName,
        primaryKeyColumn,
        captureOldValues,
        captureNewValues,
        skipSystemOperations,
        options,
        detectedDialect
      )
      const deleteMethod = wrapDeleteMethod(
        auditRepo,
        executor,
        atomicPlugins,
        auditTable,
        tableName,
        primaryKeyColumn,
        captureOldValues,
        skipSystemOperations,
        options,
        detectedDialect
      )
      const bulkCreate = wrapBulkCreateMethod(
        auditRepo,
        executor,
        atomicPlugins,
        auditTable,
        tableName,
        primaryKeyColumn,
        captureNewValues,
        skipSystemOperations,
        options,
        detectedDialect
      )
      const bulkUpdate = wrapBulkUpdateMethod(
        auditRepo,
        executor,
        atomicPlugins,
        auditTable,
        tableName,
        primaryKeyColumn,
        captureOldValues,
        captureNewValues,
        skipSystemOperations,
        options,
        detectedDialect
      )
      const bulkDelete = wrapBulkDeleteMethod(
        auditRepo,
        executor,
        atomicPlugins,
        auditTable,
        tableName,
        primaryKeyColumn,
        captureOldValues,
        skipSystemOperations,
        options,
        detectedDialect
      )

      const queryMethods = createAuditQueryMethods(
        executor,
        auditTable,
        tableName,
        logger,
        detectedDialect
      )

      // Restore goes through the audited create/update so restores are logged
      // (and atomic) just like regular mutations
      const restoreFromAudit = createRestoreMethod(
        queryMethods.getAuditLog,
        create,
        update,
        primaryKeyColumn,
        logger
      )

      const extendedRepo = {
        ...repo,
        ...(create ? { create } : {}),
        ...(update ? { update } : {}),
        ...(deleteMethod ? { delete: deleteMethod } : {}),
        ...(bulkCreate ? { bulkCreate } : {}),
        ...(bulkUpdate ? { bulkUpdate } : {}),
        ...(bulkDelete ? { bulkDelete } : {}),
        ...queryMethods,
        restoreFromAudit
      }

      // Non-enumerable so the marker does not leak through spreads or JSON
      Object.defineProperty(extendedRepo, AUDIT_EXTENDED, { value: true })

      return extendedRepo as T
    }
  }

  return plugin
}

// ============================================================================
// Database-Specific Implementations
// ============================================================================

/**
 * PostgreSQL-specific audit plugin
 *
 * @deprecated Use `auditPlugin()` instead. Dialect is now auto-detected via `detectDialect()`.
 * @param options Audit plugin options
 * @returns Plugin instance configured for PostgreSQL
 */
export function auditPluginPostgreSQL(options: AuditOptions = {}): Plugin {
  return auditPlugin(options)
}

/**
 * MySQL-specific audit plugin
 *
 * @deprecated Use `auditPlugin()` instead. Dialect is now auto-detected via `detectDialect()`,
 * and timestamps are automatically formatted for MySQL (YYYY-MM-DD HH:MM:SS.mmm).
 * @param options Audit plugin options
 * @returns Plugin instance configured for MySQL
 */
export function auditPluginMySQL(options: AuditOptions = {}): Plugin {
  return auditPlugin(options)
}

/**
 * SQLite-specific audit plugin
 *
 * @deprecated Use `auditPlugin()` instead. Dialect is now auto-detected via `detectDialect()`.
 * @param options Audit plugin options
 * @returns Plugin instance configured for SQLite
 */
export function auditPluginSQLite(options: AuditOptions = {}): Plugin {
  return auditPlugin(options)
}
