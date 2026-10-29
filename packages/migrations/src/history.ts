import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { BadRequestError, detectDialect } from '@kysera/core'

export interface MigrationRecord {
  name: string
  checksum: string | null
  executedAt: Date | string | null
}

/** Storage only. The runner owns locking, transactions and execution. */
export interface MigrationHistory {
  setup<DB>(db: Kysely<DB>): Promise<void>
  read<DB>(db: Kysely<DB>): Promise<MigrationRecord[]>
  insert<DB>(db: Kysely<DB>, record: MigrationRecord): Promise<void>
  remove<DB>(db: Kysely<DB>, name: string): Promise<void>
  setChecksum<DB>(db: Kysely<DB>, name: string, checksum: string): Promise<void>
}

export interface MigrationHistoryOptions {
  tableName?: string
  schema?: string
  keyColumn?: string
  keyType?: 'string' | 'integer'
  /** null preserves version-only legacy journals. */
  executedAtColumn?: string | null
  /** Optional monotonic execution order. Existing journals must already contain this column. */
  orderColumn?: string
  /** Opt in to an inline checksum column, added during setup if absent. */
  checksumColumn?: string
  /** Alternatively preserve an existing name/checksum sidecar table. */
  checksumTable?: string
  /** Compatibility metadata for existing journals (for example CLI timestamp/batch). */
  recordValues?: <DB>(
    db: Kysely<DB>,
    record: MigrationRecord,
    columns: ReadonlySet<string>
  ) => Promise<Record<string, unknown>>
}

type HistoryDB = Record<string, Record<string, unknown>>

/** Configurable SQL history shared by the library, CLI and framework adapters. */
export function createMigrationHistory(options: MigrationHistoryOptions = {}): MigrationHistory {
  const table = options.tableName ?? 'migrations'
  const key = options.keyColumn ?? 'name'
  const time = options.executedAtColumn === undefined ? 'executed_at' : options.executedAtColumn
  const order = options.orderColumn
  const checksum = options.checksumColumn
  const sidecar = options.checksumTable
  if (checksum && sidecar)
    throw new BadRequestError('Choose checksumColumn or checksumTable, not both')
  for (const identifier of [table, key, time, order, checksum, sidecar, options.schema]) {
    if (
      identifier !== undefined &&
      identifier !== null &&
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)
    ) {
      throw new BadRequestError(`Invalid migration history identifier: ${identifier}`)
    }
  }
  const view = <DB>(db: Kysely<DB>): Kysely<HistoryDB> => {
    // User schemas do not declare the framework-owned journal.
    const typed = db as unknown as Kysely<HistoryDB>
    return options.schema ? typed.withSchema(options.schema) : typed
  }
  const encode = (name: string): string | number => {
    if (options.keyType !== 'integer') return name
    const number = Number(name)
    if (!/^\d+$/.test(name) || !Number.isSafeInteger(number) || String(number) !== name) {
      throw new BadRequestError(`Migration name must be a canonical nonnegative integer: ${name}`)
    }
    return number
  }
  async function columns<DB>(db: Kysely<DB>, name = table): Promise<Set<string> | null> {
    const tables = await db.introspection.getTables({ withInternalKyselyTables: true })
    const schema = options.schema
    const matches = tables.filter(
      t =>
        t.name === name &&
        (schema
          ? t.schema === schema
          : t.schema === undefined ||
            t.schema === 'public' ||
            t.schema === 'main' ||
            t.schema === 'dbo')
    )
    if (matches.length > 1)
      throw new BadRequestError(`Ambiguous migration table ${name}; specify schema`)
    const found = matches[0]
    return found ? new Set(found.columns.map(c => c.name)) : null
  }
  const qualified = (name: string): string => (options.schema ? `${options.schema}.${name}` : name)
  async function createTable<DB>(
    db: Kysely<DB>,
    name: string,
    checksumOnly = false
  ): Promise<void> {
    const mssql = detectDialect(db) === 'mssql'
    let builder = view(db)
      .schema.createTable(name)
      .addColumn(
        checksumOnly ? 'name' : key,
        !checksumOnly && options.keyType === 'integer' ? 'integer' : 'varchar(255)',
        c => c.primaryKey()
      )
    if (checksumOnly || time) {
      builder = builder.addColumn(
        checksumOnly ? 'recorded_at' : time!,
        mssql ? 'datetime2' : 'timestamp',
        c => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
    }
    if (!checksumOnly && order) builder = builder.addColumn(order, 'bigint')
    if (checksumOnly || checksum)
      builder = builder.addColumn(checksumOnly ? 'checksum' : checksum!, 'varchar(64)')
    if (mssql) {
      // SQL Server has no CREATE TABLE IF NOT EXISTS. Identifiers come from
      // Kysely's compiler; the existence guard remains a bound value.
      const compiled = builder.compile()
      await sql`if object_id(${qualified(name)}, N'U') is null ${sql.raw(compiled.sql)}`.execute(db)
    } else await builder.ifNotExists().execute()
  }
  return {
    async setup(db) {
      if (options.schema && detectDialect(db) === 'postgres') {
        await db.schema.createSchema(options.schema).ifNotExists().execute()
      }
      let existing = await columns(db)
      if (!existing) {
        await createTable(db, table)
        existing = new Set([
          key,
          ...(time ? [time] : []),
          ...(checksum ? [checksum] : []),
          ...(order ? [order] : [])
        ])
      }
      if (!existing.has(key) || (time && !existing.has(time))) {
        throw new BadRequestError(
          `Migration history ${qualified(table)} has incompatible columns; configure its existing key and timestamp explicitly`
        )
      }
      if (order && !existing.has(order))
        throw new BadRequestError(
          `Migration history ${qualified(table)} has no ${order}; preserve the existing history configuration or add the column in a separately reviewed schema change`
        )
      if (checksum && !existing.has(checksum)) {
        await view(db).schema.alterTable(table).addColumn(checksum, 'varchar(64)').execute()
      }
      if (sidecar) await createTable(db, sidecar, true)
    },
    async read(db) {
      const existing = await columns(db)
      if (!existing) return []
      if (!existing.has(key) || (time && !existing.has(time))) {
        throw new BadRequestError(`Incompatible migration history ${qualified(table)}`)
      }
      let query = view(db).selectFrom(table).selectAll()
      if (order) {
        if (!existing.has(order))
          throw new BadRequestError(`Migration history ${qualified(table)} has no ${order}`)
        query = query
          .orderBy(sql`case when ${sql.ref(order)} is null then 0 else 1 end`, 'asc')
          .orderBy(order, 'asc')
      }
      if (time) query = query.orderBy(time, 'asc')
      const rows = await query.orderBy(key, 'asc').execute()
      const checksums = new Map<string, string>()
      if (sidecar && (await columns(db, sidecar))) {
        for (const row of await view(db)
          .selectFrom(sidecar)
          .select(['name', 'checksum'])
          .execute()) {
          if (typeof row.checksum === 'string') checksums.set(String(row.name), row.checksum)
        }
      }
      return rows.map(row => ({
        name: String(row[key]),
        checksum:
          checksum && typeof row[checksum] === 'string'
            ? (row[checksum] as string)
            : (checksums.get(String(row[key])) ?? null),
        executedAt:
          time && (row[time] instanceof Date || typeof row[time] === 'string')
            ? (row[time] as Date | string)
            : null
      }))
    },
    async insert(db, record) {
      const values: Record<string, unknown> = {
        ...(options.recordValues
          ? await options.recordValues(db, record, (await columns(db)) ?? new Set())
          : {}),
        [key]: encode(record.name)
      }
      if (order) {
        const latest = await view(db)
          .selectFrom(table)
          .select(sql<string | number | null>`max(${sql.ref(order)})`.as('last'))
          .executeTakeFirst()
        values[order] = String(BigInt(latest?.last ?? 0) + 1n)
      }
      if (checksum) values[checksum] = record.checksum
      if (time && record.executedAt !== null) values[time] = record.executedAt
      await view(db).insertInto(table).values(values).execute()
      if (sidecar && record.checksum !== null) {
        await view(db)
          .insertInto(sidecar)
          .values({ name: record.name, checksum: record.checksum })
          .execute()
      }
    },
    async remove(db, name) {
      if (sidecar) await view(db).deleteFrom(sidecar).where('name', '=', name).execute()
      await view(db).deleteFrom(table).where(key, '=', encode(name)).execute()
    },
    async setChecksum(db, name, value) {
      // Adoption never overwrites an existing checksum. The caller holds
      // the migration lock and owns the surrounding transaction.
      if (checksum) {
        await view(db)
          .updateTable(table)
          .set({ [checksum]: value })
          .where(key, '=', encode(name))
          .where(checksum, 'is', null)
          .execute()
      } else if (sidecar) {
        const found = await view(db)
          .selectFrom(sidecar)
          .select('checksum')
          .where('name', '=', name)
          .executeTakeFirst()
        if (!found) await view(db).insertInto(sidecar).values({ name, checksum: value }).execute()
      } else throw new BadRequestError('Migration history has no checksum storage configured')
    }
  }
}
