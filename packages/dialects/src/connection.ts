/**
 * Connection URL utilities
 */

import type { DatabaseDialect, ConnectionConfig } from './types.js';
import { getAdapter } from './factory.js';

/**
 * Parse database connection URL into ConnectionConfig
 *
 * @example
 * const config = parseConnectionUrl('postgresql://user:pass@localhost:5432/mydb?ssl=true');
 * // { host: 'localhost', port: 5432, database: 'mydb', user: 'user', password: 'pass', ssl: true }
 */
export function parseConnectionUrl(url: string): ConnectionConfig {
  const parsed = new URL(url);

  return {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port) : undefined,
    database: parsed.pathname.slice(1),
    user: parsed.username || undefined,
    password: parsed.password || undefined,
    ssl: parsed.searchParams.get('ssl') === 'true' || parsed.searchParams.get('sslmode') === 'require',
  };
}

/**
 * Build connection URL from config
 *
 * @example
 * const url = buildConnectionUrl('postgres', { host: 'localhost', database: 'mydb' });
 * // 'postgresql://localhost:5432/mydb'
 */
export function buildConnectionUrl(dialect: DatabaseDialect, config: ConnectionConfig): string {
  const protocol = dialect === 'postgres' ? 'postgresql' : dialect;
  const auth = config.user
    ? config.password
      ? `${config.user}:${config.password}@`
      : `${config.user}@`
    : '';

  const host = config.host || 'localhost';
  const port = config.port || getAdapter(dialect).getDefaultPort();
  const database = config.database;

  let url = port ? `${protocol}://${auth}${host}:${port}/${database}` : `${protocol}://${auth}${host}/${database}`;

  if (config.ssl) {
    url += '?ssl=true';
  }

  return url;
}

/**
 * Get default port for a dialect
 *
 * @example
 * getDefaultPort('postgres') // 5432
 * getDefaultPort('mysql')    // 3306
 * getDefaultPort('sqlite')   // null
 */
export function getDefaultPort(dialect: DatabaseDialect): number | null {
  return getAdapter(dialect).getDefaultPort();
}
