/**
 * Microsoft SQL Server Dialect Adapter
 *
 * Supports SQL Server 2017+, Azure SQL Database, and Azure SQL Edge
 */

import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { DialectAdapter, DatabaseErrorLike } from '../types.js'
import { assertValidIdentifier } from '../helpers.js'

export class MSSQLAdapter implements DialectAdapter {
  readonly dialect = 'mssql' as const

  getDefaultPort(): number {
    return 1433
  }

  getCurrentTimestamp(): string {
    return 'GETDATE()'
  }

  escapeIdentifier(identifier: string): string {
    // MSSQL uses square brackets for escaping
    return '[' + identifier.replace(/\]/g, ']]') + ']'
  }

  formatDate(date: Date): string {
    // MSSQL datetime format: YYYY-MM-DD HH:MM:SS.mmm
    return date.toISOString().replace('T', ' ').replace('Z', '')
  }

  isUniqueConstraintError(error: unknown): boolean {
    const e = error as DatabaseErrorLike
    const message = e.message?.toLowerCase() || ''
    const code = e.code || ''
    // MSSQL error 2627: Violation of PRIMARY KEY/UNIQUE constraint
    // MSSQL error 2601: Cannot insert duplicate key row
    return (
      code === '2627' ||
      code === '2601' ||
      message.includes('violation of unique key constraint') ||
      message.includes('cannot insert duplicate key') ||
      message.includes('unique constraint')
    )
  }

  isForeignKeyError(error: unknown): boolean {
    const e = error as DatabaseErrorLike
    const message = e.message?.toLowerCase() || ''
    const code = e.code || ''
    // MSSQL error 547: FOREIGN KEY constraint violation
    return (
      code === '547' ||
      message.includes('foreign key constraint') ||
      message.includes('conflicted with the foreign key')
    )
  }

  isNotNullError(error: unknown): boolean {
    const e = error as DatabaseErrorLike
    const message = e.message?.toLowerCase() || ''
    const code = e.code || ''
    // MSSQL error 515: Cannot insert NULL value
    return (
      code === '515' ||
      message.includes('cannot insert the value null') ||
      message.includes('does not allow nulls')
    )
  }

  async tableExists(db: Kysely<any>, tableName: string): Promise<boolean> {
    assertValidIdentifier(tableName, 'table name')
    try {
      const result = await db
        .selectFrom('INFORMATION_SCHEMA.TABLES')
        .select('TABLE_NAME')
        .where('TABLE_NAME', '=', tableName)
        .where('TABLE_TYPE', '=', 'BASE TABLE')
        .executeTakeFirst()
      return !!result
    } catch {
      return false
    }
  }

  async getTableColumns(db: Kysely<any>, tableName: string): Promise<string[]> {
    assertValidIdentifier(tableName, 'table name')
    try {
      const results = await db
        .selectFrom('INFORMATION_SCHEMA.COLUMNS')
        .select('COLUMN_NAME')
        .where('TABLE_NAME', '=', tableName)
        .execute()
      return results.map(r => (r as { COLUMN_NAME: string }).COLUMN_NAME)
    } catch {
      return []
    }
  }

  async getTables(db: Kysely<any>): Promise<string[]> {
    try {
      const results = await db
        .selectFrom('INFORMATION_SCHEMA.TABLES')
        .select('TABLE_NAME')
        .where('TABLE_TYPE', '=', 'BASE TABLE')
        .where('TABLE_SCHEMA', '=', 'dbo')
        .execute()
      return results.map(r => (r as { TABLE_NAME: string }).TABLE_NAME)
    } catch {
      return []
    }
  }

  async getDatabaseSize(db: Kysely<any>, _databaseName?: string): Promise<number> {
    try {
      // MSSQL: Get database size using sys.database_files
      // Note: _databaseName is ignored as MSSQL uses the current database context
      const result = await sql<{ size: number }>`
        SELECT SUM(size * 8 * 1024) as size
        FROM sys.database_files
        WHERE type = 0
      `.execute(db)
      return (result.rows?.[0] as { size?: number })?.size || 0
    } catch {
      return 0
    }
  }

  async truncateTable(db: Kysely<any>, tableName: string): Promise<boolean> {
    assertValidIdentifier(tableName, 'table name')
    try {
      // MSSQL: First try TRUNCATE, fall back to DELETE if FK constraints exist
      try {
        await sql.raw(`TRUNCATE TABLE ${this.escapeIdentifier(tableName)}`).execute(db)
      } catch (truncateError) {
        // If truncate fails due to FK, use DELETE
        const errorMsg = String(truncateError)
        if (errorMsg.includes('FOREIGN KEY') || errorMsg.includes('Cannot truncate')) {
          await sql.raw(`DELETE FROM ${this.escapeIdentifier(tableName)}`).execute(db)
          // Reset identity if table has one
          try {
            await sql
              .raw(`DBCC CHECKIDENT ('${tableName}', RESEED, 0)`)
              .execute(db)
          } catch {
            // Ignore if table doesn't have identity column
          }
        } else {
          throw truncateError
        }
      }
      return true
    } catch (error) {
      const errorMessage = String(error)
      if (
        errorMessage.includes('Invalid object name') ||
        errorMessage.includes('does not exist')
      ) {
        return false
      }
      console.error(`[Kysera Dialects] Failed to truncate table "${tableName}":`, error)
      throw error
    }
  }

  async truncateAllTables(db: Kysely<any>, exclude: string[] = []): Promise<void> {
    const tables = await this.getTables(db)

    // MSSQL: Disable all FK constraints first
    for (const table of tables) {
      if (!exclude.includes(table)) {
        try {
          await sql
            .raw(`ALTER TABLE ${this.escapeIdentifier(table)} NOCHECK CONSTRAINT ALL`)
            .execute(db)
        } catch {
          // Ignore errors for tables without constraints
        }
      }
    }

    // Truncate all tables
    for (const table of tables) {
      if (!exclude.includes(table)) {
        await this.truncateTable(db, table)
      }
    }

    // Re-enable all FK constraints
    for (const table of tables) {
      if (!exclude.includes(table)) {
        try {
          await sql
            .raw(`ALTER TABLE ${this.escapeIdentifier(table)} CHECK CONSTRAINT ALL`)
            .execute(db)
        } catch {
          // Ignore errors
        }
      }
    }
  }
}

export const mssqlAdapter = new MSSQLAdapter()
