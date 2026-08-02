/**
 * Table selection for code generation: internal bookkeeping tables are
 * skipped by default, and the user can narrow or widen the set with
 * comma-separated glob patterns (`*` matches any run of characters,
 * `?` a single character).
 */

/** Subset of the resolved CLI config the filter needs. */
export interface TableFilterConfig {
  migrations?: {
    tableName?: string
  }
}

/**
 * Tables the toolkit manages itself; excluded from code generation unless
 * explicitly re-included via an --include pattern.
 */
export function internalTables(config: TableFilterConfig): string[] {
  const migrationsTable = config.migrations?.tableName ?? 'migrations'
  return [
    migrationsTable,
    'kysera_migration_lock',
    // SQLite bookkeeping; normally filtered out by introspection already.
    'sqlite_sequence',
    'sqlite_stat1',
    'sqlite_stat2',
    'sqlite_stat3',
    'sqlite_stat4'
  ]
}

/** Convert a table-name glob (`*`, `?`) into an anchored RegExp. */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

function splitPatterns(value: string | undefined): RegExp[] {
  if (value === undefined) return []
  return value
    .split(',')
    .map(pattern => pattern.trim())
    .filter(pattern => pattern !== '')
    .map(globToRegExp)
}

export interface TableFilterOptions {
  /** Comma-separated globs; when present, only matching tables are kept. */
  include?: string
  /** Comma-separated globs; matching tables are dropped (wins over include). */
  exclude?: string
  /** Table names excluded by default (no include pattern given). */
  internal?: string[]
}

/**
 * Build a predicate deciding whether a table participates in generation.
 *
 * Precedence: --exclude always wins; --include (when given) keeps only
 * matching tables and also re-includes internal tables it matches; with
 * neither, everything except the internal tables is kept.
 */
export function buildTableFilter(options: TableFilterOptions): (table: string) => boolean {
  const include = splitPatterns(options.include)
  const exclude = splitPatterns(options.exclude)
  const internal = new Set(options.internal ?? [])

  return (table: string): boolean => {
    if (exclude.some(pattern => pattern.test(table))) return false
    if (include.length > 0) return include.some(pattern => pattern.test(table))
    return !internal.has(table)
  }
}
