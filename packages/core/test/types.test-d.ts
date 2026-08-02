/**
 * Type-level tests for @kysera/core's public generic surface.
 *
 * Each block mirrors a documented contract (doc page cited inline).
 * Run: `pnpm test:types` (vitest run --typecheck.only) — also enforced by
 * the package's `tsc --noEmit` typecheck gate.
 */

import { describe, it, expectTypeOf } from 'vitest'
import type { Generated, Kysely, Transaction } from 'kysely'
import type { KyseraExecutor } from '@kysera/executor'
import { parseDatabaseError, DatabaseError, UniqueConstraintError } from '../src/index.js'
import type { AnyExecutor, Dialect, Executor, PaginatedResult } from '../src/index.js'

interface UsersTable {
  id: Generated<number>
  email: string
  name: string | null
}

interface Database {
  users: UsersTable
}

describe('Executor<DB> (website/docs/api/core.md — Executor)', () => {
  it('accepts Kysely and Transaction instances', () => {
    expectTypeOf<Kysely<Database>>().toExtend<Executor<Database>>()
    expectTypeOf<Transaction<Database>>().toExtend<Executor<Database>>()
  })

  it('accepts a KyseraExecutor because it is a Kysely intersection', () => {
    // Executor<DB> deliberately omits KyseraExecutor from the union (see the
    // type's doc comment), but the intersection stays assignable.
    expectTypeOf<KyseraExecutor<Database>>().toExtend<Executor<Database>>()
  })

  it('preserves the DB generic for the query builder', () => {
    expectTypeOf<Executor<Database>['selectFrom']>().toEqualTypeOf<
      Kysely<Database>['selectFrom'] | Transaction<Database>['selectFrom']
    >()
  })
})

describe('AnyExecutor<DB> (website/docs/api/core.md — AnyExecutor)', () => {
  it('accepts Kysely, Transaction, and KyseraExecutor', () => {
    expectTypeOf<Kysely<Database>>().toExtend<AnyExecutor<Database>>()
    expectTypeOf<Transaction<Database>>().toExtend<AnyExecutor<Database>>()
    expectTypeOf<KyseraExecutor<Database>>().toExtend<AnyExecutor<Database>>()
  })

  it('rejects executors for a different schema', () => {
    interface OtherDatabase {
      accounts: { id: Generated<number> }
    }
    expectTypeOf<Kysely<OtherDatabase>>().not.toExtend<AnyExecutor<Database>>()
  })
})

describe('PaginatedResult<T> (website/docs/api/core/pagination.md)', () => {
  it('exposes data rows typed as T[]', () => {
    expectTypeOf<PaginatedResult<{ id: number }>['data']>().toEqualTypeOf<{ id: number }[]>()
  })

  it('always reports hasNext; offset and cursor fields are optional', () => {
    type Pagination = PaginatedResult<unknown>['pagination']
    expectTypeOf<Pagination['hasNext']>().toEqualTypeOf<boolean>()
    expectTypeOf<Pagination['page']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<Pagination['limit']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<Pagination['total']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<Pagination['totalPages']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<Pagination['hasPrev']>().toEqualTypeOf<boolean | undefined>()
    expectTypeOf<Pagination['nextCursor']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Pagination['prevCursor']>().toEqualTypeOf<string | undefined>()
  })
})

describe('parseDatabaseError (website/docs/api/core/errors.md, core-concepts/error-handling.md)', () => {
  it('takes unknown input plus an optional dialect and returns DatabaseError', () => {
    expectTypeOf(parseDatabaseError).parameter(0).toEqualTypeOf<unknown>()
    expectTypeOf(parseDatabaseError).parameter(1).toEqualTypeOf<Dialect | undefined>()
    expectTypeOf(parseDatabaseError).returns.toEqualTypeOf<DatabaseError>()
  })

  it('supports instanceof narrowing to the documented subclasses', () => {
    const error = parseDatabaseError(new Error('boom'), 'postgres')
    if (error instanceof UniqueConstraintError) {
      expectTypeOf(error).toExtend<DatabaseError>()
      expectTypeOf(error.name).toEqualTypeOf<string>()
    }
  })
})
