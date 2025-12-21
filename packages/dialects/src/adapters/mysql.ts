/**
 * MySQL Dialect Adapter
 */

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DialectAdapter, DatabaseErrorLike } from '../types.js';

export class MySQLAdapter implements DialectAdapter {
  readonly dialect = 'mysql' as const;

  getDefaultPort(): number {
    return 3306;
  }

  getCurrentTimestamp(): string {
    return 'CURRENT_TIMESTAMP';
  }

  escapeIdentifier(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  formatDate(date: Date): string {
    // MySQL datetime format: YYYY-MM-DD HH:MM:SS
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }

  isUniqueConstraintError(error: unknown): boolean {
    const e = error as DatabaseErrorLike;
    const message = e.message?.toLowerCase() || '';
    const code = e.code || '';
    return code === 'ER_DUP_ENTRY' || code === '1062' || message.includes('duplicate entry');
  }

  isForeignKeyError(error: unknown): boolean {
    const e = error as DatabaseErrorLike;
    const code = e.code || '';
    return (
      code === 'ER_ROW_IS_REFERENCED' ||
      code === '1451' ||
      code === 'ER_NO_REFERENCED_ROW' ||
      code === '1452'
    );
  }

  isNotNullError(error: unknown): boolean {
    const e = error as DatabaseErrorLike;
    const code = e.code || '';
    return code === 'ER_BAD_NULL_ERROR' || code === '1048';
  }

  async tableExists(db: Kysely<any>, tableName: string): Promise<boolean> {
    try {
      const result = await db
        .selectFrom('information_schema.tables')
        .select('table_name')
        .where('table_name', '=', tableName)
        .where('table_schema', '=', sql`DATABASE()`)
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
        .where('table_schema', '=', sql`DATABASE()`)
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
        .where('table_schema', '=', sql`DATABASE()`)
        .where('table_type', '=', 'BASE TABLE')
        .execute();
      return results.map((r) => r.table_name as string);
    } catch {
      return [];
    }
  }

  async getDatabaseSize(db: Kysely<any>, databaseName?: string): Promise<number> {
    try {
      const dbName =
        databaseName ||
        (await sql
          .raw('SELECT DATABASE() as name')
          .execute(db)
          .then((r) => (r.rows?.[0] as { name?: string })?.name));

      const result = await sql
        .raw(
          `SELECT SUM(data_length + index_length) as size FROM information_schema.tables WHERE table_schema = '${dbName}'`
        )
        .execute(db)
        .then((r) => r.rows?.[0]);

      return (result as { size?: number })?.size || 0;
    } catch {
      return 0;
    }
  }

  async truncateTable(db: Kysely<any>, tableName: string): Promise<void> {
    try {
      // Temporarily disable foreign key checks
      await sql.raw('SET FOREIGN_KEY_CHECKS = 0').execute(db);
      await sql.raw(`TRUNCATE TABLE ${this.escapeIdentifier(tableName)}`).execute(db);
      await sql.raw('SET FOREIGN_KEY_CHECKS = 1').execute(db);
    } catch {
      // Re-enable foreign key checks even on error
      try {
        await sql.raw('SET FOREIGN_KEY_CHECKS = 1').execute(db);
      } catch {
        // Ignore
      }
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

export const mysqlAdapter = new MySQLAdapter();
