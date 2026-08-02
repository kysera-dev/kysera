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
import type { RLSSchema, Operation } from './policy/types.js'
import type { RLSActivationOptions } from './policy/activation.js'
import { PolicyRegistry } from './policy/registry.js'
import { SelectTransformer } from './transformer/select.js'
import { MutationGuard } from './transformer/mutation.js'
import { rlsContext } from './context/manager.js'
import { VERSION } from './version.js'
import {
  RLSContextError,
  RLSPolicyViolation,
  RLSPolicyEvaluationError,
  RLSError,
  RLSErrorCodes
} from './errors.js'
import {
  silentLogger,
  shouldApplyToTable,
  fetchRowShared,
  fetchRowsSharedByIds,
  ROW_VISIBILITY_RAW,
  type KyseraLogger,
  type RowFetchExecutor
} from '@kysera/core'
import {
  transformQueryBuilder,
  hasRawDb as hasRawDbUtil,
  applyImpossibleCondition
} from './utils/type-utils.js'

/**
 * RLS Plugin configuration options
 */
export interface RLSPluginOptions<DB = unknown> {
  /** RLS policy schema */
  schema: RLSSchema<DB>

  /**
   * Whitelist of tables to apply RLS to.
   * If provided, only these tables will have RLS enforced.
   * Takes precedence over excludeTables when both are provided.
   */
  tables?: string[]

  /**
   * Tables to exclude from RLS (always bypass policies).
   * Ignored if `tables` whitelist is provided.
   */
  excludeTables?: string[]

  /** Roles that bypass RLS entirely (e.g., ['admin', 'superuser']) */
  bypassRoles?: string[]

  /** Logger instance for RLS operations */
  logger?: KyseraLogger

  /**
   * Require RLS context for all operations (throws if missing)
   *
   * **Security**: Defaults to `true` for secure-by-default behavior.
   * When `true`, missing RLS context throws RLSContextError, preventing
   * unfiltered database access which could expose sensitive data.
   *
   * Only set to `false` if you explicitly want to allow queries without
   * RLS context (not recommended in production).
   *
   * @default true
   * @see allowUnfilteredQueries for explicit unfiltered query control
   */
  requireContext?: boolean

  /**
   * Allow unfiltered queries when RLS context is missing
   *
   * **SECURITY WARNING**: Setting this to `true` allows database queries
   * to execute without RLS filtering when context is missing. This can
   * expose sensitive data across tenant boundaries or user permissions.
   *
   * Only enable this if you:
   * 1. Understand the security implications
   * 2. Have other security controls in place
   * 3. Are running background jobs or system operations that don't have user context
   *
   * When both `requireContext: false` and `allowUnfilteredQueries: false`:
   * - Missing context logs a warning and returns empty results
   *
   * @default false (secure-by-default)
   */
  allowUnfilteredQueries?: boolean

  /** Enable audit logging of policy decisions */
  auditDecisions?: boolean

  /** Custom error handler for policy violations */
  onViolation?: (violation: RLSPolicyViolation) => void

  /**
   * Primary key column name for row lookups.
   * @default 'id'
   */
  primaryKeyColumn?: string

  /**
   * Upper bound on per-row policy evaluations for one bulk repository
   * mutation (`bulkUpdate`/`bulkDelete`).
   *
   * When a table has value-based policies for the operation (allow/deny/
   * validate, or default-deny), bulk mutations fetch the affected rows and
   * evaluate the policies per row — exactly like N single-row calls. A batch
   * larger than this bound throws {@link RLSPolicyEvaluationError} instead of
   * evaluating unboundedly: split the batch, raise the bound, or express the
   * policy as `filter()` so it is enforced in SQL without row fetches.
   *
   * `bulkCreate` checks are not bounded (they evaluate caller-supplied inputs
   * without any row fetch, matching N single `create()` calls).
   *
   * @default 1000
   */
  maxBulkRowChecks?: number

  /**
   * Static inputs for conditional policy activation
   * (`whenEnvironment` / `whenFeature` / `whenTimeRange` / `whenCondition`
   * and `PolicyOptions.condition`).
   *
   * Per call, the activation context is resolved as:
   * - `environment`: `activation.environment`, falling back to `NODE_ENV`
   * - `features`: `activation.features` (feature flags have no env fallback)
   * - `timestamp`: the current time
   * - `auth` / `meta`: taken from the active RLS context
   *
   * A policy whose activation condition returns `false` is treated as absent
   * for that call. A condition that throws fails closed (the policy stays
   * active) and the error is logged. Activation conditions must be
   * synchronous; async conditions are rejected with `RLSSchemaError`.
   */
  activation?: RLSActivationOptions
}

/**
 * Base repository interface for type safety.
 * Type alias for BaseRepositoryLike from @kysera/executor with concrete DB type.
 * @internal
 */
type BaseRepository = BaseRepositoryLike<Record<string, unknown>>

/**
 * Bulk mutation surface of @kysera/repository repositories.
 * BaseRepositoryLike does not declare these, hence the local view.
 * @internal
 */
interface BulkCapableRepository {
  bulkCreate?: (inputs: unknown[]) => Promise<unknown>
  bulkUpdate?: (updates: { id: unknown; data: unknown }[]) => Promise<unknown>
  bulkDelete?: (ids: unknown[]) => Promise<unknown>
}

/** Dependencies of the bulk-mutation guards. @internal */
interface BulkGuardDeps<DB> {
  repo: BulkCapableRepository
  bindTarget: object
  table: string
  guard: MutationGuard<DB>
  logger: KyseraLogger
  auditDecisions: boolean
  bypassRoles: string[]
  onViolation: ((violation: RLSPolicyViolation) => void) | undefined
  maxBulkRowChecks: number
  primaryKeyColumn: string
  hasRawDbInstance: boolean
  rawDb: unknown
  originalFindById: ((id: unknown) => Promise<unknown>) | undefined
}

/**
 * P1.4 — bulk mutations must not bypass value-based policies.
 *
 * The single-row create/update/delete wrappers evaluate allow/deny/validate
 * per row. Without these guards, bulk repository mutations would only get the
 * SQL-level filter() narrowing (applied in interceptQuery): a bulkUpdate
 * could silently skip the very allow() check that denies the equivalent
 * single update. Each guarded bulk method mirrors N single calls exactly:
 *
 * - bulkCreate: checkCreate per input (no row fetch involved)
 * - bulkUpdate/bulkDelete: one raw batched row fetch (through the
 *   per-operation row cache, reusing rows the audit plugin already fetched),
 *   then checkUpdate/checkDelete per row. Rows that do not exist are left to
 *   the original method's not-found handling, like the single-row wrappers.
 *
 * Per-row evaluation is bounded by maxBulkRowChecks; larger batches throw
 * RLSPolicyEvaluationError instead of degrading silently. Tables whose
 * policies for the operation are filter-only (and not default-deny) skip the
 * fetch entirely — SQL narrowing already enforces them.
 *
 * TOCTOU: same caveat as the single-row wrappers — run inside a transaction
 * for check-then-act consistency.
 *
 * Returns an object of guarded methods to spread over the extended
 * repository (empty for methods the repository does not have).
 *
 * @internal
 */
function buildBulkMutationGuards<DB>(deps: BulkGuardDeps<DB>): object {
  const {
    repo,
    bindTarget,
    table,
    guard,
    logger,
    auditDecisions,
    bypassRoles,
    onViolation,
    maxBulkRowChecks,
    primaryKeyColumn,
    hasRawDbInstance,
    rawDb,
    originalFindById
  } = deps

  const originalBulkCreate = repo.bulkCreate?.bind(bindTarget)
  const originalBulkUpdate = repo.bulkUpdate?.bind(bindTarget)
  const originalBulkDelete = repo.bulkDelete?.bind(bindTarget)

  /** Mirrors the context gate of the single-row wrappers. */
  const needsPolicyChecks = (ctx: ReturnType<typeof rlsContext.getContextOrNull>): boolean =>
    ctx !== null &&
    !ctx.auth.isSystem &&
    !bypassRoles.some(role => ctx.auth.roles.includes(role))

  /** Shared onViolation/audit-logging for denied operations. */
  const reportViolation = (error: unknown, operation: string, userId: unknown): void => {
    if (error instanceof RLSPolicyViolation) {
      onViolation?.(error)
      if (auditDecisions) {
        logger.warn?.(`[RLS] ${operation} denied`, { table, userId, reason: error.reason })
      }
    }
  }

  /**
   * Enforce the per-row evaluation bound. Value-based policies cannot be
   * expressed in SQL, so each affected row must be fetched and checked; an
   * unbounded batch would turn one repository call into an arbitrarily large
   * policy-evaluation run.
   */
  const assertBulkBound = (operation: 'update' | 'delete', affected: number): void => {
    if (affected > maxBulkRowChecks) {
      throw new RLSPolicyEvaluationError(
        operation,
        table,
        `bulk mutation targets ${affected} rows, but value-based policies ` +
          `(allow/deny/validate or default-deny) require per-row evaluation, ` +
          `bounded at maxBulkRowChecks=${maxBulkRowChecks}. Split the call into ` +
          `smaller batches, raise 'maxBulkRowChecks', or express the policy as ` +
          `filter() so it is enforced in SQL without row fetches.`
      )
    }
  }

  /**
   * Fetch the target rows of a bulk mutation for per-row policy checks.
   * One raw batched SELECT through the per-operation row cache (rows primed
   * by the audit plugin's old-values fetch are reused); falls back to
   * originalFindById for tests/mocks, mirroring the single-row wrappers.
   */
  const fetchRowsForBulkCheck = async (
    operation: 'update' | 'delete',
    ids: readonly (number | string)[]
  ): Promise<Map<number | string, Record<string, unknown> | undefined>> => {
    if (hasRawDbInstance) {
      return await fetchRowsSharedByIds(
        rawDb as RowFetchExecutor,
        table,
        primaryKeyColumn,
        ids,
        ROW_VISIBILITY_RAW
      )
    }
    if (originalFindById) {
      const rows = new Map<number | string, Record<string, unknown> | undefined>()
      for (const id of ids) {
        const row = await originalFindById(id)
        rows.set(id, (row ?? undefined) as Record<string, unknown> | undefined)
      }
      return rows
    }
    throw new RLSError(
      `Repository does not support bulk ${operation} operation`,
      RLSErrorCodes.RLS_POLICY_INVALID
    )
  }

  return {
    ...(originalBulkCreate
      ? {
          async bulkCreate(inputs: unknown[]): Promise<unknown> {
            const ctx = rlsContext.getContextOrNull()

            if (needsPolicyChecks(ctx) && inputs.length > 0) {
              try {
                for (const input of inputs) {
                  await guard.checkCreate(table, input as Record<string, unknown>)
                }

                if (auditDecisions) {
                  logger.info?.('[RLS] Bulk create allowed', {
                    table,
                    rows: inputs.length,
                    userId: ctx?.auth.userId
                  })
                }
              } catch (error) {
                reportViolation(error, 'Bulk create', ctx?.auth.userId)
                throw error
              }
            }

            return await originalBulkCreate(inputs)
          }
        }
      : {}),

    ...(originalBulkUpdate
      ? {
          async bulkUpdate(updates: { id: unknown; data: unknown }[]): Promise<unknown> {
            const ctx = rlsContext.getContextOrNull()

            if (
              needsPolicyChecks(ctx) &&
              updates.length > 0 &&
              guard.requiresRowChecks(table, 'update')
            ) {
              assertBulkBound('update', updates.length)

              const ids = updates.map(u => u.id as number | string)
              const rows = await fetchRowsForBulkCheck('update', ids)

              try {
                for (const { id, data } of updates) {
                  const existingRow = rows.get(id as number | string)
                  if (existingRow) {
                    await guard.checkUpdate(table, existingRow, data as Record<string, unknown>)
                  }
                }

                if (auditDecisions) {
                  logger.info?.('[RLS] Bulk update allowed', {
                    table,
                    rows: updates.length,
                    userId: ctx?.auth.userId
                  })
                }
              } catch (error) {
                reportViolation(error, 'Bulk update', ctx?.auth.userId)
                throw error
              }
            }

            return await originalBulkUpdate(updates)
          }
        }
      : {}),

    ...(originalBulkDelete
      ? {
          async bulkDelete(ids: unknown[]): Promise<unknown> {
            const ctx = rlsContext.getContextOrNull()

            if (
              needsPolicyChecks(ctx) &&
              ids.length > 0 &&
              guard.requiresRowChecks(table, 'delete')
            ) {
              assertBulkBound('delete', ids.length)

              const rows = await fetchRowsForBulkCheck('delete', ids as (number | string)[])

              try {
                for (const id of ids) {
                  const existingRow = rows.get(id as number | string)
                  if (existingRow) {
                    await guard.checkDelete(table, existingRow)
                  }
                }

                if (auditDecisions) {
                  logger.info?.('[RLS] Bulk delete allowed', {
                    table,
                    rows: ids.length,
                    userId: ctx?.auth.userId
                  })
                }
              } catch (error) {
                reportViolation(error, 'Bulk delete', ctx?.auth.userId)
                throw error
              }
            }

            return await originalBulkDelete(ids)
          }
        }
      : {})
  }
}

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
// eslint-disable-next-line max-lines-per-function
export function rlsPlugin<DB>(options: RLSPluginOptions<DB>): Plugin {
  const {
    schema,
    tables,
    excludeTables,
    bypassRoles = [],
    logger = silentLogger,
    requireContext = true, // SECURITY: Changed to true for secure-by-default (CRIT-2 fix)
    allowUnfilteredQueries = false, // SECURITY: Explicit opt-in for unfiltered queries
    auditDecisions = false,
    onViolation,
    primaryKeyColumn = 'id',
    maxBulkRowChecks = 1000,
    activation
  } = options

  // Registry and transformers (initialized in onInit; undefined until then —
  // createExecutorSync legitimately skips onInit)
  let registry: PolicyRegistry<DB> | undefined
  let selectTransformer: SelectTransformer<DB> | undefined
  let mutationGuard: MutationGuard<DB> | undefined

  /**
   * Fail loudly when the plugin is used before onInit ran. Without this,
   * createExecutorSync + a query produced an opaque TypeError deep inside.
   */
  function requireInit<T>(value: T | undefined): T {
    if (value === undefined) {
      throw new RLSError(
        '[RLS] Plugin used before initialization. ' +
          'Use createExecutor()/createORM() (async, runs onInit), or await plugin.onInit(db) manually before querying.',
        RLSErrorCodes.RLS_POLICY_INVALID
      )
    }
    return value
  }

  /**
   * Secure-by-default handling when no RLS context is active
   * (SECURITY FIX CRIT-2). SELECT/UPDATE/DELETE get an impossible or scoped
   * predicate so they touch nothing; INSERT passes through (no WHERE to
   * narrow — value-level checks run in the repository wrappers).
   */
  function handleMissingContext<QB>(
    qb: QB,
    operation: QueryBuilderContext['operation'],
    table: string,
    transformer: SelectTransformer<DB>
  ): QB {
    if (requireContext) {
      throw new RLSContextError(
        `RLS context required but not found for ${operation} on ${table}. ` +
          `This prevents unfiltered database access. ` +
          `Either provide RLS context or set 'requireContext: false' with 'allowUnfilteredQueries: true' if intentional.`
      )
    }

    if (!allowUnfilteredQueries) {
      // Log warning and return safe empty result
      logger.warn?.(
        `[RLS] Missing context for ${operation} on ${table}. ` +
          `Queries will return empty results for security. ` +
          `Set 'allowUnfilteredQueries: true' to allow unfiltered access (not recommended).`
      )
      // For SELECT, apply impossible condition to return no rows
      if (operation === 'select') {
        return transformQueryBuilder(qb, operation, selectQb =>
          applyImpossibleCondition(selectQb)
        )
      }
      // For UPDATE/DELETE, the same impossible predicate makes the statement
      // touch no rows — without it, a missing context would let DAL-path
      // writes mutate ANY tenant's rows
      if (operation === 'update' || operation === 'delete') {
        return transformer.transformMutation(qb, table)
      }
      return qb
    }

    // allowUnfilteredQueries is true - allow but log warning
    logger.warn?.(
      `[RLS] No context for ${operation} on ${table}. ` +
        `Allowing unfiltered query due to 'allowUnfilteredQueries: true'. ` +
        `This may expose sensitive data.`
    )
    return qb
  }

  return {
    name: '@kysera/rls',
    version: VERSION,

    // SECURITY plugin: must run FIRST to enforce access policies before other plugins
    priority: 1000,

    // No dependencies by default
    dependencies: [],

    /**
     * Initialize plugin - compile policies
     */
    onInit<TDB>(_executor: Kysely<TDB>): void {
      logger.info?.('[RLS] Initializing RLS plugin', {
        tables: Object.keys(schema).length,
        excludeTables: excludeTables?.length ?? 0,
        bypassRoles: bypassRoles.length
      })

      // Create and compile registry
      // Type assertion: The plugin is configured with a specific DB schema,
      // but onInit receives a generic TDB. We use the schema's DB type.
      registry = new PolicyRegistry<DB>(schema, { logger })
      registry.validate()

      // Create transformers
      selectTransformer = new SelectTransformer<DB>(registry, activation)
      mutationGuard = new MutationGuard<DB>(registry, activation)

      logger.info?.('[RLS] RLS plugin initialized successfully')
    },

    /**
     * Cleanup resources when executor is destroyed
     */
    onDestroy() {
      // registry is undefined when onInit never ran (createExecutorSync)
      registry?.clear()
      logger.info?.('[RLS] RLS plugin destroyed, cleared policy registry')
    },

    /**
     * Intercept queries to apply RLS filtering
     *
     * This hook is called for every query builder operation. For SELECT queries,
     * it applies filter policies as WHERE conditions. For mutations, it marks
     * that RLS validation is required (performed in extendRepository).
     */
    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      const { operation, table } = context

      // Skip if table is excluded
      if (!shouldApplyToTable(table, { tables, excludeTables })) {
        logger.debug?.(`[RLS] Skipping RLS for excluded table: ${table}`)
        return qb
      }

      // SECURITY: RLS deliberately honors NO metadata-based bypass. The
      // metadata channel is publicly reachable via withPluginMetadata(), so a
      // metadata switch (the old `skipRLS` flag) would let any caller disable
      // row security without context, roles, or an audit trail. Legitimate
      // bypasses are context-bound and auditable: ctx.auth.isSystem,
      // bypassRoles, or repo.withoutRLS().

      // Fail loudly if onInit never ran (createExecutorSync misuse)
      const transformer = requireInit(selectTransformer)

      // Check for context
      const ctx = rlsContext.getContextOrNull()

      if (!ctx) {
        return handleMissingContext(qb, operation, table, transformer)
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

      // Apply SELECT filtering (qualify by alias when the table was aliased)
      if (operation === 'select') {
        const referenceName = context.alias ?? table
        try {
          const transformed = transformQueryBuilder(
            qb,
            operation,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            selectQb => transformer.transform(selectQb as any, table, referenceName) as any
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

      // Enforce filter policies on UPDATE/DELETE at the SQL level so rows
      // outside the caller's row scope are untouchable through ANY path —
      // the DAL/executor path never goes through repository wrappers.
      // The repository-level allow/validate guards remain as defense in
      // depth (they add row-value checks filters cannot express).
      if (operation === 'update' || operation === 'delete') {
        const referenceName = context.alias ?? table
        try {
          const transformed = transformer.transformMutation(qb, table, referenceName)

          if (auditDecisions) {
            logger.info?.('[RLS] Mutation filter applied', {
              table,
              operation,
              userId: ctx.auth.userId
            })
          }

          return transformed
        } catch (error) {
          logger.error?.('[RLS] Error applying mutation filter', { table, error })
          throw error
        }
      }

      // INSERT has no WHERE clause to narrow; value-level policy checks
      // (allow/validate) run in the repository wrappers. DAL-path inserts
      // must go through the repository or database-native RLS.
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

      // Fail loudly if onInit never ran (createExecutorSync misuse)
      const rlsRegistry = requireInit(registry)
      const guard = requireInit(mutationGuard)

      const baseRepo = repo as unknown as BaseRepository

      const table = baseRepo.tableName

      // Skip excluded tables
      if (!shouldApplyToTable(table, { tables, excludeTables })) {
        logger.debug?.(`[RLS] Skipping repository extension for excluded table: ${table}`)
        return repo
      }

      // Skip if table not in schema
      if (!rlsRegistry.hasTable(table)) {
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

      // Guarded bulk mutations (P1.4) — see buildBulkMutationGuards
      const bulkGuards = buildBulkMutationGuards({
        repo: repo as BulkCapableRepository,
        bindTarget: baseRepo,
        table,
        guard,
        logger,
        auditDecisions,
        bypassRoles,
        onViolation,
        maxBulkRowChecks,
        primaryKeyColumn,
        hasRawDbInstance,
        rawDb,
        originalFindById
      })

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
              await guard.checkCreate(table, data as Record<string, unknown>)

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
         * Wrapped update with RLS check.
         *
         * WARNING (TOCTOU): The existing row is fetched before the policy check.
         * In concurrent environments, the row could be modified between fetch and
         * check. For safety, call this method within a transaction. The underlying
         * MutationGuard.checkUpdate documents this in detail.
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
              // Raw fetch through the per-operation row cache: when the audit
              // plugin (outermost wrapper) already fetched this row for
              // old-values capture, the cached row is reused instead of
              // issuing a second identical SELECT (see @kysera/core row-cache)
              existingRow = await fetchRowShared(
                rawDb as unknown as RowFetchExecutor,
                table,
                primaryKeyColumn,
                id,
                ROW_VISIBILITY_RAW
              )
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
              await guard.checkUpdate(
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
         * Wrapped delete with RLS check.
         *
         * WARNING (TOCTOU): The existing row is fetched before the policy check.
         * In concurrent environments, the row could be modified between fetch and
         * check. For safety, call this method within a transaction. The underlying
         * MutationGuard.checkDelete documents this in detail.
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
              // Raw fetch through the per-operation row cache (shared with
              // the audit plugin's old-values fetch, see update() above)
              existingRow = await fetchRowShared(
                rawDb as unknown as RowFetchExecutor,
                table,
                primaryKeyColumn,
                id,
                ROW_VISIBILITY_RAW
              )
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
              await guard.checkDelete(table, existingRow as Record<string, unknown>)

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

        // Guarded bulk mutations (P1.4): per-row value-policy enforcement,
        // matching N single-row calls — see buildBulkMutationGuards
        ...bulkGuards,

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
                return await guard.checkRead(table, row)
              case 'create':
                await guard.checkCreate(table, row)
                return true
              case 'update':
                await guard.checkUpdate(table, row, {})
                return true
              case 'delete':
                await guard.checkDelete(table, row)
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
