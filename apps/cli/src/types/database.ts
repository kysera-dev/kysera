import type { Kysely, RawBuilder, sql } from 'kysely';

/**
 * Generic database schema type for dynamic table access.
 * Tables are represented as key-value pairs where values are records with unknown columns.
 */
export interface Database {
  [key: string]: Record<string, unknown>;
}

/**
 * Compiled query interface for raw SQL execution.
 */
export interface CompiledQuery {
  sql: string;
  parameters: readonly unknown[];
}

/**
 * Query execution result.
 */
export interface QueryResult<T = unknown> {
  rows: T[];
  numAffectedRows?: bigint | number;
  numChangedRows?: bigint;
  insertId?: bigint | number;
}

/**
 * Extended Kysely instance with helper methods for CLI usage.
 * Includes executeQuery and raw methods for convenient raw SQL execution.
 *
 * Note: These methods are dynamically available on Kysely instances at runtime,
 * but we declare them explicitly for type safety in the CLI.
 */
export type DatabaseInstance = Kysely<Database> & {
  /**
   * Execute a raw SQL query.
   * @param query - Raw SQL string or CompiledQuery
   */
  executeQuery(query: CompiledQuery | RawBuilder<unknown>): Promise<QueryResult>;

  /**
   * Create a raw SQL builder.
   * @param sql - SQL template string
   */
  raw<T = unknown>(sql: string): RawBuilder<T>;
};

/**
 * Base interface for query execution plans across all dialects.
 * Contains common fields that may appear in execution plans.
 */
export interface QueryPlan {
  /** The type of operation node (e.g., 'Seq Scan', 'Index Scan', 'Hash Join') */
  'Node Type'?: string;
  /** Estimated total cost of the operation */
  'Total Cost'?: number;
  /** Estimated number of rows to be returned */
  'Plan Rows'?: number;
  /** Child plans in the execution tree */
  Plans?: QueryPlan[];
  /** Table/relation being accessed */
  'Relation Name'?: string;
  /** Index being used (if any) */
  'Index Name'?: string;
  /** Filter condition applied */
  Filter?: string;
  /** Join condition */
  'Join Filter'?: string;
  /** Hash join condition */
  'Hash Cond'?: string;
  /** Index condition */
  'Index Cond'?: string;
  /** Sort keys */
  'Sort Key'?: string | string[];
  /** Sort method used */
  'Sort Method'?: string;
  /** Memory used for sorting */
  'Sort Space Used'?: number;
  /** Width of output rows in bytes */
  'Plan Width'?: number;
}

/**
 * PostgreSQL-specific execution plan with additional ANALYZE fields.
 * Extends base QueryPlan with timing and actual execution statistics.
 */
export interface PostgresPlan extends QueryPlan {
  /** Cost to return first row */
  'Startup Cost'?: number;
  /** Actual time to complete operation (ms) */
  'Actual Total Time'?: number;
  /** Actual time to return first row (ms) */
  'Actual Startup Time'?: number;
  /** Actual number of rows returned */
  'Actual Rows'?: number;
  /** Number of times this node was executed */
  'Actual Loops'?: number;
  /** Number of rows removed by filter */
  'Rows Removed by Filter'?: number;
  /** Number of rows removed by join filter */
  'Rows Removed by Join Filter'?: number;
  /** Shared buffer hits */
  'Shared Hit Blocks'?: number;
  /** Shared buffer reads */
  'Shared Read Blocks'?: number;
  /** Shared buffer dirtied */
  'Shared Dirtied Blocks'?: number;
  /** Shared buffer written */
  'Shared Written Blocks'?: number;
  /** Hash batches used */
  'Hash Batches'?: number;
  /** Output columns (verbose mode) */
  Output?: string | string[];
  /** Child plans with PostgreSQL-specific fields */
  Plans?: PostgresPlan[];
}

/**
 * PostgreSQL EXPLAIN output wrapper containing the plan and timing info.
 */
export interface PostgresExplainOutput {
  /** The root execution plan */
  Plan?: PostgresPlan;
  /** Planning time in milliseconds */
  'Planning Time'?: number;
  /** Execution time in milliseconds */
  'Execution Time'?: number;
  /** Total runtime in milliseconds */
  'Total Runtime'?: number;
  /** Trigger execution information */
  Triggers?: PostgresTriggerInfo[];
  /** JIT compilation information */
  JIT?: PostgresJitInfo;
}

/**
 * PostgreSQL trigger execution information.
 */
export interface PostgresTriggerInfo {
  'Trigger Name': string;
  Time: number;
  Calls: number;
}

/**
 * PostgreSQL JIT compilation information.
 */
export interface PostgresJitInfo {
  Functions: number;
  Options: {
    Inlining: boolean;
    Optimization: boolean;
  };
  Timing: {
    Generation: number;
    Inlining: number;
    Optimization: number;
    Emission: number;
    Total: number;
  };
}

/**
 * MySQL EXPLAIN output row.
 * Represents a single row from MySQL's EXPLAIN command.
 */
export interface MySQLPlan {
  /** Unique identifier for the SELECT */
  id?: number;
  /** Type of SELECT (SIMPLE, PRIMARY, UNION, etc.) */
  select_type?: string;
  /** Table being accessed */
  table?: string;
  /** Join type (system, const, eq_ref, ref, range, index, ALL) */
  type?: string;
  /** Indexes that could potentially be used */
  possible_keys?: string | null;
  /** Index actually used */
  key?: string | null;
  /** Length of the key used */
  key_length?: string | null;
  /** Column or constant compared with index */
  ref?: string | null;
  /** Estimated number of rows to examine */
  rows?: number;
  /** Percentage of rows filtered by condition */
  filtered?: number;
  /** Additional information (Using where, Using filesort, Using temporary, etc.) */
  Extra?: string;
}

/**
 * MySQL JSON EXPLAIN format structures.
 */
export interface MySQLJsonPlan {
  query_block?: MySQLQueryBlock;
}

export interface MySQLQueryBlock {
  select_id?: number;
  cost_info?: MySQLCostInfo;
  table?: MySQLTableInfo;
  nested_loop?: Array<{ table: MySQLTableInfo }>;
  ordering_operation?: MySQLOrderingOperation;
  grouping_operation?: MySQLGroupingOperation;
}

export interface MySQLCostInfo {
  query_cost?: string;
  read_cost?: string;
  eval_cost?: string;
  prefix_cost?: string;
}

export interface MySQLTableInfo {
  table_name?: string;
  access_type?: string;
  key?: string;
  key_length?: string;
  rows_examined_per_scan?: number;
  rows_produced_per_join?: number;
  filtered?: number;
  cost_info?: MySQLCostInfo;
  used_columns?: string[];
  attached_condition?: string;
}

export interface MySQLOrderingOperation {
  using_temporary_table?: boolean;
  using_filesort?: boolean;
}

export interface MySQLGroupingOperation {
  using_temporary_table?: boolean;
}

/**
 * SQLite EXPLAIN QUERY PLAN output row.
 */
export interface SQLitePlan {
  /** Node ID in the plan tree */
  id?: number;
  /** Parent node ID */
  parent?: number;
  /** Not used */
  notused?: number;
  /** Human-readable description of the operation */
  detail?: string;
}

/**
 * Union type for all dialect-specific plans.
 */
export type DialectPlan = QueryPlan | PostgresPlan | MySQLPlan | SQLitePlan;

/**
 * Generic query result row type.
 */
export type QueryResultRow = Record<string, unknown>;

/**
 * PostgreSQL EXPLAIN text output row.
 */
export interface PostgresExplainTextRow {
  'QUERY PLAN': string;
}

/**
 * MySQL EXPLAIN JSON output row.
 */
export interface MySQLExplainJsonRow {
  EXPLAIN: string | MySQLJsonPlan;
}

/**
 * Column information from database introspection.
 */
export interface ColumnInfo {
  /** Column name */
  name: string;
  /** Database-specific data type */
  dataType: string;
  /** Whether the column accepts null values */
  isNullable: boolean;
  /** Whether this column is part of the primary key */
  isPrimaryKey: boolean;
  /** Whether this column is part of a foreign key */
  isForeignKey: boolean;
  /** Default value for the column */
  defaultValue?: string | null;
  /** Maximum length for string/varchar types */
  maxLength?: number;
  /** Referenced table (if foreign key) */
  referencedTable?: string;
  /** Referenced column (if foreign key) */
  referencedColumn?: string;
}

/**
 * Index information from database introspection.
 */
export interface IndexInfo {
  /** Index name */
  name: string;
  /** Columns included in the index */
  columns: string[];
  /** Whether the index enforces uniqueness */
  isUnique: boolean;
  /** Whether this is the primary key index */
  isPrimary: boolean;
  /** Index cardinality (if available) */
  cardinality?: number;
  /** Index usage statistics (if available) */
  usage?: number;
}

/**
 * Foreign key information from database introspection.
 */
export interface ForeignKeyInfo {
  /** Column name in current table */
  column: string;
  /** Referenced table name */
  referencedTable: string;
  /** Referenced column name */
  referencedColumn: string;
  /** Foreign key constraint name */
  constraintName?: string;
  /** On delete action */
  onDelete?: string;
  /** On update action */
  onUpdate?: string;
}

/**
 * Complete table information from database introspection.
 */
export interface TableInfo {
  /** Table name */
  name: string;
  /** Table schema/database */
  schema?: string;
  /** List of columns */
  columns: ColumnInfo[];
  /** Primary key column names */
  primaryKey?: string[];
  /** List of indexes */
  indexes: IndexInfo[];
  /** List of foreign keys */
  foreignKeys?: ForeignKeyInfo[];
  /** Row count (if available) */
  rowCount?: number;
}
