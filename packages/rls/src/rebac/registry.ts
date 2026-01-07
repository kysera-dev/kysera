/**
 * ReBAC Policy Registry
 *
 * Manages relationship definitions and ReBAC policies for RLS.
 *
 * @module @kysera/rls/rebac/registry
 */

import type {
  RelationshipPath,
  RelationshipStep,
  ReBAcPolicyDefinition,
  ReBAcSchema,
  TableReBAcConfig,
  CompiledRelationshipPath,
  CompiledReBAcPolicy
} from './types.js'
import type { PolicyEvaluationContext, Operation } from '../policy/types.js'
import { RLSSchemaError } from '../errors.js'
import { silentLogger, type KyseraLogger } from '@kysera/core'

// ============================================================================
// ReBAC Registry
// ============================================================================

/**
 * Internal compiled table configuration
 */
interface TableReBAcCompiled {
  relationships: Map<string, CompiledRelationshipPath>
  policies: CompiledReBAcPolicy[]
}

/**
 * ReBAC Registry
 *
 * Manages relationship paths and ReBAC policies across tables.
 *
 * @example
 * ```typescript
 * const registry = new ReBAcRegistry();
 *
 * // Register relationship paths and policies
 * registry.loadSchema({
 *   products: {
 *     relationships: [
 *       shopOrgMembershipPath('products', 'shop_id')
 *     ],
 *     policies: [
 *       {
 *         type: 'filter',
 *         operation: 'read',
 *         relationshipPath: 'products_shop_org_membership',
 *         endCondition: ctx => ({
 *           user_id: ctx.auth.userId,
 *           status: 'active'
 *         })
 *       }
 *     ]
 *   }
 * });
 *
 * // Get policies for a table
 * const policies = registry.getPolicies('products', 'read');
 * ```
 */
export class ReBAcRegistry<DB = unknown> {
  private tables = new Map<string, TableReBAcCompiled>()
  private globalRelationships = new Map<string, CompiledRelationshipPath>()
  private logger: KyseraLogger

  constructor(schema?: ReBAcSchema<DB>, options?: { logger?: KyseraLogger }) {
    this.logger = options?.logger ?? silentLogger
    if (schema) {
      this.loadSchema(schema)
    }
  }

  /**
   * Load ReBAC schema
   */
  loadSchema(schema: ReBAcSchema<DB>): void {
    for (const [table, config] of Object.entries(schema)) {
      if (!config) continue
      this.registerTable(table, config as TableReBAcConfig)
    }
  }

  /**
   * Register ReBAC configuration for a single table
   */
  registerTable(table: string, config: TableReBAcConfig): void {
    const compiled: TableReBAcCompiled = {
      relationships: new Map(),
      policies: []
    }

    // Compile relationships
    for (const rel of config.relationships) {
      const compiledPath = this.compileRelationshipPath(rel, table)
      compiled.relationships.set(rel.name, compiledPath)
      // Also register globally for cross-table references
      this.globalRelationships.set(rel.name, compiledPath)
    }

    // Compile policies
    for (let i = 0; i < config.policies.length; i++) {
      const policy = config.policies[i]
      if (!policy) continue

      const policyName = policy.name ?? `${table}_rebac_policy_${i}`
      const compiledPolicy = this.compilePolicy(policy, policyName, table, compiled.relationships)
      compiled.policies.push(compiledPolicy)
    }

    // Sort by priority
    compiled.policies.sort((a, b) => b.priority - a.priority)

    this.tables.set(table, compiled)
    this.logger.info?.(`[ReBAC] Registered table: ${table}`, {
      relationships: config.relationships.length,
      policies: config.policies.length
    })
  }

  /**
   * Register a global relationship path (available to all tables)
   */
  registerRelationship(path: RelationshipPath): void {
    if (!path.steps.length) {
      throw new RLSSchemaError(`Relationship path "${path.name}" has no steps`, {
        path: path.name
      })
    }

    const compiled = this.compileRelationshipPath(path, path.steps[0]!.from)
    this.globalRelationships.set(path.name, compiled)
  }

  /**
   * Get ReBAC policies for a table and operation
   */
  getPolicies(table: string, operation: Operation): CompiledReBAcPolicy[] {
    const config = this.tables.get(table)
    if (!config) return []

    return config.policies.filter(p => p.operations.has(operation) || p.operations.has('all'))
  }

  /**
   * Get a specific relationship path
   */
  getRelationship(name: string, table?: string): CompiledRelationshipPath | undefined {
    // Check table-specific first
    if (table) {
      const tableConfig = this.tables.get(table)
      const tablePath = tableConfig?.relationships.get(name)
      if (tablePath) return tablePath
    }

    // Fall back to global
    return this.globalRelationships.get(name)
  }

  /**
   * Check if table has ReBAC configuration
   */
  hasTable(table: string): boolean {
    return this.tables.has(table)
  }

  /**
   * Get all registered table names
   */
  getTables(): string[] {
    return Array.from(this.tables.keys())
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.tables.clear()
    this.globalRelationships.clear()
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Compile a relationship path definition
   */
  private compileRelationshipPath(path: RelationshipPath, sourceTable: string): CompiledRelationshipPath {
    if (path.steps.length === 0) {
      throw new RLSSchemaError(`Relationship path "${path.name}" must have at least one step`, {
        path: path.name
      })
    }

    const compiledSteps: Required<RelationshipStep>[] = path.steps.map((step, index) => {
      // Validate step
      if (!step.from || !step.to) {
        throw new RLSSchemaError(
          `Relationship step ${index} in "${path.name}" must have 'from' and 'to' tables`,
          { path: path.name, step: index }
        )
      }

      // Fill defaults
      return {
        from: step.from,
        to: step.to,
        fromColumn: step.fromColumn ?? `${step.to}_id`,
        toColumn: step.toColumn ?? 'id',
        alias: step.alias ?? step.to,
        joinType: step.joinType ?? 'inner',
        additionalConditions: step.additionalConditions ?? {}
      }
    })

    // Validate chain continuity
    for (let i = 1; i < compiledSteps.length; i++) {
      const prevStep = compiledSteps[i - 1]!
      const currentStep = compiledSteps[i]!

      // Each step's 'from' should match previous step's 'to'
      if (currentStep.from !== prevStep.to && currentStep.from !== prevStep.alias) {
        throw new RLSSchemaError(
          `Relationship path "${path.name}" has broken chain at step ${i}: ` +
            `expected '${prevStep.to}' but got '${currentStep.from}'`,
          { path: path.name, step: i }
        )
      }
    }

    const lastStep = compiledSteps[compiledSteps.length - 1]!

    return {
      name: path.name,
      steps: compiledSteps,
      sourceTable,
      targetTable: lastStep.to
    }
  }

  /**
   * Compile a ReBAC policy definition
   */
  private compilePolicy(
    policy: ReBAcPolicyDefinition,
    name: string,
    table: string,
    tableRelationships: Map<string, CompiledRelationshipPath>
  ): CompiledReBAcPolicy {
    // Get relationship path
    const relationshipPath =
      tableRelationships.get(policy.relationshipPath) ??
      this.globalRelationships.get(policy.relationshipPath)

    if (!relationshipPath) {
      throw new RLSSchemaError(
        `ReBAC policy "${name}" references unknown relationship path "${policy.relationshipPath}"`,
        { policy: name, table, relationshipPath: policy.relationshipPath }
      )
    }

    // Normalize operations
    const ops = Array.isArray(policy.operation) ? policy.operation : [policy.operation]
    const expandedOps = ops.flatMap(op =>
      op === 'all' ? ['read', 'create', 'update', 'delete'] : [op]
    )

    // Compile end condition
    const getEndConditions =
      typeof policy.endCondition === 'function'
        ? policy.endCondition
        : () => policy.endCondition as Record<string, unknown>

    return {
      name,
      type: policy.policyType ?? 'allow',
      operations: new Set(expandedOps),
      relationshipPath,
      getEndConditions: getEndConditions as (ctx: PolicyEvaluationContext) => Record<string, unknown>,
      priority: policy.priority ?? 0
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a ReBAC registry
 */
export function createReBAcRegistry<DB = unknown>(
  schema?: ReBAcSchema<DB>,
  options?: { logger?: KyseraLogger }
): ReBAcRegistry<DB> {
  return new ReBAcRegistry<DB>(schema, options)
}
