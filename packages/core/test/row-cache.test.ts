/**
 * Unit tests for the shared per-operation row-fetch cache (P0.3).
 *
 * The integration proof (stacked rls+audit mutations issuing exactly one
 * pre-fetch SELECT) lives in @kysera/rls test/integration/shared-row-fetch —
 * these tests cover the cache primitives and scope semantics in isolation.
 */
import { describe, it, expect } from 'vitest'
import {
  createRowCache,
  fetchRowShared,
  fetchRowsSharedByIds,
  getOperationRowCache,
  withRowCacheScope,
  ROW_VISIBILITY_RAW,
  ROW_VISIBILITY_WITH_DELETED,
  type RowFetchExecutor
} from '../src/row-cache.js'

/**
 * Fake executor over an in-memory row set keyed by String(pk value).
 * Counts issued statements (both single and batched fetches count as one).
 */
function fakeExecutor(rows: Record<string, Record<string, unknown>>): {
  executor: RowFetchExecutor
  statements: () => number
} {
  let statements = 0
  const executor: RowFetchExecutor = {
    selectFrom: () => ({
      selectAll: () => ({
        where: (_column: string, operator: '=' | 'in', value: unknown) => ({
          executeTakeFirst: () => {
            statements++
            return Promise.resolve(rows[String(value)])
          },
          execute: () => {
            statements++
            const ids = operator === 'in' ? (value as unknown[]) : [value]
            return Promise.resolve(
              ids.map(id => rows[String(id)]).filter((r): r is Record<string, unknown> => !!r)
            )
          }
        })
      })
    })
  }
  return { executor, statements: () => statements }
}

describe('createRowCache', () => {
  it('memoizes fetches per (table, pk, id, visibility)', async () => {
    const { executor, statements } = fakeExecutor({ '1': { id: 1, name: 'a' } })
    const cache = createRowCache()

    const first = await cache.getRow(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)
    const second = await cache.getRow(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)

    expect(first).toEqual({ id: 1, name: 'a' })
    expect(second).toBe(first)
    expect(statements()).toBe(1)
  })

  it('does NOT share across visibility partitions', async () => {
    const { executor, statements } = fakeExecutor({ '1': { id: 1 } })
    const cache = createRowCache()

    await cache.getRow(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)
    await cache.getRow(executor, 'users', 'id', 1, ROW_VISIBILITY_WITH_DELETED)

    expect(statements()).toBe(2)
  })

  it('does NOT merge ids of different types (1 vs "1")', async () => {
    const { executor, statements } = fakeExecutor({ '1': { id: 1 } })
    const cache = createRowCache()

    await cache.getRow(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)
    await cache.getRow(executor, 'users', 'id', '1', ROW_VISIBILITY_RAW)

    expect(statements()).toBe(2)
  })

  it('single-flights concurrent fetches of the same key', async () => {
    const { executor, statements } = fakeExecutor({ '1': { id: 1 } })
    const cache = createRowCache()

    const [a, b] = await Promise.all([
      cache.getRow(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW),
      cache.getRow(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)
    ])

    expect(a).toBe(b)
    expect(statements()).toBe(1)
  })

  it('caches definite misses (undefined) but never rejections', async () => {
    let calls = 0
    const executor: RowFetchExecutor = {
      selectFrom: () => ({
        selectAll: () => ({
          where: () => ({
            executeTakeFirst: () => {
              calls++
              return calls === 1
                ? Promise.reject(new Error('transient'))
                : Promise.resolve(undefined)
            },
            execute: () => Promise.resolve([])
          })
        })
      })
    }
    const cache = createRowCache()

    await expect(cache.getRow(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)).rejects.toThrow(
      'transient'
    )
    // Rejection was evicted: the retry issues a fresh fetch...
    expect(await cache.getRow(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)).toBeUndefined()
    expect(calls).toBe(2)
    // ...and the miss IS memoized
    expect(await cache.getRow(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)).toBeUndefined()
    expect(calls).toBe(2)
  })

  it('prime/peek/clear', async () => {
    const { executor, statements } = fakeExecutor({})
    const cache = createRowCache()

    cache.prime('users', 'id', 7, { id: 7, name: 'primed' }, ROW_VISIBILITY_RAW)
    expect(await cache.peek('users', 'id', 7, ROW_VISIBILITY_RAW)).toEqual({
      id: 7,
      name: 'primed'
    })
    expect(await cache.getRow(executor, 'users', 'id', 7, ROW_VISIBILITY_RAW)).toEqual({
      id: 7,
      name: 'primed'
    })
    expect(statements()).toBe(0)

    cache.clear()
    expect(cache.peek('users', 'id', 7, ROW_VISIBILITY_RAW)).toBeUndefined()
  })
})

describe('withRowCacheScope', () => {
  it('establishes a scope, joins nested scopes, and tears down on settle', async () => {
    expect(getOperationRowCache()).toBeUndefined()

    await withRowCacheScope(async () => {
      const outer = getOperationRowCache()
      expect(outer).toBeDefined()

      await withRowCacheScope(async () => {
        // Nested wrapper of the SAME logical operation joins the scope
        expect(getOperationRowCache()).toBe(outer)
        return undefined
      })

      expect(getOperationRowCache()).toBe(outer)
      return undefined
    })

    expect(getOperationRowCache()).toBeUndefined()
  })

  it('tears down the scope on rejection too', async () => {
    await expect(
      withRowCacheScope(async () => {
        expect(getOperationRowCache()).toBeDefined()
        throw new Error('operation failed')
      })
    ).rejects.toThrow('operation failed')
    expect(getOperationRowCache()).toBeUndefined()
  })

  it('keeps concurrent scopes isolated', async () => {
    const { executor, statements } = fakeExecutor({ '1': { id: 1 } })

    await Promise.all([
      withRowCacheScope(async () => {
        await fetchRowShared(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)
        await fetchRowShared(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)
        return undefined
      }),
      withRowCacheScope(async () => {
        await fetchRowShared(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)
        return undefined
      })
    ])

    // Each scope fetched once; sharing across scopes would have given 1
    expect(statements()).toBe(2)
  })
})

describe('fetchRowShared', () => {
  it('without a scope: plain direct fetch, no memoization', async () => {
    const { executor, statements } = fakeExecutor({ '1': { id: 1 } })

    await fetchRowShared(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)
    await fetchRowShared(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)

    expect(statements()).toBe(2)
  })

  it('inside a scope: second consumer reuses the first fetch', async () => {
    const { executor, statements } = fakeExecutor({ '1': { id: 1, name: 'shared' } })

    await withRowCacheScope(async () => {
      const first = await fetchRowShared(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)
      const second = await fetchRowShared(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)
      expect(second).toBe(first)
      return undefined
    })

    expect(statements()).toBe(1)
  })
})

describe('fetchRowsSharedByIds', () => {
  it('batches missing ids in one statement and primes results (misses included)', async () => {
    const { executor, statements } = fakeExecutor({
      '1': { id: 1, name: 'a' },
      '2': { id: 2, name: 'b' }
    })

    await withRowCacheScope(async () => {
      const rows = await fetchRowsSharedByIds(
        executor,
        'users',
        'id',
        [1, 2, 999],
        ROW_VISIBILITY_RAW
      )
      expect(rows.get(1)).toEqual({ id: 1, name: 'a' })
      expect(rows.get(999)).toBeUndefined()
      expect(statements()).toBe(1)

      // Found rows AND definite misses were primed: later single-row
      // consumers of the same operation issue no further statements
      expect(await fetchRowShared(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)).toEqual({
        id: 1,
        name: 'a'
      })
      expect(
        await fetchRowShared(executor, 'users', 'id', 999, ROW_VISIBILITY_RAW)
      ).toBeUndefined()
      expect(statements()).toBe(1)
      return undefined
    })
  })

  it('serves already-cached ids without refetching and dedupes duplicates', async () => {
    const { executor, statements } = fakeExecutor({
      '1': { id: 1 },
      '2': { id: 2 }
    })

    await withRowCacheScope(async () => {
      await fetchRowShared(executor, 'users', 'id', 1, ROW_VISIBILITY_RAW)
      expect(statements()).toBe(1)

      const rows = await fetchRowsSharedByIds(
        executor,
        'users',
        'id',
        [1, 2, 2, 1],
        ROW_VISIBILITY_RAW
      )
      expect(rows.size).toBe(2)
      // id 1 came from the cache; only id 2 (deduped) hit the database
      expect(statements()).toBe(2)
      return undefined
    })
  })

  it('matches rows when driver pk type differs from requested id type', async () => {
    // Driver returns numeric pks; caller passes string ids
    const { executor } = fakeExecutor({ '5': { id: 5, name: 'typed' } })

    const rows = await fetchRowsSharedByIds(executor, 'users', 'id', ['5'], ROW_VISIBILITY_RAW)
    expect(rows.get('5')).toEqual({ id: 5, name: 'typed' })
  })

  it('returns an empty map for an empty id list without querying', async () => {
    const { executor, statements } = fakeExecutor({})
    const rows = await fetchRowsSharedByIds(executor, 'users', 'id', [], ROW_VISIBILITY_RAW)
    expect(rows.size).toBe(0)
    expect(statements()).toBe(0)
  })
})
