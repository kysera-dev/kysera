/**
 * PostgreSQL Dialect Adapter
 */

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DialectAdapter, DatabaseErrorLike } from '../types.js';

export class PostgresAdapter implements DialectAdapter {
  readonly dialect = 'postgres' as const;

  getDefaultPort(): number {
    return 5432;
  }

  getCurrentTimestamp(): string {
    return 'CURRENT_TIMESTAMP';
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
    const code = e.code || '';
    return code === '23505' || message.includes('unique constraint');
  }

  isForeignKeyError(error: unknown): boolean {
    const e = error as DatabaseErrorLike;
    const message = e.message?.toLowerCase() || '';
    const code = e.code || '';
    return code === '23503' || message.includes('foreign key constraint');
  }

  isNotNullError(error: unknown): boolean {
    const e = error as DatabaseErrorLike;
    const message = e.message?.toLowerCase() || '';
    const code = e.code || '';
    return code === '23502' || message.includes('not-null constraint');
  }

  async tableExists(db: Kysely<any>, tableName: string): Promise<boolean> {
    try {
      const result = await db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_name', '=', tableName)
        .where('table_schema', '=', 'public')
        .executeTakeFirst();
      return !!result;
    } catch {
      return false;
    }
  }

  async getTableColumns(db: Kysely<any>, tableName: string): Promise<string[]> {
    try {
      const results = await db
        .selectFrom('information_schema.columns')
        .select('column_name')
        .where('table_name', '=', tableName)
        .where('table_schema', '=', 'public')
        .execute();
      return results.map((r) => r.column_name as string);
    } catch {
      return [];
    }
  }

  async getTables(db: Kysely<any>): Promise<string[]> {
    try {
      const results = await db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_schema', '=', 'public')
        .where('table_type', '=', 'BASE TABLE')
        .execute();
      return results.map((r) => r.table_name as string);
    } catch {
      return [];
    }
  }

  async getDatabaseSize(db: Kysely<any>, databaseName?: string): Promise<number> {
    try {
      const result = await sql
        .raw(`SELECT pg_database_size(${databaseName ? `'${databaseName}'` : 'current_database()'}) as size`)
        .execute(db)
        .then((r) => r.rows?.[0]);
      return (result as { size?: number })?.size || 0;
    } catch {
      return 0;
    }
  }

  async truncateTable(db: Kysely<any>, tableName: string): Promise<void> {
    try {
      await sql.raw(`TRUNCATE TABLE ${this.escapeIdentifier(tableName)} RESTART IDENTITY CASCADE`).execute(db);
    } catch {
      // Ignore errors for tables that might not exist or have constraints
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

export const postgresAdapter = new PostgresAdapter();
