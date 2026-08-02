/**
 * Type-level tests for @kysera/executor's public generic surface.
 *
 * Each block mirrors a documented contract (doc page cited inline).
 * Run: `pnpm test:types` (vitest run --typecheck.only) — also enforced by
 * the package's `tsc --noEmit` typecheck gate.
 */

import { describe, it, expectTypeOf } from 'vitest'
import type { Generated, Kysely } from 'kysely'
import { createExecutor, createExecutorSync, isKyseraExecutor, withPluginMetadata } from '../src/index.js'
import type { KyseraExecutor, KyseraExecutorMarker, Plugin } from '../src/index.js'

interface UsersTable {
  id: Generated<number>
  email: string
}

interface Database {
  users: UsersTable
}

declare const db: Kysely<Database>
declare const plugins: Plugin[]
declare const executor: KyseraExecutor<Database>

describe('createExecutor (website/docs/api/executor.md — createExecutor)', () => {
  it('preserves the DB generic through the async factory', () => {
    expectTypeOf(createExecutor(db, plugins)).toEqualTypeOf<Promise<KyseraExecutor<Database>>>()
    expectTypeOf(createExecutorSync(db, plugins)).toEqualTypeOf<KyseraExecutor<Database>>()
  })

  it('keeps the full Kysely query-builder surface on the wrapper', () => {
    expectTypeOf(executor.selectFrom).toEqualTypeOf<Kysely<Database>['selectFrom']>()
    expectTypeOf(executor.insertInto).toEqualTypeOf<Kysely<Database>['insertInto']>()
  })
})

describe('KyseraExecutor marker fields (website/docs/api/executor.md — Runtime behavior)', () => {
  it('exposes the __kysera / __plugins / __rawDb / __schema markers', () => {
    expectTypeOf(executor.__kysera).toEqualTypeOf<true>()
    expectTypeOf(executor.__plugins).toEqualTypeOf<readonly Plugin[]>()
    expectTypeOf(executor.__rawDb).toEqualTypeOf<Kysely<Database>>()
    expectTypeOf(executor.__schema).toEqualTypeOf<string | undefined>()
  })

  it('KyseraExecutor<DB> is exactly Kysely<DB> & KyseraExecutorMarker<DB>', () => {
    expectTypeOf<KyseraExecutor<Database>>().toEqualTypeOf<
      Kysely<Database> & KyseraExecutorMarker<Database>
    >()
  })

  it('isKyseraExecutor narrows a plain Kysely union', () => {
    const candidate = db as Kysely<Database> | KyseraExecutor<Database>
    if (isKyseraExecutor(candidate)) {
      expectTypeOf(candidate).toEqualTypeOf<KyseraExecutor<Database>>()
    }
  })
})

describe('withPluginMetadata (website/docs/plugins/authoring-guide.md — metadata propagation)', () => {
  it('returns Kysely<DB>, usable anywhere a plain Kysely is expected', () => {
    // Note: with a *concrete* KyseraExecutor argument, DB inference through
    // the intersection goes wrong (TS picks an index-signature candidate), so
    // the executor-typed call needs an explicit type argument. Plain Kysely
    // arguments — the shape plugins actually hold (see @kysera/soft-delete,
    // @kysera/audit call sites) — infer cleanly.
    expectTypeOf(withPluginMetadata<Database>(executor, { source: 'test' })).toEqualTypeOf<
      Kysely<Database>
    >()
    expectTypeOf(withPluginMetadata(db, { source: 'test' })).toEqualTypeOf<Kysely<Database>>()
  })

  it('requires a readonly metadata record', () => {
    expectTypeOf(withPluginMetadata<Database>)
      .parameter(1)
      .toEqualTypeOf<Readonly<Record<string, unknown>>>()
  })
})
