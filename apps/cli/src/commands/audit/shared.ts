import type { Kysely } from 'kysely'
import type { Database } from '../../utils/database.js'
import type { KyseraConfig } from '../../config/schema.js'

/**
 * Row shape of the audit table as written by @kysera/audit (see the
 * plugin's createAuditTable): operation / changed_by / changed_at columns,
 * JSON payloads serialized as text.
 */
export interface AuditLogRow {
  id: number
  table_name: string
  entity_id: string
  operation: string
  old_values: unknown
  new_values: unknown
  changed_by: string | null
  changed_at: string | Date
  metadata: unknown
}

/** Audit table name: config override or the plugin default. */
export function resolveAuditTable(config: KyseraConfig | null | undefined): string {
  return config?.plugins?.audit?.auditTable ?? 'audit_logs'
}

/**
 * Dialect-independent audit table existence check. information_schema does
 * not exist on SQLite; Kysely introspection works on every dialect.
 */
export async function auditTableExists(
  db: Kysely<Database>,
  auditTable: string,
  schema?: string
): Promise<boolean> {
  try {
    const tables = await db.introspection.getTables({ withInternalKyselyTables: false })
    return tables.some(
      t => t.name === auditTable && (schema === undefined || (t.schema ?? schema) === schema)
    )
  } catch {
    return false
  }
}

/** Guidance shown when the audit table is missing. */
export function auditTableMissingHint(auditTable: string): string[] {
  return [
    `The '${auditTable}' table does not exist in this database.`,
    `Run 'kysera audit init' to generate the table migration, then 'kysera migrate up'.`,
    `(@kysera/audit also auto-creates the table on its first write.)`
  ]
}

/** Parse a TEXT JSON payload column; objects pass through unchanged. */
export function parseJsonColumn(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return (JSON.parse(value) ?? {}) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return (value ?? {}) as Record<string, unknown>
}
