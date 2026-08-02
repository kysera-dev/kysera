/**
 * Tests for whole-transaction retry (withTransactionRetry / isSerializationError).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, expectTypeOf, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import {
  Kysely,
  SqliteDialect,
  type Generated,
  type IsolationLevel,
  type Transaction
} from 'kysely'
import {
  isSerializationError,
  withTransactionRetry,
  type RetryableTransactionSource
} from '../src/resilience/index.js'

/** Error factory: plain Error with driver-style properties attached */
function driverError(props: Record<string, unknown>, message = 'boom'): Error {
  return Object.assign(new Error(message), props)
}

/**
 * Transaction-capable fake: fails the first `failures` transactions with
 * `makeError()`, then delegates to the callback. Counts transaction() calls
 * to prove a FRESH transaction is started per attempt.
 */
function createFlakyDb(failures: number, makeError: () => unknown) {
  const trxToken = { kind: 'fake-trx' }
  let transactionCalls = 0
  const db: RetryableTransactionSource<typeof trxToken> = {
    transaction: () => {
      transactionCalls++
      const attempt = transactionCalls
      return {
        execute: async <T,>(callback: (trx: typeof trxToken) => Promise<T>): Promise<T> => {
          if (attempt <= failures) {
            throw makeError()
          }
          return await callback(trxToken)
        }
      }
    }
  }
  return { db, trxToken, transactionCalls: () => transactionCalls }
}

const RETRYABLE_CASES: [Record<string, unknown>, string][] = [
  [{ code: '40001' }, 'pg serialization_failure'],
  [{ code: '40P01' }, 'pg deadlock_detected'],
  [{ code: 'ER_LOCK_DEADLOCK' }, 'mysql deadlock (symbolic)'],
  [{ code: 'ER_LOCK_WAIT_TIMEOUT' }, 'mysql lock wait timeout (symbolic)'],
  [{ errno: 1213 }, 'mysql deadlock (errno)'],
  [{ errno: 1205 }, 'mysql lock wait timeout (errno)'],
  [{ number: 1205 }, 'mssql deadlock victim'],
  [{ code: 'SQLITE_BUSY' }, 'sqlite busy'],
  [{ code: 'SQLITE_BUSY_SNAPSHOT' }, 'sqlite busy variant']
]

const NON_RETRYABLE_CASES: [Record<string, unknown>, string][] = [
  [{}, 'no code at all'],
  [{ code: '23505' }, 'unique violation is not retryable'],
  [{ code: 'ECONNRESET' }, 'connection errors are NOT safe to re-run'],
  [{ errno: 1062 }, 'mysql duplicate entry'],
  [{ number: 547 }, 'mssql constraint violation'],
  [{ code: 40001 }, 'numeric pg-style code is not how drivers report it']
]

describe('isSerializationError', () => {
  it.each(RETRYABLE_CASES)('recognizes %o (%s)', props => {
    expect(isSerializationError(driverError(props))).toBe(true)
  })

  it.each([[null], [undefined], ['SQLITE_BUSY'], [42]])('rejects non-object %o', value => {
    expect(isSerializationError(value)).toBe(false)
  })

  it.each(NON_RETRYABLE_CASES)('rejects %o (%s)', props => {
    expect(isSerializationError(driverError(props))).toBe(false)
  })

  it('follows the cause chain of wrapped errors', () => {
    const wrapped = new Error('repo failed', { cause: driverError({ code: '40001' }) })
    const doubleWrapped = new Error('service failed', { cause: wrapped })
    expect(isSerializationError(wrapped)).toBe(true)
    expect(isSerializationError(doubleWrapped)).toBe(true)
  })

  it('stops following causes after 5 levels', () => {
    let error: unknown = driverError({ code: '40001' })
    for (let i = 0; i < 6; i++) {
      error = new Error(`layer ${String(i)}`, { cause: error })
    }
    expect(isSerializationError(error)).toBe(false)
  })
})

describe('withTransactionRetry', () => {
  it('retries the whole callback in a fresh transaction and succeeds', async () => {
    const { db, trxToken, transactionCalls } = createFlakyDb(2, () =>
      driverError({ code: '40001' })
    )
    const seenTrx: unknown[] = []
    const retries: [number, unknown][] = []

    const result = await withTransactionRetry(
      db,
      async trx => {
        seenTrx.push(trx)
        return 'committed'
      },
      { delayMs: 1, onRetry: (attempt, error) => retries.push([attempt, error]) }
    )

    expect(result).toBe('committed')
    // three transaction() calls → each attempt began a fresh transaction
    expect(transactionCalls()).toBe(3)
    // callback only ran in the successful attempt
    expect(seenTrx).toEqual([trxToken])
    expect(retries.map(([attempt]) => attempt)).toEqual([1, 2])
    expect(retries.every(([, error]) => isSerializationError(error))).toBe(true)
  })

  it('does not retry non-serialization errors', async () => {
    const { db, transactionCalls } = createFlakyDb(1, () => driverError({ code: '23505' }))

    await expect(
      withTransactionRetry(db, async () => 'unreachable', { delayMs: 1 })
    ).rejects.toMatchObject({ code: '23505' })
    expect(transactionCalls()).toBe(1)
  })

  it('gives up after maxAttempts and rethrows the last error', async () => {
    const { db, transactionCalls } = createFlakyDb(99, () => driverError({ number: 1205 }))

    await expect(
      withTransactionRetry(db, async () => 'unreachable', { maxAttempts: 3, delayMs: 1 })
    ).rejects.toMatchObject({ number: 1205 })
    expect(transactionCalls()).toBe(3)
  })

  it('retries errors whose cause is a serialization failure', async () => {
    const { db, transactionCalls } = createFlakyDb(1, () =>
      new Error('wrapped by repository', { cause: driverError({ errno: 1213 }) })
    )

    const result = await withTransactionRetry(db, async () => 'ok', { delayMs: 1 })
    expect(result).toBe('ok')
    expect(transactionCalls()).toBe(2)
  })

  it('honors a custom shouldRetry predicate', async () => {
    const { db, transactionCalls } = createFlakyDb(1, () => driverError({ code: 'CUSTOM' }))

    const result = await withTransactionRetry(db, async () => 'ok', {
      delayMs: 1,
      shouldRetry: error => (error as { code?: string }).code === 'CUSTOM'
    })
    expect(result).toBe('ok')
    expect(transactionCalls()).toBe(2)
  })

  it('accepts delayMs above the default maxDelayMs without exploding', async () => {
    const { db } = createFlakyDb(0, () => new Error('unused'))
    // delayMs 3000 > default maxDelayMs 2000 — the cap must auto-raise
    const result = await withTransactionRetry(db, async () => 'ok', { delayMs: 3000 })
    expect(result).toBe('ok')
  })
})

describe('withTransactionRetry against real SQLITE_BUSY', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kysera-infra-busy-'))
  const file = join(dir, 'busy.db')

  interface BusyDB {
    busy_probe: { id: Generated<number>; marker: string }
  }

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('recovers once a competing writer commits', async () => {
    const writerA = new Database(file)
    writerA.exec('CREATE TABLE busy_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, marker TEXT NOT NULL)')

    // timeout 0: no busy-wait — a locked database throws SQLITE_BUSY immediately
    const rawB = new Database(file, { timeout: 0 })
    const dbB = new Kysely<BusyDB>({ dialect: new SqliteDialect({ database: rawB }) })

    // Writer A takes the write lock and sits on it
    writerA.exec('BEGIN IMMEDIATE')

    const attempts: number[] = []
    try {
      const result = await withTransactionRetry(
        dbB,
        async trx => {
          await trx.insertInto('busy_probe').values({ marker: 'retried' }).execute()
          return 'inserted'
        },
        {
          maxAttempts: 5,
          delayMs: 5,
          onRetry: (attempt, error) => {
            attempts.push(attempt)
            expect(isSerializationError(error)).toBe(true)
            if (attempt === 2) {
              writerA.exec('COMMIT') // release the lock after the second failure
            }
          }
        }
      )

      expect(result).toBe('inserted')
      expect(attempts.length).toBeGreaterThanOrEqual(2)

      const rows = await dbB.selectFrom('busy_probe').selectAll().execute()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.marker).toBe('retried')
    } finally {
      await dbB.destroy()
      writerA.close()
    }
  })
})

describe('withTransactionRetry type inference', () => {
  interface TestDB {
    users: { id: Generated<number>; name: string }
  }

  /**
   * Structural mirror of @kysera/executor's KyseraExecutor transaction
   * surface (WrappedTransactionBuilder). Compiling against it proves the
   * executor satisfies RetryableTransactionSource without a dependency.
   */
  interface WrappedTransactionBuilderLike<DB> {
    setAccessMode(mode: 'read only' | 'read write'): WrappedTransactionBuilderLike<DB>
    setIsolationLevel(level: IsolationLevel): WrappedTransactionBuilderLike<DB>
    execute<T>(callback: (trx: Transaction<DB>) => Promise<T>): Promise<T>
  }
  interface KyseraExecutorLike<DB> {
    transaction(): WrappedTransactionBuilderLike<DB>
  }

  it('infers Transaction<DB> and the result type for Kysely and KyseraExecutor shapes', () => {
    const typeProbe = async (
      kysely: Kysely<TestDB>,
      executor: KyseraExecutorLike<TestDB>
    ): Promise<void> => {
      const count = await withTransactionRetry(kysely, async trx => {
        expectTypeOf(trx).toEqualTypeOf<Transaction<TestDB>>()
        return 42
      })
      expectTypeOf(count).toEqualTypeOf<number>()

      const label = await withTransactionRetry(executor, async trx => {
        expectTypeOf(trx).toEqualTypeOf<Transaction<TestDB>>()
        return 'ok' as const
      })
      expectTypeOf(label).toEqualTypeOf<'ok'>()
    }

    // Never executed — the assertions above are compile-time only
    expect(typeof typeProbe).toBe('function')
  })
})
