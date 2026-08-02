import type { Kysely } from 'kysely'
import type { Database } from '../../utils/database.js'
import type { KyseraConfigWithDatabase } from '../../utils/with-database.js'
import { MigrationRunner } from './runner.js'

/**
 * Migration settings resolved from configuration. Schema precedence:
 * CLI --schema flag > migrations.schema > database.schema > 'public'
 * (the last two arrive pre-resolved via withDatabase).
 */
export interface MigrateSettings {
  migrationsDir: string
  tableName: string
  schema: string
  lock: boolean
  lockTimeoutMs: number
  dialect: string
}

export function migrateSettings(
  config: KyseraConfigWithDatabase,
  resolvedSchema: string,
  schemaOverride?: string
): MigrateSettings {
  const migrations = config.migrations
  return {
    migrationsDir: migrations?.directory ?? './migrations',
    tableName: migrations?.tableName ?? 'migrations',
    schema: schemaOverride ?? migrations?.schema ?? resolvedSchema,
    lock: migrations?.lockTable !== false,
    lockTimeoutMs: migrations?.lockTimeout ?? 10_000,
    dialect: config.database.dialect
  }
}

export function createRunner(db: Kysely<Database>, settings: MigrateSettings): MigrationRunner {
  return new MigrationRunner(db, settings.migrationsDir, settings.tableName, settings.schema, {
    lock: settings.lock,
    lockTimeoutMs: settings.lockTimeoutMs
  })
}
