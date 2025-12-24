/**
 * Zod schemas for audit plugin configuration.
 * This file is separate from the main index to allow the package to work without Zod installed.
 * Only import this file if you need Zod validation (e.g., for CLI or configuration validation).
 *
 * @packageDocumentation
 */

import { z } from 'zod'

/**
 * Zod schema for AuditOptions
 * Used for validation and configuration in the kysera-cli
 *
 * @example
 * ```typescript
 * import { AuditOptionsSchema } from '@kysera/audit/schema'
 *
 * const result = AuditOptionsSchema.safeParse({
 *   auditTable: 'audit_logs',
 *   captureOldValues: true,
 *   captureNewValues: true
 * })
 *
 * if (result.success) {
 *   console.log('Valid options:', result.data)
 * }
 * ```
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
  metadata: z.function().optional()
})

/**
 * Type inferred from AuditOptionsSchema
 */
export type AuditOptionsSchemaType = z.infer<typeof AuditOptionsSchema>
