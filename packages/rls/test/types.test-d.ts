/**
 * Type-level tests for @kysera/rls's public generic surface.
 *
 * Each block mirrors a documented contract (doc page cited inline).
 * Run: `pnpm test:types` (vitest run --typecheck.only) — also enforced by
 * the package's `tsc --noEmit` typecheck gate.
 */

import { describe, it, expectTypeOf } from 'vitest'
import type { Generated } from 'kysely'
import { defineRLSSchema, mergeRLSSchemas } from '../src/index.js'
import type { RLSSchema } from '../src/index.js'

interface UsersTable {
  id: Generated<number>
  tenant_id: string
  email: string
}

interface PostsTable {
  id: Generated<number>
  author_id: number
}

interface Database {
  users: UsersTable
  posts: PostsTable
}

describe('defineRLSSchema (website/docs/plugins/rls.md — Defining the schema)', () => {
  it('accepts table keys from the DB schema and returns RLSSchema<DB>', () => {
    const schema = defineRLSSchema<Database>({
      users: { policies: [] },
      posts: { policies: [] }
    })

    expectTypeOf(schema).toEqualTypeOf<RLSSchema<Database>>()
    // Every table is optional — partial coverage is allowed
    const partial = defineRLSSchema<Database>({ users: { policies: [] } })
    expectTypeOf(partial).toEqualTypeOf<RLSSchema<Database>>()
  })

  it('rejects table names that are not part of the DB schema', () => {
    defineRLSSchema<Database>({
      // @ts-expect-error - 'accounts' is not a table in Database
      accounts: { policies: [] }
    })
  })

  it('constrains RLSSchema keys to keyof DB', () => {
    expectTypeOf<keyof RLSSchema<Database>>().toEqualTypeOf<'users' | 'posts'>()
  })
})

declare const base: RLSSchema<Database>
declare const overrides: RLSSchema<Database>

describe('mergeRLSSchemas (website/docs/plugins/rls.md — Composing schemas)', () => {
  it('preserves the DB generic across merged schemas', () => {
    expectTypeOf(mergeRLSSchemas(base, overrides)).toEqualTypeOf<RLSSchema<Database>>()
  })
})
