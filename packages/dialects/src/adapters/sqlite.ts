/**
 * SQLite Dialect Adapter
 */

import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { DialectAdapter, DatabaseErrorLike } from '../types.js'
import { assertValidIdentifier } from '../helpers.js'

export class SQLiteAdapter implements DialectAdapter {
  readonly dialect = 'sqlite' as const

  getDefaultPort(): null {
    // SQLite is file-based, no port
    return null
  }

  getCurrentTimestamp(): string {
    return "datetime('now')"
  }

  escapeIdentifier(identifier: string): string {
    return '"' + identifier.replace(/"/g, '""') + '"'
  }

  formatDate(date: Date): string {
    return date.toISOString()
  }

  isUniqueConstraintError(error: unknown): boolean {
    const e = error as DatabaseErrorLike
    const message = e.message?.toLowerCase() || ''
    return message.includes('unique constraint failed')
  }

  isForeignKeyError(error: unknown): boolean {
    const e = error as DatabaseErrorLike
    const message = e.message?.toLowerCase() || ''
    return message.includes('foreign key constraint failed')
  }

  isNotNullError(error: unknown): boolean {
    const e = error as DatabaseErrorLike
    const message = e.message?.toLowerCase() || ''
    return message.includes('not null constraint failed')
  }

  async tableExists(db: Kysely<any>, tableName: string): Promise<boolean> {
    assertValidIdentifier(tableName, 'table name')
    try {
      const result = await db
        .selectFrom('sqlite_master')
        .select('name')
        .where('type', '=', 'table')
        .where('name', '=', tableName)
        .executeTakeFirst()
      return !!result
    } catch {
      return false
    }
  }

  async getTableColumns(db: Kysely<any>, tableName: string): Promise<string[]> {
    assertValidIdentifier(tableName, 'table name')
    try {
      const results = await sql
        .raw(`PRAGMA table_info(${this.escapeIdentifier(tableName)})`)
        .execute(db)
      return (results.rows as { name: string }[]).map(r => r.name)
    } catch {
      return []
    }
  }

  async getTables(db: Kysely<any>): Promise<string[]> {
    try {
      const results = await db
        .selectFrom('sqlite_master')
        .select('name')
        .where('type', '=', 'table')
        .where('name', 'not like', 'sqlite_%')
        .execute()
      return results.map(r => r.name as string)
    } catch {
      return []
    }
  }

  async getDatabaseSize(_db: Kysely<any>, _databaseName?: string): Promise<number> {
    // SQLite database size requires file system access
    // which is not available in a cross-runtime way
    return 0
  }

  async truncateTable(db: Kysely<any>, tableName: string): Promise<boolean> {
    assertValidIdentifier(tableName, 'table name')
    try {
      // SQLite doesn't support TRUNCATE, use DELETE instead
      await sql.raw(`DELETE FROM ${this.escapeIdentifier(tableName)}`).execute(db)
      return true
    } catch (error) {
      const errorMessage = String(error)
      if (errorMessage.includes('no such table')) {
        return false
      }
      // Log and rethrow unexpected errors
      console.error(`[Kysera Dialects] Failed to truncate table "${tableName}":`, error)
      throw error
    }
  }

  async truncateAllTables(db: Kysely<any>, exclude: string[] = []): Promise<void> {
    const tables = await this.getTables(db)
    for (const table of tables) {
      if (!exclude.includes(table)) {
        await this.truncateTable(db, table)
      }
    }
  }
}

export const sqliteAdapter = new SQLiteAdapter()
