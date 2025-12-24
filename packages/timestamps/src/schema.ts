/**
 * Zod schemas for timestamps plugin configuration.
 * This file is separate from the main index to allow the package to work without Zod installed.
 * Only import this file if you need Zod validation (e.g., for CLI or configuration validation).
 *
 * @packageDocumentation
 */

import { z } from 'zod'

/**
 * Zod schema for TimestampsOptions
 * Used for validation and configuration in the kysera-cli
 *
 * @example
 * ```typescript
 * import { TimestampsOptionsSchema } from '@kysera/timestamps/schema'
 *
 * const result = TimestampsOptionsSchema.safeParse({
 *   createdAtColumn: 'created_at',
 *   updatedAtColumn: 'updated_at',
 *   setUpdatedAtOnInsert: true
 * })
 *
 * if (result.success) {
 *   console.log('Valid options:', result.data)
 * }
 * ```
 */
export const TimestampsOptionsSchema = z.object({
  createdAtColumn: z.string().optional(),
  updatedAtColumn: z.string().optional(),
  setUpdatedAtOnInsert: z.boolean().optional(),
  tables: z.array(z.string()).optional(),
  excludeTables: z.array(z.string()).optional(),
  getTimestamp: z.function().optional(),
  dateFormat: z.enum(['iso', 'unix', 'date']).optional(),
  primaryKeyColumn: z.string().optional()
})

/**
 * Type inferred from TimestampsOptionsSchema
 */
export type TimestampsOptionsSchemaType = z.infer<typeof TimestampsOptionsSchema>
