/**
 * Schema Plugin - Unified schema management for Kysera
 *
 * This plugin provides centralized schema configuration and validation
 * for multi-tenant and modular database architectures.
 *
 * @example
 * // Basic usage with default schema
 * const executor = await createExecutor(db, [
 *   schemaPlugin({ defaultSchema: 'auth' })
 * ])
 *
 * @example
 * // Multi-tenant with dynamic schema resolution
 * const executor = await createExecutor(db, [
 *   schemaPlugin({
 *     resolveSchema: (ctx) => ctx.metadata.tenantSchema as string,
 *     allowedSchemas: ['tenant_a', 'tenant_b', 'tenant_c']
 *   })
 * ])
 */

import type { Plugin, QueryBuilderContext } from '../types.js'

/**
 * Configuration options for the Schema Plugin
 */
export interface SchemaPluginOptions {
  /**
   * Default schema for all queries.
   * Used when no schema is resolved dynamically.
   * @default 'public'
   */
  defaultSchema?: string

  /**
   * Dynamic schema resolver function.
   * Called for each query to determine the schema.
   * If returns undefined, defaultSchema is used.
   *
   * @param context - Query builder context with operation, table, and metadata
   * @returns Schema name or undefined to use default
   *
   * @example
   * // Resolve schema from metadata
   * resolveSchema: (ctx) => ctx.metadata.tenantSchema as string
   *
   * @example
   * // Schema based on table name
   * resolveSchema: (ctx) => {
   *   if (ctx.table.startsWith('auth_')) return 'auth'
   *   if (ctx.table.startsWith('admin_')) return 'admin'
   *   return undefined // use default
   * }
   */
  resolveSchema?: (context: QueryBuilderContext) => string | undefined

  /**
   * Async schema validator.
   * Called during plugin initialization to validate the default schema.
   *
   * @param schema - Schema name to validate
   * @returns true if valid, false otherwise
   *
   * @example
   * validateSchema: async (schema) => {
   *   return await adapter.schemaExists(db, schema)
   * }
   */
  validateSchema?: (schema: string) => boolean | Promise<boolean>

  /**
   * Whitelist of allowed schemas.
   * If set, only these schemas can be used.
   * Queries with other schemas will throw an error.
   *
   * @example
   * allowedSchemas: ['public', 'auth', 'admin']
   */
  allowedSchemas?: string[]

  /**
   * Whether to throw an error when schema validation fails.
   * If false, falls back to defaultSchema.
   * @default true
   */
  strictValidation?: boolean
}

/**
 * Error thrown when schema validation fails
 */
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly schema: string,
    public readonly allowedSchemas?: string[]
  ) {
    super(message)
    this.name = 'SchemaValidationError'
  }
}

/**
 * Create a Schema Plugin for unified schema management.
 *
 * The plugin provides:
 * - Default schema configuration
 * - Dynamic schema resolution per query
 * - Schema whitelist validation
 * - Schema metadata in QueryBuilderContext
 *
 * @param options - Plugin configuration options
 * @returns Plugin instance
 *
 * @example
 * // Simple default schema
 * const executor = await createExecutor(db, [
 *   schemaPlugin({ defaultSchema: 'app' })
 * ])
 *
 * @example
 * // Multi-tenant application
 * const executor = await createExecutor(db, [
 *   schemaPlugin({
 *     defaultSchema: 'public',
 *     resolveSchema: (ctx) => {
 *       const tenantId = ctx.metadata.tenantId as string
 *       return tenantId ? `tenant_${tenantId}` : undefined
 *     },
 *     allowedSchemas: ['public', 'tenant_a', 'tenant_b']
 *   })
 * ])
 */
export function schemaPlugin(options: SchemaPluginOptions = {}): Plugin {
  const {
    defaultSchema = 'public',
    resolveSchema,
    validateSchema,
    allowedSchemas,
    strictValidation = true
  } = options

  // Pre-compute allowed schemas set for O(1) lookup
  const allowedSet = allowedSchemas ? new Set(allowedSchemas) : null

  return {
    name: '@kysera/schema',
    version: '1.0.0',
    priority: 1000, // Run early to set schema context for other plugins

    async onInit(_db) {
      // Validate default schema during initialization
      if (validateSchema) {
        const isValid = await validateSchema(defaultSchema)
        if (!isValid) {
          throw new SchemaValidationError(
            `Invalid default schema: ${defaultSchema}`,
            defaultSchema
          )
        }
      }

      // Validate allowed schemas if whitelist is provided
      if (allowedSet && !allowedSet.has(defaultSchema)) {
        const allowedList = allowedSchemas ? allowedSchemas.join(', ') : ''
        throw new SchemaValidationError(
          `Default schema "${defaultSchema}" is not in allowed list: [${allowedList}]`,
          defaultSchema,
          allowedSchemas
        )
      }
    },

    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      // Resolve schema for this query
      let schema = resolveSchema?.(context) ?? context.schema ?? defaultSchema

      // Validate against whitelist
      if (allowedSet && !allowedSet.has(schema)) {
        if (strictValidation) {
          const allowedList = allowedSchemas ? allowedSchemas.join(', ') : ''
          throw new SchemaValidationError(
            `Schema "${schema}" is not in allowed list: [${allowedList}]`,
            schema,
            allowedSchemas
          )
        }
        // Fall back to default if not strict
        schema = defaultSchema
      }

      // Store resolved schema in metadata for other plugins
      context.metadata['__resolvedSchema'] = schema

      return qb
    }
  }
}

/**
 * Get the resolved schema from query context metadata.
 * Useful for plugins that need to access the schema set by schemaPlugin.
 *
 * @param context - Query builder context
 * @returns Resolved schema or undefined
 *
 * @example
 * // In another plugin's interceptQuery
 * interceptQuery(qb, context) {
 *   const schema = getResolvedSchema(context)
 *   if (schema === 'admin') {
 *     // Apply admin-specific logic
 *   }
 *   return qb
 * }
 */
export function getResolvedSchema(context: QueryBuilderContext): string | undefined {
  return context.metadata['__resolvedSchema'] as string | undefined
}
