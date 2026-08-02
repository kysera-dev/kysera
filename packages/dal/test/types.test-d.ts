/**
 * Type-level tests for @kysera/dal's public generic surface.
 *
 * Each block mirrors a documented contract (doc page cited inline).
 * Run: `pnpm test:types` (vitest run --typecheck.only) — also enforced by
 * the package's `tsc --noEmit` typecheck gate.
 */

import { describe, it, expectTypeOf } from 'vitest'
import type { Generated, Kysely } from 'kysely'
import type { KyseraExecutor } from '@kysera/executor'
import { createContext, createQuery } from '../src/index.js'
import type { DbContext, QueryFunction } from '../src/index.js'

interface UsersTable {
  id: Generated<number>
  email: string
}

interface Database {
  users: UsersTable
}

declare const db: Kysely<Database>

describe('createQuery (website/docs/api/dal.md — createQuery)', () => {
  const getUserById = createQuery((ctx: DbContext<Database>, id: number) =>
    ctx.db.selectFrom('users').select(['id', 'email']).where('id', '=', id).executeTakeFirst()
  )

  it('infers the result type from the query (api/dal.md — "Return type inference")', () => {
    expectTypeOf(getUserById).returns.resolves.toEqualTypeOf<
      { id: number; email: string } | undefined
    >()
  })

  it('accepts a raw Kysely, a KyseraExecutor, or an existing DbContext', () => {
    expectTypeOf(getUserById)
      .parameter(0)
      .toEqualTypeOf<DbContext<Database> | Kysely<Database> | KyseraExecutor<Database>>()
    expectTypeOf(getUserById).toEqualTypeOf<
      QueryFunction<Database, [id: number], { id: number; email: string } | undefined>
    >()
  })

  it('requires the documented explicit ctx annotation — DB cannot be inferred from the callback alone', () => {
    // Every createQuery example annotates ctx (api/dal.md — createQuery examples).
    // Without the annotation DB collapses to unknown, so the schema's tables
    // are not visible on ctx.db:
    createQuery(ctx =>
      // @ts-expect-error - 'users' is unknown without `ctx: DbContext<Database>`
      ctx.db.selectFrom('users').selectAll().execute()
    )
  })
})

describe('DbContext (website/docs/api/dal.md — DbContext)', () => {
  it('is produced by createContext with the DB generic preserved', () => {
    expectTypeOf(createContext(db)).toEqualTypeOf<DbContext<Database>>()
  })

  it('cannot be constructed structurally — the context marker symbol is required', () => {
    // The DB_CONTEXT_SYMBOL marker property means hand-rolled object literals
    // are rejected; contexts come from createContext / withTransaction.
    // @ts-expect-error - missing the DbContext marker symbol
    const invalid: DbContext<Database> = { db, isTransaction: false }
    expectTypeOf(invalid).toEqualTypeOf<DbContext<Database>>()
  })

  it('exposes the executor and transaction flag as readonly state', () => {
    expectTypeOf<DbContext<Database>['isTransaction']>().toEqualTypeOf<boolean>()
    expectTypeOf<DbContext<Database>['schema']>().toEqualTypeOf<string | undefined>()
  })
})
