import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Plugin } from '@kysera/repository';
import { NotFoundError, BadRequestError, type KyseraLogger, consoleLogger } from '@kysera/core';
import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

/**
 * Audit timestamp can be a Date or a string
 */
export type AuditTimestamp = Date | string;

/**
 * Audit plugin configuration options
 */
export interface AuditOptions {
  /**
   * Table name for storing audit logs
   * @default 'audit_logs'
   */
  auditTable?: string;

  /**
   * Primary key column name
   * Supports both numeric IDs and string IDs (e.g., UUIDs)
   * @default 'id'
   */
  primaryKeyColumn?: string;

  /**
   * Whether to capture old values in updates
   * @default true
   */
  captureOldValues?: boolean;

  /**
   * Whether to capture new values in inserts/updates
   * @default true
   */
  captureNewValues?: boolean;

  /**
   * Skip auditing for system operations (migrations, seeds)
   * @default false
   */
  skipSystemOperations?: boolean;

  /**
   * Whitelist of tables to audit (if specified, only these tables will be audited)
   */
  tables?: string[];

  /**
   * Blacklist of tables to exclude from auditing
   */
  excludeTables?: string[];

  /**
   * Function to get the current user ID
   * @returns User ID or null
   */
  getUserId?: () => string | null;

  /**
   * Function to get the current timestamp
   * @default () => new Date()
   */
  getTimestamp?: () => AuditTimestamp;

  /**
   * Function to get additional metadata for audit entries
   * @returns Metadata object or null
   */
  metadata?: () => Record<string, unknown>;

  /**
   * Logger for audit operations
   * @default consoleLogger
   */
  logger?: KyseraLogger;
}

/**
 * Zod schema for AuditOptions
 * Used for validation and configuration in the kysera-cli
 */
export const AuditOptionsSchema = z.object({
  auditTable: z.string().optional(),
  primaryKeyColumn: z.string().optional(),
  captureOldValues: z.boolean().optional(),
  captureNewValues: z.boolean().optional(),
  skipSystemOperations: z.boolean().optional(),
  tables: z.array(z.string()).optional(),
  excludeTables: z.array(z.string()).optional(),
  getUserId: z.function().optional(),
  getTimestamp: z.function().optional(),
  metadata: z.function().optional(),
});

/**
 * Audit log entry structure (raw from database)
 */
export interface AuditLogEntry {
  id: number;
  table_name: string;
  entity_id: string;
  operation: string;
  old_values: string | null;
  new_values: string | null;
  changed_by: string | null;
  changed_at: string;
  metadata: string | null;
}

/**
 * Parsed audit log entry with JSON values parsed
 */
export interface ParsedAuditLogEntry {
  id: number;
  table_name: string;
  entity_id: string;
  operation: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  changed_by: string | null;
  changed_at: Date | string;
  metadata: Record<string, unknown> | null;
}

/**
 * Pagination options for audit queries
 */
export interface AuditPaginationOptions {
  /** Maximum number of records to return */
  limit?: number;
  /** Number of records to skip (for pagination) */
  offset?: number;
}

/**
 * Filters for querying table audit logs
 */
export interface AuditFilters extends AuditPaginationOptions {
  /** Filter by operation type ('INSERT', 'UPDATE', 'DELETE') */
  operation?: string;
  /** Filter by user ID (changed_by field) */
  userId?: string;
  /** Filter by start date (inclusive) */
  startDate?: Date | string;
  /** Filter by end date (inclusive) */
  endDate?: Date | string;
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
  getAuditHistory(entityId: number | string, options?: AuditPaginationOptions): Promise<ParsedAuditLogEntry[]>;

  /**
   * Alias for getAuditHistory (backwards compatibility)
   * @param entityId - The entity ID to get history for
   * @param options - Optional pagination options (limit, offset)
   * @returns Array of parsed audit log entries, most recent first
   */
  getAuditLogs(entityId: number | string, options?: AuditPaginationOptions): Promise<ParsedAuditLogEntry[]>;

  /**
   * Get a specific audit log entry by its ID
   * @param auditId - The audit log ID
   * @returns Raw audit log entry or null if not found
   */
  getAuditLog(auditId: number): Promise<AuditLogEntry | null>;

  /**
   * Get audit logs for entire table with optional filters and pagination
   * @param filters - Optional filters to apply (includes limit, offset for pagination)
   * @returns Array of parsed audit log entries, most recent first
   */
  getTableAuditLogs(filters?: AuditFilters): Promise<ParsedAuditLogEntry[]>;

  /**
   * Get all changes made by a specific user for this table
   * @param userId - The user ID to filter by
   * @param options - Optional pagination options (limit, offset)
   * @returns Array of parsed audit log entries, most recent first
   */
  getUserChanges(userId: string, options?: AuditPaginationOptions): Promise<ParsedAuditLogEntry[]>;

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
  restoreFromAudit(auditId: number): Promise<T>;
}

/**
 * Base repository interface for type checking
 */
interface BaseRepositoryLike {
  tableName?: string;
  executor?: unknown;
  create?: (data: unknown) => Promise<unknown>;
  update?: (id: number | string, data: unknown) => Promise<unknown>;
  delete?: (id: number | string) => Promise<boolean>;
  bulkCreate?: (data: unknown[]) => Promise<unknown[]>;
  bulkUpdate?: (updates: { id: number | string; data: unknown }[]) => Promise<unknown[]>;
  bulkDelete?: (ids: (number | string)[]) => Promise<number>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if audit table exists
 */
async function checkAuditTableExists<DB>(executor: Kysely<DB>, auditTable: string): Promise<boolean> {
  try {
    // Try to query the table structure
    // Kysely requires dynamic table access via `any` cast since auditTable is a runtime string
    await // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely query builder chaining
    (executor as any)
      .selectFrom(auditTable)

      .select('id')

      .limit(0)

      .execute();
    // If we get here, table exists
    return true;
  } catch {
    // Table doesn't exist
    return false;
  }
}

/**
 * Create audit table schema
 */
async function createAuditTable<DB>(executor: Kysely<DB>, auditTable: string): Promise<void> {
  // Kysely schema builder requires `any` cast for dynamic table creation with runtime column types
  await // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely schema builder chaining
  (executor.schema as any)
    .createTable(auditTable)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Column builder callback
    .addColumn('id', 'integer', (col: any) => col.primaryKey().autoIncrement())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Column builder callback
    .addColumn('table_name', 'text', (col: any) => col.notNull())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Column builder callback
    .addColumn('entity_id', 'text', (col: any) => col.notNull())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Column builder callback
    .addColumn('operation', 'text', (col: any) => col.notNull())

    .addColumn('old_values', 'text')

    .addColumn('new_values', 'text')

    .addColumn('changed_by', 'text')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Column builder callback
    .addColumn('changed_at', 'text', (col: any) => col.notNull())

    .addColumn('metadata', 'text')

    .execute();
}

/**
 * Get audit timestamp from options
 */
function getAuditTimestamp(options: AuditOptions): string {
  const timestamp = options.getTimestamp ? options.getTimestamp() : new Date();
  return typeof timestamp === 'string' ? timestamp : timestamp.toISOString();
}

/**
 * Safely parse JSON with error handling
 * @param value - The JSON string to parse
 * @param defaultValue - Default value to return on parse failure
 * @param logger - Logger for error messages
 * @returns Parsed JSON value or default value
 */
function safeParseJSON<T>(
  value: string | null | undefined,
  defaultValue: T | null = null,
  logger: KyseraLogger = consoleLogger
): T | null {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    logger.warn('Failed to parse JSON in audit log:', value?.substring(0, 100), error);
    return defaultValue;
  }
}

/**
 * Serialize values for audit log
 */
function serializeAuditValues(values: unknown): string | null {
  if (values === null || values === undefined) return null;

  try {
    return JSON.stringify(values);
  } catch {
    // Safe conversion for non-JSON values
    if (typeof values === 'object') {
      // For objects that can't be stringified, use toString()
      return '[Object]';
    }
    return String(values);
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
  // Use SQL CURRENT_TIMESTAMP for database-native timestamp handling
  // This avoids timezone issues between client and server
  // If user provides custom getTimestamp, respect it but they need to ensure proper format
  const timestamp = options.getTimestamp ? getAuditTimestamp(options) : sql`CURRENT_TIMESTAMP`;

  // Kysely requires dynamic table access via `any` cast since auditTable is a runtime string
  await // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely query builder chaining
  (executor as any)
    .insertInto(auditTable)

    .values({
      table_name: entityType,
      entity_id: String(entityId),
      operation,
      old_values: serializeAuditValues(oldValues),
      new_values: serializeAuditValues(newValues),
      changed_by: options.getUserId ? options.getUserId() : null,
      changed_at: timestamp,
      metadata: options.metadata ? JSON.stringify(options.metadata()) : null,
    })

    .execute();
}

/**
 * Helper function to check if an object looks like a repository
 */
function isRepositoryLike(obj: unknown): obj is BaseRepositoryLike {
  if (!obj || typeof obj !== 'object') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Type narrowing requires `any` cast after typeof check
  const repo = obj as any;
  return 'tableName' in repo && 'executor' in repo;
}

/**
 * Helper function to fetch an entity by ID
 */
async function fetchEntityById(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic DB type parameter needed for Kysely
  executor: Kysely<any>,
  tableName: string,
  id: number | string,
  primaryKeyColumn: string
): Promise<unknown> {
  try {
    // Kysely requires dynamic table access via `any` cast since tableName is a runtime string
    const entity = await // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely query builder chaining
    (executor as any)
      .selectFrom(tableName)

      .selectAll()

      .where(primaryKeyColumn, '=', id)

      .executeTakeFirst();
    return entity;
  } catch {
    return null;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic DB type parameter needed for Kysely
  executor: Kysely<any>,
  tableName: string,
  ids: (number | string)[],
  primaryKeyColumn: string
): Promise<Map<number | string, unknown>> {
  const entityMap = new Map<number | string, unknown>();

  if (ids.length === 0) {
    return entityMap;
  }

  try {
    // Fetch all entities in a single query
    // Kysely requires dynamic table access via `any` cast since tableName is a runtime string
    const entities =
      await // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely query builder chaining
      (executor as any)
        .selectFrom(tableName)

        .selectAll()

        .where(primaryKeyColumn, 'in', ids)

        .execute();

    // Build map for O(1) lookups
    for (const entity of entities) {
      const id = (entity as Record<string, unknown>)[primaryKeyColumn];
      if (id !== undefined) {
        entityMap.set(id as number | string, entity);
      }
    }

    return entityMap;
  } catch {
    // Return empty map on error
    return entityMap;
  }
}

/**
 * Extract primary key value from an entity
 */
function extractPrimaryKey(entity: unknown, primaryKeyColumn: string): string | number {
  const record = entity as Record<string, unknown>;
  const pkValue = record[primaryKeyColumn];
  if (pkValue === undefined || pkValue === null) {
    throw new BadRequestError(`Primary key '${primaryKeyColumn}' not found in entity`);
  }
  return pkValue as string | number;
}

// ============================================================================
// Repository Extension Helpers
// ============================================================================

/**
 * Wrap the create method with audit logging
 */
function wrapCreateMethod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic repository type
  baseRepo: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic DB type
  executor: Kysely<any>,
  auditTable: string,
  tableName: string,
  primaryKeyColumn: string,
  captureNewValues: boolean,
  skipSystemOperations: boolean,
  options: AuditOptions
): void {
  if (!baseRepo.create) return;

  const originalCreate = baseRepo.create.bind(baseRepo);

  baseRepo.create = async function (input: unknown) {
    const result = await originalCreate(input);

    if (!skipSystemOperations) {
      const pkValue = extractPrimaryKey(result, primaryKeyColumn);
      await createAuditLogEntry(
        executor,
        auditTable,
        tableName,
        pkValue,
        'INSERT',
        null,
        captureNewValues ? result : null,
        options
      );
    }

    return result;
  };
}

/**
 * Wrap the update method with audit logging
 */
function wrapUpdateMethod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic repository type
  baseRepo: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic DB type
  executor: Kysely<any>,
  auditTable: string,
  tableName: string,
  primaryKeyColumn: string,
  captureOldValues: boolean,
  captureNewValues: boolean,
  skipSystemOperations: boolean,
  options: AuditOptions
): void {
  if (!baseRepo.update) return;

  const originalUpdate = baseRepo.update.bind(baseRepo);
  baseRepo.update = async function (id: number | string, input: unknown) {
    // Fetch old values if needed
    let oldValues: unknown = null;
    if (captureOldValues) {
      oldValues = await fetchEntityById(executor, tableName, id, primaryKeyColumn);
    }

    const result = await originalUpdate(id, input);

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
      );
    }

    return result;
  };
}

/**
 * Wrap the delete method with audit logging
 */
function wrapDeleteMethod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic repository type
  baseRepo: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic DB type
  executor: Kysely<any>,
  auditTable: string,
  tableName: string,
  primaryKeyColumn: string,
  captureOldValues: boolean,
  skipSystemOperations: boolean,
  options: AuditOptions
): void {
  if (!baseRepo.delete) return;

  const originalDelete = baseRepo.delete.bind(baseRepo);
  baseRepo.delete = async function (id: number | string) {
    // Fetch old values before deletion
    let oldValues: unknown = null;
    if (captureOldValues) {
      oldValues = await fetchEntityById(executor, tableName, id, primaryKeyColumn);
    }

    const result = await originalDelete(id);

    if (!skipSystemOperations && result) {
      await createAuditLogEntry(executor, auditTable, tableName, id, 'DELETE', oldValues, null, options);
    }

    return result;
  };
}

/**
 * Wrap the bulkCreate method with audit logging
 */
function wrapBulkCreateMethod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic repository type
  baseRepo: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic DB type
  executor: Kysely<any>,
  auditTable: string,
  tableName: string,
  primaryKeyColumn: string,
  captureNewValues: boolean,
  skipSystemOperations: boolean,
  options: AuditOptions
): void {
  if (!baseRepo.bulkCreate) return;

  const originalBulkCreate = baseRepo.bulkCreate.bind(baseRepo);
  baseRepo.bulkCreate = async function (inputs: unknown[]) {
    const results = await originalBulkCreate(inputs);

    if (!skipSystemOperations && Array.isArray(results)) {
      for (const result of results) {
        const pkValue = extractPrimaryKey(result, primaryKeyColumn);
        await createAuditLogEntry(
          executor,
          auditTable,
          tableName,
          pkValue,
          'INSERT',
          null,
          captureNewValues ? result : null,
          options
        );
      }
    }

    return results;
  };
}

/**
 * Wrap the bulkUpdate method with audit logging
 */
function wrapBulkUpdateMethod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic repository type
  baseRepo: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic DB type
  executor: Kysely<any>,
  auditTable: string,
  tableName: string,
  primaryKeyColumn: string,
  captureOldValues: boolean,
  captureNewValues: boolean,
  skipSystemOperations: boolean,
  options: AuditOptions
): void {
  if (!baseRepo.bulkUpdate) return;

  const originalBulkUpdate = baseRepo.bulkUpdate.bind(baseRepo);
  baseRepo.bulkUpdate = async function (updates: { id: number | string; data: unknown }[]) {
    // Fetch old values before update if needed
    // Use bulk fetch to avoid N+1 queries (performance optimization)
    const oldValuesMap = new Map<number | string, unknown>();
    if (captureOldValues) {
      const ids = updates.map((u) => u.id);
      const fetchedOldValues = await fetchEntitiesByIds(executor, tableName, ids, primaryKeyColumn);
      // Copy to our map
      for (const [id, entity] of fetchedOldValues) {
        oldValuesMap.set(id, entity);
      }
    }

    const results = await originalBulkUpdate(updates);

    if (!skipSystemOperations && Array.isArray(results)) {
      for (const result of results) {
        const pkValue = extractPrimaryKey(result, primaryKeyColumn);

        await createAuditLogEntry(
          executor,
          auditTable,
          tableName,
          pkValue,
          'UPDATE',
          oldValuesMap.get(pkValue) ?? null,
          captureNewValues ? result : null,
          options
        );
      }
    }

    return results;
  };
}

/**
 * Wrap the bulkDelete method with audit logging
 */
function wrapBulkDeleteMethod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic repository type
  baseRepo: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic DB type
  executor: Kysely<any>,
  auditTable: string,
  tableName: string,
  primaryKeyColumn: string,
  captureOldValues: boolean,
  skipSystemOperations: boolean,
  options: AuditOptions
): void {
  if (!baseRepo.bulkDelete) return;

  const originalBulkDelete = baseRepo.bulkDelete.bind(baseRepo);
  baseRepo.bulkDelete = async function (ids: (number | string)[]) {
    // Fetch old values before deletion if needed
    // Use bulk fetch to avoid N+1 queries (performance optimization)
    const oldValuesMap = new Map<number | string, unknown>();
    if (captureOldValues) {
      const fetchedOldValues = await fetchEntitiesByIds(executor, tableName, ids, primaryKeyColumn);
      // Copy to our map
      for (const [id, entity] of fetchedOldValues) {
        oldValuesMap.set(id, entity);
      }
    }

    const result = await originalBulkDelete(ids);

    if (!skipSystemOperations) {
      for (const id of ids) {
        await createAuditLogEntry(
          executor,
          auditTable,
          tableName,
          id,
          'DELETE',
          oldValuesMap.get(id) ?? null,
          null,
          options
        );
      }
    }

    return result;
  };
}

/**
 * Add audit query methods to repository
 */
function addAuditQueryMethods(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic repository type
  extendedRepo: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic repository type
  baseRepo: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic DB type
  executor: Kysely<any>,
  auditTable: string,
  tableName: string,
  primaryKeyColumn: string,
  logger: KyseraLogger
): void {
  // Get audit history for a specific entity (returns parsed entries)
  extendedRepo.getAuditHistory = async function (
    entityId: number | string,
    options?: AuditPaginationOptions
  ): Promise<ParsedAuditLogEntry[]> {
    // Kysely requires dynamic table access via `any` cast since auditTable is a runtime string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (executor as any)
      .selectFrom(auditTable)
      .selectAll()
      .where('table_name', '=', tableName)
      .where('entity_id', '=', String(entityId))
      .orderBy('changed_at', 'desc');

    // Apply pagination if provided
    if (options?.limit !== undefined) {
      query = query.limit(options.limit);
    }
    if (options?.offset !== undefined) {
      query = query.offset(options.offset);
    }

    const logs = await query.execute();

    return logs.map((log: AuditLogEntry) => ({
      ...log,
      old_values: safeParseJSON<Record<string, unknown>>(log.old_values, null, logger),
      new_values: safeParseJSON<Record<string, unknown>>(log.new_values, null, logger),
      metadata: safeParseJSON<Record<string, unknown>>(log.metadata, null, logger),
    })) as ParsedAuditLogEntry[];
  };

  // Alias for backwards compatibility
  extendedRepo.getAuditLogs = extendedRepo.getAuditHistory;

  // Get a specific audit log entry
  extendedRepo.getAuditLog = async function (auditId: number): Promise<AuditLogEntry | null> {
    // Kysely requires dynamic table access via `any` cast since auditTable is a runtime string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const log = await (executor as any).selectFrom(auditTable).selectAll().where('id', '=', auditId).executeTakeFirst();

    return log as AuditLogEntry | null;
  };

  // Restore entity from audit log
  extendedRepo.restoreFromAudit = async function (auditId: number): Promise<unknown> {
    const log = await extendedRepo.getAuditLog(auditId);
    if (!log) {
      throw new NotFoundError('AuditLog', { id: auditId });
    }

    // For DELETE operations, restore using old_values (the entity before deletion)
    // For UPDATE operations, restore using old_values (revert the update)
    // INSERT operations cannot be restored (the entity already exists)
    if (log.operation === 'DELETE') {
      // DELETE: Re-create the deleted entity using old_values
      if (!log.old_values) {
        throw new BadRequestError(
          `Cannot restore from DELETE audit log ${String(auditId)}: old_values not captured. ` +
            `Ensure captureOldValues is enabled when creating the audit plugin.`
        );
      }

      const parsedValues = safeParseJSON<Record<string, unknown>>(log.old_values, null, logger);
      if (!parsedValues) {
        throw new BadRequestError(`Failed to parse old_values from audit log ${String(auditId)}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Checked above for existence
      return await baseRepo.create!(parsedValues);
    } else if (log.operation === 'UPDATE') {
      // UPDATE: Revert to old_values (the state before the update)
      if (!log.old_values) {
        throw new BadRequestError(
          `Cannot revert UPDATE from audit log ${String(auditId)}: old_values not captured. ` +
            `Ensure captureOldValues is enabled when creating the audit plugin.`
        );
      }

      const parsedValues = safeParseJSON<Record<string, unknown>>(log.old_values, null, logger);
      if (!parsedValues) {
        throw new BadRequestError(`Failed to parse old_values from audit log ${String(auditId)}`);
      }

      const entityId = parsedValues[primaryKeyColumn];
      if (entityId === undefined || entityId === null) {
        throw new BadRequestError(`Primary key '${primaryKeyColumn}' not found in audit log old_values`);
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Checked above for existence
      return await baseRepo.update!(entityId, parsedValues);
    } else {
      throw new BadRequestError(
        `Cannot restore from ${log.operation} operation. ` +
          `Only DELETE (re-creates entity) and UPDATE (reverts to old values) operations can be restored.`
      );
    }
  };

  // Get audit logs for entire table with optional filters and pagination
  extendedRepo.getTableAuditLogs = async function (filters?: AuditFilters): Promise<ParsedAuditLogEntry[]> {
    // Kysely requires dynamic table access via `any` cast since auditTable is a runtime string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (executor as any).selectFrom(auditTable).selectAll().where('table_name', '=', tableName);

    // Apply filters
    if (filters?.operation) {
      query = query.where('operation', '=', filters.operation);
    }
    if (filters?.userId) {
      query = query.where('changed_by', '=', filters.userId);
    }
    if (filters?.startDate) {
      // Format date as 'YYYY-MM-DD HH:MM:SS' which works for string comparison
      // across all databases (SQLite, MySQL, PostgreSQL)
      const startDate = typeof filters.startDate === 'string' ? new Date(filters.startDate) : filters.startDate;
      const formattedStart = startDate
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, '');
      query = query.where('changed_at', '>=', formattedStart);
    }
    if (filters?.endDate) {
      // Format date as 'YYYY-MM-DD HH:MM:SS' which works for string comparison
      // across all databases (SQLite, MySQL, PostgreSQL)
      const endDate = typeof filters.endDate === 'string' ? new Date(filters.endDate) : filters.endDate;
      const formattedEnd = endDate
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, '');
      query = query.where('changed_at', '<=', formattedEnd);
    }

    // Apply ordering
    query = query.orderBy('changed_at', 'desc');

    // Apply pagination if provided
    if (filters?.limit !== undefined) {
      query = query.limit(filters.limit);
    }
    if (filters?.offset !== undefined) {
      query = query.offset(filters.offset);
    }

    const logs = await query.execute();

    return logs.map((log: AuditLogEntry) => ({
      ...log,
      old_values: safeParseJSON<Record<string, unknown>>(log.old_values, null, logger),
      new_values: safeParseJSON<Record<string, unknown>>(log.new_values, null, logger),
      metadata: safeParseJSON<Record<string, unknown>>(log.metadata, null, logger),
    })) as ParsedAuditLogEntry[];
  };

  // Get all changes made by a specific user for this table
  extendedRepo.getUserChanges = async function (
    userId: string,
    options?: AuditPaginationOptions
  ): Promise<ParsedAuditLogEntry[]> {
    // Kysely requires dynamic table access via `any` cast since auditTable is a runtime string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (executor as any)
      .selectFrom(auditTable)
      .selectAll()
      .where('table_name', '=', tableName)
      .where('changed_by', '=', userId)
      .orderBy('changed_at', 'desc');

    // Apply pagination if provided
    if (options?.limit !== undefined) {
      query = query.limit(options.limit);
    }
    if (options?.offset !== undefined) {
      query = query.offset(options.offset);
    }

    const logs = await query.execute();

    return logs.map((log: AuditLogEntry) => ({
      ...log,
      old_values: safeParseJSON<Record<string, unknown>>(log.old_values, null, logger),
      new_values: safeParseJSON<Record<string, unknown>>(log.new_values, null, logger),
      metadata: safeParseJSON<Record<string, unknown>>(log.metadata, null, logger),
    })) as ParsedAuditLogEntry[];
  };
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
 * **IMPORTANT**: Audit logs are transaction-aware and respect ACID properties:
 *
 * - ✅ **Commits with transaction**: If repository operations are wrapped in a transaction,
 *   audit logs will be written as part of that same transaction
 * - ✅ **Rolls back with transaction**: If transaction is rolled back, all audit logs
 *   are also rolled back automatically
 * - ✅ **Atomic logging**: Audit log entries are always written using the same executor
 *   (database connection or transaction) as the operation being audited
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
 *   throw new Error('Rollback')  // User rolled back, but audit log persists ❌
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
    logger = consoleLogger,
  } = options;

  return {
    name: '@kysera/audit',
    version: '0.5.1',

    async onInit<DB>(executor: Kysely<DB>): Promise<void> {
      const exists = await checkAuditTableExists(executor, auditTable);
      if (!exists) {
        await createAuditTable(executor, auditTable);
      }
    },

    extendRepository<T extends object>(repo: T): T {
      // Type check to ensure repo has the expected properties
      if (!isRepositoryLike(repo)) {
        return repo;
      }

      const baseRepo = repo;

      const typedRepo = repo;
      const tableName = typedRepo.tableName ?? '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic DB type
      const executor = typedRepo.executor as Kysely<any>;

      // Check if this table should be audited
      const { tables, excludeTables } = options;

      // If whitelist exists, only audit tables in the whitelist
      if (tables && tables.length > 0 && !tables.includes(tableName)) {
        return repo;
      }

      // If blacklist exists, skip tables in the blacklist
      if (excludeTables?.includes(tableName)) {
        return repo;
      }

      // Wrap all CRUD methods with audit logging
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic repository type
      const mutableRepo = typedRepo as any;

      wrapCreateMethod(
        mutableRepo,
        executor,
        auditTable,
        tableName,
        primaryKeyColumn,
        captureNewValues,
        skipSystemOperations,
        options
      );
      wrapUpdateMethod(
        mutableRepo,
        executor,
        auditTable,
        tableName,
        primaryKeyColumn,
        captureOldValues,
        captureNewValues,
        skipSystemOperations,
        options
      );
      wrapDeleteMethod(
        mutableRepo,
        executor,
        auditTable,
        tableName,
        primaryKeyColumn,
        captureOldValues,
        skipSystemOperations,
        options
      );
      wrapBulkCreateMethod(
        mutableRepo,
        executor,
        auditTable,
        tableName,
        primaryKeyColumn,
        captureNewValues,
        skipSystemOperations,
        options
      );
      wrapBulkUpdateMethod(
        mutableRepo,
        executor,
        auditTable,
        tableName,
        primaryKeyColumn,
        captureOldValues,
        captureNewValues,
        skipSystemOperations,
        options
      );
      wrapBulkDeleteMethod(
        mutableRepo,
        executor,
        auditTable,
        tableName,
        primaryKeyColumn,
        captureOldValues,
        skipSystemOperations,
        options
      );

      // Add audit query methods
      addAuditQueryMethods(mutableRepo, mutableRepo, executor, auditTable, tableName, primaryKeyColumn, logger);

      return baseRepo;
    },
  };
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
    getTimestamp: options.getTimestamp ?? (() => new Date().toISOString()),
  });
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
  // MySQL-specific timestamp formatting
  // MySQL DATETIME doesn't accept ISO 8601 format, needs 'YYYY-MM-DD HH:MM:SS'
  const mysqlTimestamp = (): string => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  return auditPlugin({
    ...options,
    getTimestamp: options.getTimestamp ?? mysqlTimestamp,
  });
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
    getTimestamp: options.getTimestamp ?? (() => new Date().toISOString()),
  });
}
