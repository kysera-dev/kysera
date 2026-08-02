import type { IntrospectorDialect, TableColumn } from './introspector.js'

/**
 * Maps introspected columns to Kysely-correct TypeScript types, mirroring
 * what each dialect's driver actually returns and accepts:
 *
 * - PostgreSQL (pg): bigint/numeric select as strings, timestamps as Date,
 *   json/jsonb parse to objects but are inserted as strings.
 * - MySQL (mysql2): datetime/timestamp/date select as Date, decimal as
 *   string, json parses to objects but is inserted as a string.
 * - SQLite (better-sqlite3): only number/string/Buffer exist; booleans are
 *   0/1 numbers, dates and json are plain strings.
 *
 * Columns the database fills in (auto-increment/serial/identity or any
 * DEFAULT) are wrapped in `Generated<...>`, nullable columns get `| null`.
 */

/** Helper type aliases the generated file may reference. */
export type HelperAlias = 'Int8' | 'Json' | 'Numeric' | 'Timestamp'

/** `export type ...` declarations for each helper alias, in output order. */
const HELPER_DECLARATIONS: Record<HelperAlias, string[]> = {
  Int8: [
    'export type Int8 = ColumnType<string, string | number | bigint, string | number | bigint>'
  ],
  Json: [
    'export type Json = ColumnType<JsonValue, string, string>',
    '',
    'export type JsonArray = JsonValue[]',
    '',
    'export type JsonObject = {',
    '  [x: string]: JsonValue | undefined',
    '}',
    '',
    'export type JsonPrimitive = boolean | number | string | null',
    '',
    'export type JsonValue = JsonArray | JsonObject | JsonPrimitive'
  ],
  Numeric: ['export type Numeric = ColumnType<string, number | string, number | string>'],
  Timestamp: ['export type Timestamp = ColumnType<Date, Date | string, Date | string>']
}

const HELPER_ORDER: HelperAlias[] = ['Int8', 'Json', 'Numeric', 'Timestamp']

const POSTGRES_TYPES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    smallint: 'number',
    int2: 'number',
    integer: 'number',
    int: 'number',
    int4: 'number',
    serial: 'number',
    smallserial: 'number',
    bigint: 'Int8',
    int8: 'Int8',
    bigserial: 'Int8',
    real: 'number',
    float4: 'number',
    'double precision': 'number',
    float8: 'number',
    numeric: 'Numeric',
    decimal: 'Numeric',
    money: 'string',
    boolean: 'boolean',
    bool: 'boolean',
    text: 'string',
    'character varying': 'string',
    varchar: 'string',
    character: 'string',
    char: 'string',
    citext: 'string',
    name: 'string',
    uuid: 'string',
    date: 'Timestamp',
    'timestamp without time zone': 'Timestamp',
    'timestamp with time zone': 'Timestamp',
    timestamp: 'Timestamp',
    timestamptz: 'Timestamp',
    'time without time zone': 'string',
    'time with time zone': 'string',
    time: 'string',
    timetz: 'string',
    interval: 'string',
    json: 'Json',
    jsonb: 'Json',
    bytea: 'Buffer',
    inet: 'string',
    cidr: 'string',
    macaddr: 'string',
    xml: 'string',
    tsvector: 'string',
    tsquery: 'string',
    bit: 'string',
    'bit varying': 'string',
    oid: 'number'
  })
)

const MYSQL_TYPES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    tinyint: 'number',
    smallint: 'number',
    mediumint: 'number',
    int: 'number',
    integer: 'number',
    year: 'number',
    bigint: 'number',
    float: 'number',
    double: 'number',
    decimal: 'Numeric',
    numeric: 'Numeric',
    bit: 'Buffer',
    boolean: 'boolean',
    bool: 'boolean',
    date: 'Date',
    datetime: 'Date',
    timestamp: 'Date',
    time: 'string',
    char: 'string',
    varchar: 'string',
    tinytext: 'string',
    text: 'string',
    mediumtext: 'string',
    longtext: 'string',
    enum: 'string',
    set: 'string',
    json: 'Json',
    binary: 'Buffer',
    varbinary: 'Buffer',
    tinyblob: 'Buffer',
    blob: 'Buffer',
    mediumblob: 'Buffer',
    longblob: 'Buffer'
  })
)

function isHelperAlias(type: string): type is HelperAlias {
  return type === 'Int8' || type === 'Json' || type === 'Numeric' || type === 'Timestamp'
}

/**
 * Tracks which helper aliases and kysely imports the generated file needs
 * while mapping columns for a single output file.
 */
export class KyselyTypeMapper {
  private readonly usedHelpers = new Set<HelperAlias>()
  private generatedUsed = false

  constructor(private readonly dialect: IntrospectorDialect) {}

  /**
   * Full Kysely column type: scalar type, `| null` for nullable columns and
   * a `Generated<...>` wrapper when the database fills the column in.
   */
  columnType(column: TableColumn): string {
    let type = this.scalarType(column)
    if (column.isNullable) {
      type = `${type} | null`
    }
    if (column.isAutoIncrement || column.defaultValue !== undefined) {
      this.generatedUsed = true
      type = `Generated<${type}>`
    }
    return type
  }

  /** Scalar TypeScript type for the column, without nullability wrappers. */
  scalarType(column: TableColumn): string {
    switch (this.dialect) {
      case 'postgres':
        return this.postgresType(column)
      case 'mysql':
        return this.track(MYSQL_TYPES.get(column.dataType.toLowerCase()) ?? 'string')
      case 'sqlite':
        return this.sqliteType(column.dataType)
      default:
        return 'string'
    }
  }

  private postgresType(column: TableColumn): string {
    const dataType = column.dataType.toLowerCase()
    if (dataType === 'array') {
      return this.postgresArrayType(column.udtName)
    }
    // Enums, domains and extension types surface as USER-DEFINED; without
    // their value lists a plain string is the safe representation.
    if (dataType === 'user-defined') {
      return 'string'
    }
    return this.track(POSTGRES_TYPES.get(dataType) ?? 'string')
  }

  private postgresArrayType(udtName: string | undefined): string {
    // information_schema reports arrays as data_type ARRAY with udt_name
    // '_<element>' (e.g. '_int4' for integer[]).
    const elementUdt = udtName?.startsWith('_') ? udtName.slice(1) : udtName
    const mapped = elementUdt === undefined ? undefined : POSTGRES_TYPES.get(elementUdt)
    if (mapped === undefined) {
      return 'unknown[]'
    }
    const element = this.track(mapped)
    return element.includes('|') || element.includes(' ') ? `(${element})[]` : `${element}[]`
  }

  private sqliteType(declaredType: string): string {
    // SQLite column types are free-form; resolve them the way the driver
    // does, via type affinity (better-sqlite3 returns number/string/Buffer).
    const dataType = declaredType.toLowerCase()
    if (dataType.includes('json')) return 'string'
    if (dataType.includes('bool')) return 'number'
    if (dataType.includes('int')) return 'number'
    if (dataType.includes('date') || dataType.includes('time')) return 'string'
    if (dataType.includes('char') || dataType.includes('clob') || dataType.includes('text')) {
      return 'string'
    }
    if (dataType.includes('blob') || dataType.includes('binary')) return 'Buffer'
    if (
      dataType.includes('real') ||
      dataType.includes('floa') ||
      dataType.includes('doub') ||
      dataType.includes('numeric') ||
      dataType.includes('decimal')
    ) {
      return 'number'
    }
    return 'string'
  }

  private track(type: string): string {
    if (isHelperAlias(type)) {
      this.usedHelpers.add(type)
    }
    return type
  }

  /** Whether any mapped column used `Generated<...>`. */
  get needsGenerated(): boolean {
    return this.generatedUsed
  }

  /** Whether any helper alias (and therefore `ColumnType`) is referenced. */
  get needsColumnType(): boolean {
    return this.usedHelpers.size > 0
  }

  /**
   * Declarations for every helper alias referenced so far, in stable order.
   */
  helperDeclarations(): string[] {
    const lines: string[] = []
    for (const helper of HELPER_ORDER) {
      if (!this.usedHelpers.has(helper)) continue
      if (lines.length > 0) lines.push('')
      lines.push(...HELPER_DECLARATIONS[helper])
    }
    return lines
  }
}
