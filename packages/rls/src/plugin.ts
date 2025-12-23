/**
 * RLS Plugin for Kysera Repository
 *
 * Implements Row-Level Security as a Kysera plugin, providing:
 * - Automatic query filtering for SELECT operations
 * - Policy enforcement for CREATE, UPDATE, DELETE operations
 * - Repository method extensions for RLS-aware operations
 * - System context bypass for privileged operations
 *
 * @module @kysera/rls
 */

import type { Plugin, QueryBuilderContext, BaseRepositoryLike } from '@kysera/executor'
import { getRawDb, isRepositoryLike } from '@kysera/executor'
import type { Kysely } from 'kysely'
import { z } from 'zod'
import type { RLSSchema, Operation } from './policy/types.js'
import { PolicyRegistry } from './policy/registry.js'
import { SelectTransformer } from './transformer/select.js'
import { MutationGuard } from './transformer/mutation.js'
import { rlsContext } from './context/manager.js'
import { VERSION } from './version.js'
import { RLSContextError, RLSPolicyViolation, RLSError, RLSErrorCodes } from './errors.js'
import { silentLogger, type KyseraLogger } from '@kysera/core'
import {
  transformQueryBuilder,
  selectFromDynamicTable,
  whereIdEquals,
  hasRawDb as hasRawDbUtil
} from './utils/type-utils.js'

/**
 * RLS Plugin configuration options
 */
export interface RLSPluginOptions<DB = unknown> {
  /** RLS policy schema */
  schema: RLSSchema<DB>

  /** Tables to skip RLS for (always bypass policies) */
  skipTables?: string[]

  /** Roles that bypass RLS entirely (e.g., ['admin', 'superuser']) */
  bypassRoles?: string[]

  /** Logger instance for RLS operations */
  logger?: KyseraLogger

  /** Require RLS context for all operations (throws if missing) */
  requireContext?: boolean

  /** Enable audit logging of policy decisions */
  auditDecisions?: boolean

  /** Custom error handler for policy violations */
  onViolation?: (violation: RLSPolicyViolation) => void

  /**
   * Primary key column name for row lookups.
   * @default 'id'
   */
  primaryKeyColumn?: string
}

/**
 * Zod schema for RLSPluginOptions
 * Used for validation and configuration in the kysera-cli.
 * Note: 'schema' and 'onViolation' are not included as they are complex runtime objects.
 */
export const RLSPluginOptionsSchema = z.object({
  skipTables: z.array(z.string()).optional(),
  bypassRoles: z.array(z.string()).optional(),
  requireContext: z.boolean().optional(),
  auditDecisions: z.boolean().optional(),
  primaryKeyColumn: z.string().optional()
})

/**
 * Base repository interface for type safety.
 * Type alias for BaseRepositoryLike from @kysera/executor with concrete DB type.
 * @internal
 */
type BaseRepository = BaseRepositoryLike<Record<string, unknown>>

/**
 * Create RLS plugin for Kysera
 *
 * The RLS plugin provides declarative row-level security for your database operations.
 * It automatically filters SELECT queries and validates mutations (CREATE, UPDATE, DELETE)
 * against your policy schema.
 *
 * @example
 * ```typescript
 * import { rlsPlugin, defineRLSSchema, allow, filter } from '@kysera/rls';
 * import { createORM } from '@kysera/repository';
 *
 * // Define your RLS schema
 * const schema = defineRLSSchema<Database>({
 *   resources: {
 *     policies: [
 *       // Filter reads by tenant
 *       filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
 *       // Allow updates for resource owners
 *       allow('update', ctx => ctx.auth.userId === ctx.row.owner_id),
 *       // Validate creates belong to user's tenant
 *       validate('create', ctx => ctx.data.tenant_id === ctx.auth.tenantId),
 *     ],
 *   },
 * });
 *
 * // Create repository with RLS plugin
 * const orm = await createORM(db, [
 *   rlsPlugin({ schema }),
 * ]);
 *
 * // Use within RLS context
 * await rlsContext.runAsync(
 *   {
 *     auth: { userId: 1, tenantId: 100, roles: ['user'], isSystem: false },
 *     timestamp: new Date(),
 *   },
 *   async () => {
 *     // All queries automatically filtered by tenant_id
 *     const resources = await orm.resources.findAll();
 *   }
 * );
 * ```
 *
 * @param options - Plugin configuration options
 * @returns Kysera plugin instance
 */
export function rlsPlugin<DB>(options: RLSPluginOptions<DB>): Plugin {
  const {
    schema,
    skipTables = [],
    bypassRoles = [],
    logger = silentLogger,
    requireContext = false,
    auditDecisions = false,
    onViolation,
    primaryKeyColumn = 'id'
  } = options

  // Registry and transformers (initialized in onInit)
  let registry: PolicyRegistry<DB>
  let selectTransformer: SelectTransformer<DB>
  let mutationGuard: MutationGuard<DB>

  return {
    name: '@kysera/rls',
    version: VERSION,

    // Run after soft-delete (priority 0), before audit
    priority: 50,

    // No dependencies by default
    dependencies: [],

    /**
     * Initialize plugin - compile policies
     */
    onInit<TDB>(_executor: Kysely<TDB>): void {
      logger.info?.('[RLS] Initializing RLS plugin', {
        tables: Object.keys(schema).length,
        skipTables: skipTables.length,
        bypassRoles: bypassRoles.length
      })

      // Create and compile registry
      // Type assertion: The plugin is configured with a specific DB schema,
      // but onInit receives a generic TDB. We use the schema's DB type.
      registry = new PolicyRegistry<DB>(schema)
      registry.validate()

      // Create transformers
      selectTransformer = new SelectTransformer<DB>(registry)
      mutationGuard = new MutationGuard<DB>(registry)

      logger.info?.('[RLS] RLS plugin initialized successfully')
    },

    /**
     * Intercept queries to apply RLS filtering
     *
     * This hook is called for every query builder operation. For SELECT queries,
     * it applies filter policies as WHERE conditions. For mutations, it marks
     * that RLS validation is required (performed in extendRepository).
     */
    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      const { operation, table, metadata } = context

      // Skip if table is excluded
      if (skipTables.includes(table)) {
        logger.debug?.(`[RLS] Skipping RLS for excluded table: ${table}`)
        return qb
      }

      // Skip if explicitly disabled via metadata
      if (metadata['skipRLS'] === true) {
        logger.debug?.(`[RLS] Skipping RLS (explicit skip): ${table}`)
        return qb
      }

      // Check for context
      const ctx = rlsContext.getContextOrNull()

      if (!ctx) {
        if (requireContext) {
          throw new RLSContextError('RLS context required but not found')
        }
        logger.warn?.(`[RLS] No context for ${operation} on ${table}`)
        return qb
      }

      // Check if system user (bypass RLS)
      if (ctx.auth.isSystem) {
        logger.debug?.(`[RLS] Bypassing RLS (system user): ${table}`)
        return qb
      }

      // Check bypass roles
      if (bypassRoles.some(role => ctx.auth.roles.includes(role))) {
        logger.debug?.(`[RLS] Bypassing RLS (bypass role): ${table}`)
        return qb
      }

      // Apply SELECT filtering
      if (operation === 'select') {
        try {
          const transformed = transformQueryBuilder(
            qb,
            operation,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            selectQb => selectTransformer.transform(selectQb as any, table) as any
          )

          if (auditDecisions) {
            logger.info?.('[RLS] Filter applied', {
              table,
              operation,
              userId: ctx.auth.userId
            })
          }

          return transformed
        } catch (error) {
          logger.error?.('[RLS] Error applying filter', { table, error })
          throw error
        }
      }

      // For mutations, mark that RLS check is needed (done in extendRepository)
      if (operation === 'insert' || operation === 'update' || operation === 'delete') {
        metadata['__rlsRequired'] = true
        metadata['__rlsTable'] = table
      }

      return qb
    },

    /**
     * Extend repository with RLS-aware methods
     *
     * Wraps create, update, and delete methods to enforce RLS policies.
     * Also adds utility methods for bypassing RLS and checking access.
     */
    extendRepository<T extends object>(repo: T): T {
      // Use the shared type guard from @kysera/executor
      if (!isRepositoryLike(repo)) {
        return repo
      }

      const baseRepo = repo as unknown as BaseRepository

      const table = baseRepo.tableName

      // Skip excluded tables
      if (skipTables.includes(table)) {
        return repo
      }

      // Skip if table not in schema
      if (!registry.hasTable(table)) {
        logger.debug?.(`[RLS] Table "${table}" not in RLS schema, skipping`)
        return repo
      }

      logger.debug?.(`[RLS] Extending repository for table: ${table}`)

      // Store original methods
      const originalCreate = baseRepo.create?.bind(baseRepo)
      const originalUpdate = baseRepo.update?.bind(baseRepo)
      const originalDelete = baseRepo.delete?.bind(baseRepo)
      const originalFindById = baseRepo.findById?.bind(baseRepo)

      // Get raw db for internal queries that need to bypass RLS
      // If executor doesn't have __rawDb (e.g., in tests), we'll use originalFindById
      const rawDb = getRawDb(baseRepo.executor)
      const hasRawDbInstance = hasRawDbUtil(baseRepo.executor)

      const extendedRepo = {
        ...baseRepo,

        /**
         * Wrapped create with RLS check
         */
        async create(data: unknown): Promise<unknown> {
          if (!originalCreate) {
            throw new RLSError(
              'Repository does not support create operation',
              RLSErrorCodes.RLS_POLICY_INVALID
            )
          }

          const ctx = rlsContext.getContextOrNull()

          // Check RLS if context exists and not system/bypass
          if (
            ctx &&
            !ctx.auth.isSystem &&
            !bypassRoles.some(role => ctx.auth.roles.includes(role))
          ) {
            try {
              await mutationGuard.checkCreate(table, data as Record<string, unknown>)

              if (auditDecisions) {
                logger.info?.('[RLS] Create allowed', { table, userId: ctx.auth.userId })
              }
            } catch (error) {
              if (error instanceof RLSPolicyViolation) {
                onViolation?.(error)
                if (auditDecisions) {
                  logger.warn?.('[RLS] Create denied', {
                    table,
                    userId: ctx.auth.userId,
                    reason: error.reason
                  })
                }
              }
              throw error
            }
          }

          return await originalCreate(data)
        },

        /**
         * Wrapped update with RLS check
         */
        async update(id: unknown, data: unknown): Promise<unknown> {
          if (!originalUpdate) {
            throw new RLSError(
              'Repository does not support update operation',
              RLSErrorCodes.RLS_POLICY_INVALID
            )
          }

          const ctx = rlsContext.getContextOrNull()

          if (
            ctx &&
            !ctx.auth.isSystem &&
            !bypassRoles.some(role => ctx.auth.roles.includes(role))
          ) {
            // Fetch existing row for policy evaluation
            // Use raw db if available to bypass RLS filtering and prevent self-interception
            let existingRow: unknown

            if (hasRawDbInstance) {
              // Use raw db to bypass RLS filtering
              const query = selectFromDynamicTable(rawDb, table)
              existingRow = await whereIdEquals(query, id, primaryKeyColumn).executeTakeFirst()
            } else if (originalFindById) {
              // Fallback to originalFindById for tests/mocks
              existingRow = await originalFindById(id)
            } else {
              throw new RLSError(
                'Repository does not support update operation',
                RLSErrorCodes.RLS_POLICY_INVALID
              )
            }

            if (!existingRow) {
              // Let the original method handle not found
              return await originalUpdate(id, data)
            }

            try {
              await mutationGuard.checkUpdate(
                table,
                existingRow as Record<string, unknown>,
                data as Record<string, unknown>
              )

              if (auditDecisions) {
                logger.info?.('[RLS] Update allowed', { table, id, userId: ctx.auth.userId })
              }
            } catch (error) {
              if (error instanceof RLSPolicyViolation) {
                onViolation?.(error)
                if (auditDecisions) {
                  logger.warn?.('[RLS] Update denied', {
                    table,
                    id,
                    userId: ctx.auth.userId,
                    reason: error.reason
                  })
                }
              }
              throw error
            }
          }

          return await originalUpdate(id, data)
        },

        /**
         * Wrapped delete with RLS check
         */
        async delete(id: unknown): Promise<unknown> {
          if (!originalDelete) {
            throw new RLSError(
              'Repository does not support delete operation',
              RLSErrorCodes.RLS_POLICY_INVALID
            )
          }

          const ctx = rlsContext.getContextOrNull()

          if (
            ctx &&
            !ctx.auth.isSystem &&
            !bypassRoles.some(role => ctx.auth.roles.includes(role))
          ) {
            // Fetch existing row for policy evaluation
            // Use raw db if available to bypass RLS filtering and prevent self-interception
            let existingRow: unknown

            if (hasRawDbInstance) {
              // Use raw db to bypass RLS filtering
              const query = selectFromDynamicTable(rawDb, table)
              existingRow = await whereIdEquals(query, id, primaryKeyColumn).executeTakeFirst()
            } else if (originalFindById) {
              // Fallback to originalFindById for tests/mocks
              existingRow = await originalFindById(id)
            } else {
              throw new RLSError(
                'Repository does not support delete operation',
                RLSErrorCodes.RLS_POLICY_INVALID
              )
            }

            if (!existingRow) {
              // Let the original method handle not found
              return await originalDelete(id)
            }

            try {
              await mutationGuard.checkDelete(table, existingRow as Record<string, unknown>)

              if (auditDecisions) {
                logger.info?.('[RLS] Delete allowed', { table, id, userId: ctx.auth.userId })
              }
            } catch (error) {
              if (error instanceof RLSPolicyViolation) {
                onViolation?.(error)
                if (auditDecisions) {
                  logger.warn?.('[RLS] Delete denied', {
                    table,
                    id,
                    userId: ctx.auth.userId,
                    reason: error.reason
                  })
                }
              }
              throw error
            }
          }

          return await originalDelete(id)
        },

        /**
         * Bypass RLS for specific operation
         * Requires existing context
         *
         * @example
         * ```typescript
         * // Perform operation as system user
         * const result = await repo.withoutRLS(async () => {
         *   return repo.findAll(); // No RLS filtering
         * });
         * ```
         */
        async withoutRLS<R>(fn: () => Promise<R>): Promise<R> {
          return await rlsContext.asSystemAsync(fn)
        },

        /**
         * Check if current user can perform operation on a row
         *
         * @example
         * ```typescript
         * const post = await repo.findById(1);
         * const canUpdate = await repo.canAccess('update', post);
         * if (canUpdate) {
         *   await repo.update(1, { title: 'New title' });
         * }
         * ```
         */
        async canAccess(operation: Operation, row: Record<string, unknown>): Promise<boolean> {
          const ctx = rlsContext.getContextOrNull()
          if (!ctx) return false
          if (ctx.auth.isSystem) return true
          if (bypassRoles.some(role => ctx.auth.roles.includes(role))) return true

          try {
            switch (operation) {
              case 'read':
                return await mutationGuard.checkRead(table, row)
              case 'create':
                await mutationGuard.checkCreate(table, row)
                return true
              case 'update':
                await mutationGuard.checkUpdate(table, row, {})
                return true
              case 'delete':
                await mutationGuard.checkDelete(table, row)
                return true
              default:
                return false
            }
          } catch (error) {
            logger.debug?.('[RLS] Access check failed', {
              table,
              operation,
              error: error instanceof Error ? error.message : String(error)
            })
            return false
          }
        }
      }

      return extendedRepo as T
    }
  }
}
