/**
 * Zod schemas for soft-delete plugin configuration.
 * This file is separate from the main index to allow the package to work without Zod installed.
 * Only import this file if you need Zod validation (e.g., for CLI or configuration validation).
 *
 * @packageDocumentation
 */

import { z } from 'zod'

/**
 * Zod schema for SoftDeleteOptions
 * Used for validation and configuration in the kysera-cli
 *
 * @example
 * ```typescript
 * import { SoftDeleteOptionsSchema } from '@kysera/soft-delete/schema'
 *
 * const result = SoftDeleteOptionsSchema.safeParse({
 *   deletedAtColumn: 'deleted_at',
 *   includeDeleted: false,
 *   tables: ['users', 'posts']
 * })
 *
 * if (result.success) {
 *   console.log('Valid options:', result.data)
 * }
 * ```
 */
export const SoftDeleteOptionsSchema = z.object({
  deletedAtColumn: z.string().optional(),
  includeDeleted: z.boolean().optional(),
  tables: z.array(z.string()).optional(),
  excludeTables: z.array(z.string()).optional(),
  primaryKeyColumn: z.string().optional(),
  // Note: logger is not validated as it's a function interface
  // CLI tools should handle logger separately
})

/**
 * Type inferred from SoftDeleteOptionsSchema
 */
export type SoftDeleteOptionsSchemaType = z.infer<typeof SoftDeleteOptionsSchema>
