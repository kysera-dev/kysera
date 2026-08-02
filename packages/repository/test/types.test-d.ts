/**
 * Type-level tests for @kysera/repository's public generic surface.
 *
 * Each block mirrors a documented contract (doc page cited inline).
 * Run: `pnpm test:types` (vitest run --typecheck.only) — also enforced by
 * the package's `tsc --noEmit` typecheck gate.
 */

import { describe, it, expectTypeOf } from 'vitest'
import type { Generated, Kysely } from 'kysely'
import { z } from 'zod'
import { createRepositoryFactory, zodAdapter } from '../src/index.js'
import type {
  Executor,
  FindOptions,
  RepositoriesFromFactory,
  Repository,
  WhereClause
} from '../src/index.js'

interface UsersTable {
  id: Generated<number>
  email: string
  name: string | null
}

interface Database {
  users: UsersTable
}

declare const db: Kysely<Database>

describe('createRepositoryFactory (website/docs/api/repository/factory.md)', () => {
  const factory = createRepositoryFactory(db)

  it('infers the Entity type from the mapRow return value', () => {
    const repo = factory.create({
      tableName: 'users',
      mapRow: row => ({ id: row.id, email: row.email }),
      schemas: { create: zodAdapter(z.object({ email: z.string() })) }
    })

    // mapRow receives the Selectable row: Generated<number> unwraps to number
    expectTypeOf(repo.findById).returns.resolves.toEqualTypeOf<{
      id: number
      email: string
    } | null>()
    expectTypeOf(repo.findAll).returns.resolves.toEqualTypeOf<{ id: number; email: string }[]>()
    // PK defaults to number
    expectTypeOf(repo.findById).parameter(0).toEqualTypeOf<number>()
  })

  it('constrains tableName to the tables of DB', () => {
    factory.create({
      // @ts-expect-error - 'accounts' is not a table in Database
      tableName: 'accounts',
      mapRow: (row: unknown) => row,
      schemas: { create: zodAdapter(z.object({})) }
    })
  })

  it('types mapRow input from the selected table', () => {
    factory.create({
      tableName: 'users',
      // @ts-expect-error - Selectable users rows have no 'missing' column
      mapRow: row => ({ id: row.missing }),
      schemas: { create: zodAdapter(z.object({})) }
    })
  })
})

describe('FindOptions.where (website/docs/api/repository/operators.md — WhereClause)', () => {
  interface UserEntity {
    id: number
    email: string
    name: string | null
  }

  it('accepts plain equality shorthand', () => {
    const options: FindOptions<UserEntity> = { where: { email: 'a@b.c', id: 1 } }
    expectTypeOf(options.where).toExtend<WhereClause<UserEntity> | Record<string, unknown> | undefined>()
  })

  it('accepts documented field operators and $or/$and combinators', () => {
    const withOperators: FindOptions<UserEntity> = {
      where: {
        email: { $like: '%@example.com' },
        id: { $between: [1, 100] },
        $or: [{ name: { $isNull: true } }, { name: 'Alice' }]
      }
    }
    expectTypeOf(withOperators.where).not.toBeNever()
  })

  it('falls back to Record<string, unknown> for dynamic columns', () => {
    const dynamic: FindOptions<UserEntity> = {
      where: { tenant_id: 42 } as Record<string, unknown>
    }
    expectTypeOf(dynamic.where).not.toBeNever()
    // The declared union is exactly WhereClause | Record | undefined
    expectTypeOf<FindOptions<UserEntity>['where']>().toEqualTypeOf<
      WhereClause<UserEntity> | Record<string, unknown> | undefined
    >()
  })
})

describe('RepositoriesFromFactory (website/docs/api/repository/types.md)', () => {
  it('derives the repository map type from a factory function', () => {
    // Executor<DB> re-exported by @kysera/repository is the AnyExecutor union,
    // so the DB generic must be given explicitly when building from it
    // (union arguments give TS no single inference candidate).
    const createRepositories = (executor: Executor<Database>) => {
      const factory = createRepositoryFactory<Database>(executor)
      return {
        users: factory.create({
          tableName: 'users',
          mapRow: row => ({ id: row.id, email: row.email }),
          schemas: { create: zodAdapter(z.object({ email: z.string() })) }
        })
      }
    }

    type Repositories = RepositoriesFromFactory<typeof createRepositories>

    expectTypeOf<Repositories>().toEqualTypeOf<ReturnType<typeof createRepositories>>()
    expectTypeOf<Repositories['users']>().toExtend<
      Repository<{ id: number; email: string }, Database>
    >()
    expectTypeOf<keyof Repositories>().toEqualTypeOf<'users'>()
  })
})
