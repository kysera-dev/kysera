import type { Kysely } from 'kysely';

/**
 * Safely destroy a Kysely database connection
 * Handles cases where destroy method might not exist
 */
export async function safeDbDestroy(db: Kysely<any> | undefined | null): Promise<void> {
  if (!db) return;

  // Check if destroy method exists (it may not in all versions/dialects)
  if (typeof db.destroy === 'function') {
    try {
      await db.destroy();
    } catch (error) {
      // Silently ignore destroy errors in tests
      // The connection will be closed anyway
    }
  }
}

/**
 * Safely close a better-sqlite3 database connection
 */
export function safeSqliteClose(database: any): void {
  if (!database) return;

  try {
    if (typeof database.close === 'function') {
      database.close();
    }
  } catch (error) {
    // Silently ignore close errors in tests
  }
}
