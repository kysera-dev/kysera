/**
 * SQLite Dialect Adapter
 */

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DialectAdapter, DatabaseErrorLike } from '../types.js';

export class SQLiteAdapter implements DialectAdapter {
  readonly dialect = 'sqlite' as const;

  getDefaultPort(): null {
    // SQLite is file-based, no port
    return null;
  }

  getCurrentTimestamp(): string {
    return "datetime('now')";
  }

  escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  formatDate(date: Date): string {
    return date.toISOString();
  }

  isUniqueConstraintError(error: unknown): boolean {
    const e = error as DatabaseErrorLike;
    const message = e.message?.toLowerCase() || '';
    return message.includes('unique constraint failed');
  }

  isForeignKeyError(error: unknown): boolean {
    const e = error as DatabaseErrorLike;
    const message = e.message?.toLowerCase() || '';
    return message.includes('foreign key constraint failed');
  }

  isNotNullError(error: unknown): boolean {
    const e = error as DatabaseErrorLike;
    const message = e.message?.toLowerCase() || '';
    return message.includes('not null constraint failed');
  }

  async tableExists(db: Kysely<any>, tableName: string): Promise<boolean> {
    try {
      const result = await db
        .selectFrom('sqlite_master')
        .select('name')
        .where('type', '=', 'table')
        .where('name', '=', tableName)
        .executeTakeFirst();
      return !!result;
    } catch {
      return false;
    }
  }

  async getTableColumns(db: Kysely<any>, tableName: string): Promise<string[]> {
    try {
      const results = await sql.raw(`PRAGMA table_info(${tableName})`).execute(db);
      return (results.rows as Array<{ name: string }>).map((r) => r.name);
    } catch {
      return [];
    }
  }

  async getTables(db: Kysely<any>): Promise<string[]> {
    try {
      const results = await db
        .selectFrom('sqlite_master')
        .select('name')
        .where('type', '=', 'table')
        .where('name', 'not like', 'sqlite_%')
        .execute();
      return results.map((r) => r.name as string);
    } catch {
      return [];
    }
  }

  async getDatabaseSize(_db: Kysely<any>, _databaseName?: string): Promise<number> {
    // SQLite database size requires file system access
    // which is not available in a cross-runtime way
    return 0;
  }

  async truncateTable(db: Kysely<any>, tableName: string): Promise<void> {
    try {
      // SQLite doesn't support TRUNCATE, use DELETE instead
      await db.deleteFrom(tableName as any).execute();
    } catch {
      // Ignore errors for tables that might not exist
    }
  }

  async truncateAllTables(db: Kysely<any>, exclude: string[] = []): Promise<void> {
    const tables = await this.getTables(db);
    for (const table of tables) {
      if (!exclude.includes(table)) {
        await this.truncateTable(db, table);
      }
    }
  }
}

export const sqliteAdapter = new SQLiteAdapter();
