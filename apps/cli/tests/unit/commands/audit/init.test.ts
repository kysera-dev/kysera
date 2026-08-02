import { describe, it, expect } from 'vitest'
import { renderAuditInitMigration } from '../../../../src/commands/audit/init.js'

/**
 * The portable template must match @kysera/audit's own createAuditTable
 * column for column (packages/audit/src/index.ts) - the plugin treats an
 * existing table as its own.
 */
const PLUGIN_COLUMNS = [
  ".addColumn('id', 'integer', col => col.primaryKey().autoIncrement())",
  ".addColumn('table_name', 'text', col => col.notNull())",
  ".addColumn('entity_id', 'text', col => col.notNull())",
  ".addColumn('operation', 'text', col => col.notNull())",
  ".addColumn('old_values', 'text')",
  ".addColumn('new_values', 'text')",
  ".addColumn('changed_by', 'text')",
  ".addColumn('changed_at', 'text', col => col.notNull())",
  ".addColumn('metadata', 'text')"
]

describe('renderAuditInitMigration', () => {
  describe('portable mode (matches the plugin exactly)', () => {
    const content = renderAuditInitMigration('audit_logs', null)

    it('creates the configured table', () => {
      expect(content).toContain(".createTable('audit_logs')")
      expect(content).toContain(".dropTable('audit_logs')")
    })

    it('emits exactly the plugin columns, in plugin order', () => {
      let cursor = -1
      for (const column of PLUGIN_COLUMNS) {
        const index = content.indexOf(column)
        expect(index, `missing or out of order: ${column}`).toBeGreaterThan(cursor)
        cursor = index
      }
      expect(content.match(/\.addColumn\(/g)).toHaveLength(PLUGIN_COLUMNS.length)
    })

    it('adds no indexes and does not import sql', () => {
      expect(content).not.toContain('createIndex')
      expect(content).toContain("import { Kysely } from 'kysely'")
      expect(content).not.toContain('sql')
    })

    it('respects a custom table name', () => {
      const custom = renderAuditInitMigration('audit_trail', null)
      expect(custom).toContain(".createTable('audit_trail')")
      expect(custom).toContain(".dropTable('audit_trail')")
    })
  })

  describe('dialect-tuned mode', () => {
    it('postgres: jsonb + timestamptz + identity + indexes', () => {
      const content = renderAuditInitMigration('audit_logs', 'postgres')
      expect(content).toContain(
        ".addColumn('id', 'bigint', col => col.primaryKey().generatedAlwaysAsIdentity())"
      )
      expect(content.match(/'jsonb'/g)).toHaveLength(3)
      expect(content).toContain(".addColumn('changed_at', 'timestamptz', col => col.notNull())")
      expect(content).toContain(".createIndex('audit_logs_entity_idx')")
      expect(content).toContain(".columns(['table_name', 'entity_id'])")
      expect(content).toContain(".createIndex('audit_logs_changed_at_idx')")
    })

    it('mysql: json + datetime(3) + varchar keys + sql import', () => {
      const content = renderAuditInitMigration('audit_logs', 'mysql')
      expect(content).toContain("import { Kysely, sql } from 'kysely'")
      expect(content.match(/'json'/g)).toHaveLength(3)
      expect(content).toContain(".addColumn('changed_at', sql`datetime(3)`, col => col.notNull())")
      expect(content).toContain(".addColumn('table_name', 'varchar(255)', col => col.notNull())")
      expect(content).toContain(".createIndex('audit_logs_entity_idx')")
    })

    it('sqlite: portable text columns plus indexes', () => {
      const content = renderAuditInitMigration('audit_logs', 'sqlite')
      for (const column of PLUGIN_COLUMNS) {
        expect(content).toContain(column)
      }
      expect(content).toContain(".createIndex('audit_logs_entity_idx')")
      expect(content).toContain(".createIndex('audit_logs_changed_at_idx')")
    })
  })

  it('emits a runnable Kysely migration shape', () => {
    const content = renderAuditInitMigration('audit_logs', 'postgres')
    expect(content).toContain('export async function up(db: Kysely<any>): Promise<void>')
    expect(content).toContain('export async function down(db: Kysely<any>): Promise<void>')
  })
})
