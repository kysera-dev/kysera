/**
 * Policy Registry
 * Central registry for managing RLS policies across all tables
 *
 * The PolicyRegistry compiles and stores RLS policies for efficient runtime lookup.
 * It categorizes policies by type (allow/deny/filter/validate) and operation,
 * and provides methods to query policies for specific tables and operations.
 */

import type {
  Operation,
  PolicyDefinition,
  FilterCondition,
  RLSSchema,
  TableRLSConfig,
  CompiledPolicy,
  CompiledFilterPolicy,
} from './types.js';
import { RLSSchemaError } from '../errors.js';
import { silentLogger, type KyseraLogger } from '@kysera/core';

/**
 * Internal compiled policy with operations as Set for efficient lookup
 */
interface InternalCompiledPolicy {
  name: string;
  operations: Set<Operation>;
  type: 'allow' | 'deny' | 'validate';
  evaluate: (ctx: any) => boolean | Promise<boolean>;
  priority: number;
}

/**
 * Table policy configuration
 */
interface TablePolicyConfig {
  allows: InternalCompiledPolicy[];
  denies: InternalCompiledPolicy[];
  filters: CompiledFilterPolicy[];
  validates: InternalCompiledPolicy[];
  skipFor: string[]; // Role names that bypass RLS
  defaultDeny: boolean;
}

/**
 * Policy Registry
 * Manages and provides access to RLS policies
 */
export class PolicyRegistry<DB = unknown> {
  private tables = new Map<string, TablePolicyConfig>();
  private compiled = false;
  private logger: KyseraLogger;

  constructor(schema?: RLSSchema<DB>, options?: { logger?: KyseraLogger }) {
    this.logger = options?.logger ?? silentLogger;
    if (schema) {
      this.loadSchema(schema);
    }
  }

  /**
   * Load and compile policies from schema
   *
   * @example
   * ```typescript
   * const registry = new PolicyRegistry<Database>();
   * registry.loadSchema({
   *   users: {
   *     policies: [
   *       allow('read', ctx => ctx.auth.userId === ctx.row.id),
   *       filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
   *     ],
   *     defaultDeny: true,
   *   },
   * });
   * ```
   */
  loadSchema(schema: RLSSchema<DB>): void {
    for (const [table, config] of Object.entries(schema)) {
      if (!config) continue;
      this.registerTable(table, config as TableRLSConfig);
    }
    this.compiled = true;
  }

  /**
   * Register policies for a single table
   *
   * @param table - Table name
   * @param config - Table RLS configuration
   */
  registerTable(table: string, config: TableRLSConfig): void {
    const tableConfig: TablePolicyConfig = {
      allows: [],
      denies: [],
      filters: [],
      validates: [],
      skipFor: config.skipFor ?? [],
      defaultDeny: config.defaultDeny ?? true,
    };

    // Compile and categorize policies
    for (let i = 0; i < config.policies.length; i++) {
      const policy = config.policies[i];
      if (!policy) continue;

      const policyName = policy.name ?? `${table}_policy_${i}`;

      try {
        if (policy.type === 'filter') {
          const compiled = this.compileFilterPolicy(policy, policyName);
          tableConfig.filters.push(compiled);
        } else {
          const compiled = this.compilePolicy(policy, policyName);

          switch (policy.type) {
            case 'allow':
              tableConfig.allows.push(compiled);
              break;
            case 'deny':
              tableConfig.denies.push(compiled);
              break;
            case 'validate':
              tableConfig.validates.push(compiled);
              break;
          }
        }
      } catch (error) {
        throw new RLSSchemaError(
          `Failed to compile policy "${policyName}" for table "${table}": ${error instanceof Error ? error.message : String(error)}`,
          { table, policy: policyName }
        );
      }
    }

    // Sort by priority (higher priority first)
    tableConfig.allows.sort((a, b) => b.priority - a.priority);
    tableConfig.denies.sort((a, b) => b.priority - a.priority);
    tableConfig.validates.sort((a, b) => b.priority - a.priority);

    this.tables.set(table, tableConfig);
  }

  /**
   * Register policies - supports both schema and table-based registration
   *
   * @overload Register a full schema
   * @overload Register policies for a single table (deprecated)
   */
  register(schemaOrTable: RLSSchema<DB>): void;
  register(
    schemaOrTable: keyof DB & string,
    policies: PolicyDefinition[],
    options?: {
      skipFor?: string[];
      defaultDeny?: boolean;
    }
  ): void;
  register(
    schemaOrTable: RLSSchema<DB> | (keyof DB & string),
    policies?: PolicyDefinition[],
    options?: {
      skipFor?: string[]; // Role names that bypass RLS
      defaultDeny?: boolean;
    }
  ): void {
    // If first argument is an object with policies, treat as schema
    if (typeof schemaOrTable === 'object' && schemaOrTable !== null) {
      this.loadSchema(schemaOrTable);
      return;
    }

    // Otherwise, treat as table-based registration
    const table = schemaOrTable as keyof DB & string;
    if (!policies) {
      throw new RLSSchemaError('Policies are required when registering by table name', { table });
    }

    const config: TableRLSConfig = {
      policies,
    };

    if (options?.skipFor !== undefined) {
      config.skipFor = options.skipFor;
    }

    if (options?.defaultDeny !== undefined) {
      config.defaultDeny = options.defaultDeny;
    }

    this.registerTable(table, config);
  }

  /**
   * Compile a policy definition into an internal compiled policy
   *
   * @param policy - Policy definition to compile
   * @param name - Policy name for debugging
   * @returns Compiled policy ready for evaluation
   */
  private compilePolicy(policy: PolicyDefinition, name: string): InternalCompiledPolicy {
    const operations = Array.isArray(policy.operation)
      ? policy.operation
      : [policy.operation];

    // Expand 'all' to all operations
    const expandedOps = operations.flatMap(op =>
      op === 'all' ? (['read', 'create', 'update', 'delete'] as const) : [op]
    ) as Operation[];

    return {
      name,
      operations: new Set(expandedOps),
      type: policy.type as 'allow' | 'deny' | 'validate',
      evaluate: policy.condition as (ctx: any) => boolean | Promise<boolean>,
      priority: policy.priority ?? (policy.type === 'deny' ? 100 : 0),
    };
  }

  /**
   * Compile a filter policy
   *
   * @param policy - Filter policy definition
   * @param name - Policy name for debugging
   * @returns Compiled filter policy
   */
  private compileFilterPolicy(policy: PolicyDefinition, name: string): CompiledFilterPolicy {
    const condition = policy.condition as unknown as FilterCondition;

    return {
      operation: 'read',
      getConditions: condition as (ctx: any) => Record<string, unknown>,
      name,
    };
  }

  /**
   * Convert internal compiled policy to public CompiledPolicy
   */
  private toCompiledPolicy(internal: InternalCompiledPolicy): CompiledPolicy {
    return {
      name: internal.name,
      type: internal.type,
      operation: Array.from(internal.operations),
      evaluate: internal.evaluate,
      priority: internal.priority,
    };
  }

  /**
   * Get allow policies for a table and operation
   */
  getAllows(table: string, operation: Operation): CompiledPolicy[] {
    const config = this.tables.get(table);
    if (!config) return [];

    return config.allows
      .filter(p => p.operations.has(operation))
      .map(p => this.toCompiledPolicy(p));
  }

  /**
   * Get deny policies for a table and operation
   */
  getDenies(table: string, operation: Operation): CompiledPolicy[] {
    const config = this.tables.get(table);
    if (!config) return [];

    return config.denies
      .filter(p => p.operations.has(operation))
      .map(p => this.toCompiledPolicy(p));
  }

  /**
   * Get validate policies for a table and operation
   */
  getValidates(table: string, operation: Operation): CompiledPolicy[] {
    const config = this.tables.get(table);
    if (!config) return [];

    return config.validates
      .filter(p => p.operations.has(operation))
      .map(p => this.toCompiledPolicy(p));
  }

  /**
   * Get filter policies for a table
   */
  getFilters(table: string): CompiledFilterPolicy[] {
    const config = this.tables.get(table);
    return config?.filters ?? [];
  }

  /**
   * Get roles that skip RLS for a table
   */
  getSkipFor(table: string): string[] {
    const config = this.tables.get(table);
    return config?.skipFor ?? [];
  }

  /**
   * Check if table has default deny
   */
  hasDefaultDeny(table: string): boolean {
    const config = this.tables.get(table);
    return config?.defaultDeny ?? true;
  }

  /**
   * Check if a table is registered
   */
  hasTable(table: string): boolean {
    return this.tables.has(table);
  }

  /**
   * Get all registered table names
   */
  getTables(): string[] {
    return Array.from(this.tables.keys());
  }

  /**
   * Check if registry is compiled
   */
  isCompiled(): boolean {
    return this.compiled;
  }

  /**
   * Validate that all policies are properly defined
   *
   * This method checks for common issues:
   * - Tables with no policies and defaultDeny=false (warns)
   * - Tables with skipFor operations but no corresponding policies
   */
  validate(): void {
    for (const [table, config] of this.tables) {
      // Check that at least one operation has policies
      const hasPolicy =
        config.allows.length > 0 ||
        config.denies.length > 0 ||
        config.filters.length > 0 ||
        config.validates.length > 0;

      if (!hasPolicy && !config.defaultDeny) {
        // Warning: table has no policies and defaultDeny is false
        this.logger.warn?.(
          `[RLS] Table "${table}" has no policies and defaultDeny is false. ` +
            `All operations will be allowed.`
        );
      }

      // Warn if skipFor includes operations that have policies
      if (config.skipFor.length > 0) {
        const opsWithPolicies = new Set<Operation>();

        for (const allow of config.allows) {
          allow.operations.forEach(op => opsWithPolicies.add(op));
        }
        for (const deny of config.denies) {
          deny.operations.forEach(op => opsWithPolicies.add(op));
        }
        for (const validate of config.validates) {
          validate.operations.forEach(op => opsWithPolicies.add(op));
        }
        if (config.filters.length > 0) {
          opsWithPolicies.add('read');
        }

        const skippedOpsWithPolicies = config.skipFor.filter(op => {
          // 'all' means skip all operations
          if (op === 'all') return opsWithPolicies.size > 0;
          // Check if this is an operation name (for backwards compatibility)
          return opsWithPolicies.has(op as Operation);
        });

        if (skippedOpsWithPolicies.length > 0) {
          this.logger.warn?.(
            `[RLS] Table "${table}" has skipFor operations that also have policies: ${skippedOpsWithPolicies.join(', ')}. ` +
              `The policies will be ignored for these operations.`
          );
        }
      }
    }
  }

  /**
   * Clear all policies
   */
  clear(): void {
    this.tables.clear();
    this.compiled = false;
  }

  /**
   * Remove policies for a specific table
   */
  remove(table: string): void {
    this.tables.delete(table);
  }
}
