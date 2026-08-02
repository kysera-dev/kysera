/**
 * Whole-transaction retry for serialization failures and deadlocks.
 *
 * Under SERIALIZABLE (and sometimes REPEATABLE READ) isolation, databases
 * abort one of two conflicting transactions and expect the APPLICATION to
 * re-run it. Statement-level retry is not enough — the whole callback must
 * execute again in a fresh transaction so it re-reads current data.
 *
 * @module @kysera/infra/resilience
 */

import { withRetry, type RetryOptions } from './retry.js'

/**
 * PostgreSQL SQLSTATE codes that signal "re-run the transaction":
 * 40001 serialization_failure, 40P01 deadlock_detected.
 * @internal
 */
const PG_SERIALIZATION_CODES = new Set(['40001', '40P01'])

/**
 * MySQL driver error codes (mysql2 sets `code` to the symbolic name and
 * `errno` to the numeric code): 1213 ER_LOCK_DEADLOCK, 1205 ER_LOCK_WAIT_TIMEOUT.
 * @internal
 */
const MYSQL_SERIALIZATION_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'])

/** @internal */
const MYSQL_SERIALIZATION_ERRNOS = new Set([1213, 1205])

/**
 * MSSQL error numbers (tedious sets `number`): 1205 deadlock victim.
 * @internal
 */
const MSSQL_SERIALIZATION_NUMBERS = new Set([1205])

/**
 * Check one error object (without following `cause`) for serialization codes.
 * @internal
 */
function matchesSerializationCode(error: object): boolean {
  const { code, errno, number } = error as {
    code?: unknown
    errno?: unknown
    number?: unknown
  }

  if (typeof code === 'string') {
    if (PG_SERIALIZATION_CODES.has(code)) return true
    if (MYSQL_SERIALIZATION_CODES.has(code)) return true
    // better-sqlite3: SQLITE_BUSY plus variants (SQLITE_BUSY_SNAPSHOT, ...)
    if (code.startsWith('SQLITE_BUSY')) return true
  }
  if (typeof errno === 'number' && MYSQL_SERIALIZATION_ERRNOS.has(errno)) return true
  if (typeof number === 'number' && MSSQL_SERIALIZATION_NUMBERS.has(number)) return true

  return false
}

/**
 * Check if an error means the transaction lost a concurrency race and can be
 * safely re-run: serialization failures and deadlocks.
 *
 * Recognized codes:
 * - PostgreSQL: `40001` (serialization_failure), `40P01` (deadlock_detected)
 * - MySQL: `ER_LOCK_DEADLOCK`/1213, `ER_LOCK_WAIT_TIMEOUT`/1205
 * - MSSQL: error number 1205 (deadlock victim)
 * - SQLite: `SQLITE_BUSY` (including `SQLITE_BUSY_*` variants)
 *
 * The `cause` chain is followed (up to 5 levels) so wrapped driver errors
 * are still recognized.
 *
 * Narrower than {@link isTransientError}: connection failures are NOT
 * included — a dropped connection mid-transaction may have committed, so
 * re-running it is not automatically safe.
 *
 * @param error - Error to check
 * @returns True if the transaction can be safely re-run
 */
export function isSerializationError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5; depth++) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return false
    }
    if (matchesSerializationCode(current)) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * Anything that can start transactions: `Kysely<DB>`, a Kysera
 * `KyseraExecutor<DB>` (its wrapped builder has the same `execute` shape,
 * so plugins stay active inside every attempt), or a `Transaction`-capable
 * test double.
 *
 * `TRX` is the transaction handle passed to the callback —
 * `Transaction<DB>` for both Kysely and KyseraExecutor.
 */
export interface RetryableTransactionSource<TRX> {
  transaction(): {
    execute<T>(callback: (trx: TRX) => Promise<T>): Promise<T>
  }
}

/**
 * Options for {@link withTransactionRetry}.
 *
 * Same shape as {@link RetryOptions} with transaction-appropriate defaults:
 * `shouldRetry` defaults to {@link isSerializationError} (NOT
 * `isTransientError`), `delayMs` to 100 and `maxDelayMs` to 2000 — conflict
 * retries should be quick, not multi-second.
 */
export type TransactionRetryOptions = RetryOptions

/**
 * Run a transaction callback, retrying the WHOLE callback in a FRESH
 * transaction when it fails with a serialization/deadlock error.
 *
 * Each attempt calls `db.transaction().execute(fn)` again, so the previous
 * attempt is fully rolled back before the next begins. Backoff and jitter
 * come from the same helpers as {@link withRetry}; `maxAttempts` defaults
 * to 3 and the `onRetry` hook fires between attempts.
 *
 * The callback MUST be safe to re-run: keep side effects (queue publishes,
 * HTTP calls, ...) outside of it, or make them idempotent.
 *
 * @param db - Kysely instance or KyseraExecutor (plugins stay active)
 * @param fn - Transaction callback; receives a fresh transaction per attempt
 * @param options - Retry configuration
 * @returns Result of the first successful attempt
 * @throws The last error when attempts are exhausted or the error is not retryable
 *
 * @example Serializable transfer with retry
 * ```typescript
 * import { withTransactionRetry } from '@kysera/infra/resilience';
 *
 * const receipt = await withTransactionRetry(db, async (trx) => {
 *   const from = await trx.selectFrom('accounts')
 *     .where('id', '=', fromId).select('balance').executeTakeFirstOrThrow();
 *   if (from.balance < amount) throw new Error('insufficient funds');
 *   await trx.updateTable('accounts').where('id', '=', fromId)
 *     .set(eb => ({ balance: eb('balance', '-', amount) })).execute();
 *   await trx.updateTable('accounts').where('id', '=', toId)
 *     .set(eb => ({ balance: eb('balance', '+', amount) })).execute();
 *   return { fromId, toId, amount };
 * }, { maxAttempts: 5, onRetry: (attempt) => metrics.count('txn_retry') });
 * ```
 */
export async function withTransactionRetry<TRX, T>(
  db: RetryableTransactionSource<TRX>,
  fn: (trx: TRX) => Promise<T>,
  options: TransactionRetryOptions = {}
): Promise<T> {
  const delayMs = options.delayMs ?? 100
  const maxDelayMs = options.maxDelayMs ?? Math.max(2000, delayMs)
  const shouldRetry = options.shouldRetry ?? isSerializationError

  return await withRetry(() => db.transaction().execute(fn), {
    ...options,
    delayMs,
    maxDelayMs,
    shouldRetry
  })
}
