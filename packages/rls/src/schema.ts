/**
 * Zod schemas for RLS plugin configuration.
 * This file is separate from the main index so the package works without Zod
 * installed (zod is an optional peer). Only import this entry if you need
 * config validation (e.g., in kysera-cli).
 *
 * @packageDocumentation
 */

import { z } from 'zod'

/**
 * Zod schema for RLSPluginOptions
 * Used for validation and configuration in the kysera-cli.
 * Note: 'schema', 'logger' and 'onViolation' are not included as they are
 * complex runtime objects.
 *
 * @example
 * ```typescript
 * import { RLSPluginOptionsSchema } from '@kysera/rls/schema'
 *
 * const result = RLSPluginOptionsSchema.safeParse({
 *   bypassRoles: ['admin'],
 *   requireContext: true
 * })
 * ```
 */
export const RLSPluginOptionsSchema = z.object({
  tables: z.array(z.string()).optional(),
  excludeTables: z.array(z.string()).optional(),
  bypassRoles: z.array(z.string()).optional(),
  requireContext: z.boolean().optional(),
  allowUnfilteredQueries: z.boolean().optional(),
  auditDecisions: z.boolean().optional(),
  primaryKeyColumn: z.string().optional(),
  activation: z
    .object({
      environment: z.string().optional(),
      // Set must precede record: a Set has no enumerable own keys, so a
      // record schema would silently accept it as {}
      features: z
        .union([z.instanceof(Set), z.array(z.string()), z.record(z.string(), z.unknown())])
        .optional(),
      meta: z.record(z.string(), z.unknown()).optional()
    })
    .optional()
})

export type RLSPluginOptionsInput = z.input<typeof RLSPluginOptionsSchema>
export type RLSPluginOptionsOutput = z.output<typeof RLSPluginOptionsSchema>
