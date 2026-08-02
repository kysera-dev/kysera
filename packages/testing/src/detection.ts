/**
 * Smart test-database detection for multi-dialect test suites.
 *
 * Multi-db suites historically ran a dialect only when its `TEST_POSTGRES` /
 * `TEST_MYSQL` / `TEST_MSSQL` env var was the literal string `'true'`. This
 * module keeps that contract but adds a TCP probe fallback so suites light up
 * automatically when the docker test stack is running:
 *
 * 1. `TEST_<DIALECT>='true'`  → available, even if the probe would fail
 *    (`source: 'env-forced-on'`). CI service containers may still be warming
 *    up when the suite is collected; an explicit opt-in must stay an opt-in.
 * 2. `TEST_<DIALECT>` set to anything else → unavailable
 *    (`source: 'env-forced-off'`). This matches the historical `=== 'true'`
 *    check, where any other value kept the dialect off.
 * 3. Unset (or empty) → TCP probe of the dialect's host/port
 *    (`source: 'probe'`). Host and port come from `POSTGRES_HOST` /
 *    `POSTGRES_PORT` (with legacy `DB_PORT` honored for postgres),
 *    `MYSQL_HOST`/`MYSQL_PORT`, `MSSQL_HOST`/`MSSQL_PORT`, defaulting to
 *    `localhost:5432` / `localhost:3306` / `localhost:1433`. Suites whose
 *    stack lives elsewhere (e.g. @kysera/rls on 5433/3307) pass overrides;
 *    explicitly-set env vars always win over overrides.
 *
 * Results are cached per process (keyed by dialect + endpoint), and the first
 * `resolveTestDatabases()` call per process writes a one-line diagnostic to
 * stderr, e.g. `multi-db: postgres ✓(probe@localhost:5432) mysql ✗(env)`.
 *
 * The probe is deliberately more than a bare `connect()`: docker's userland
 * proxy accepts TCP connections on published ports even while the container's
 * service is still booting (and then resets them at once). After a successful
 * connect the probe therefore lingers briefly — an immediate close/error means
 * "port forwarded but nothing behind it" and counts as unavailable.
 *
 * Because probing auto-enables real-database suites under plain `pnpm test`
 * (which turbo runs with package-level parallelism), suites that talk to the
 * shared docker databases must serialize themselves: they drop and recreate
 * the same tables in the same `kysera_test` database. `acquireMultiDbLock()`
 * provides the cross-process mutex — acquire it in a file-level `beforeAll`
 * (generous timeout) and release it in `afterAll`.
 *
 * @module
 *
 * @example Gating a suite
 * ```typescript
 * const dbs = await resolveTestDatabases()
 *
 * let releaseLock: MultiDbLockRelease | undefined
 * beforeAll(async () => {
 *   if (dbs.postgres.available) releaseLock = await acquireMultiDbLock()
 * }, 660_000)
 * afterAll(() => { releaseLock?.() })
 *
 * describe.skipIf(!dbs.postgres.available)(
 *   `pg integration (${explainAvailability(dbs.postgres)})`,
 *   () => { ... }
 * )
 * ```
 */

import { createConnection } from 'node:net'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Server dialects the docker test stack can provide (sqlite needs no detection). */
export type TestDatabaseDialect = 'postgres' | 'mysql' | 'mssql'

/** Resolved availability of one test database. */
export interface TestDbAvailability {
  readonly dialect: TestDatabaseDialect
  readonly available: boolean
  /** How the decision was made — explicit env always wins over probing. */
  readonly source: 'env-forced-on' | 'env-forced-off' | 'probe'
  /** Endpoint the decision applies to (what a probe used or would have used). */
  readonly host: string
  readonly port: number
}

/** Per-dialect overrides for {@link detectTestDatabase}. Env vars still win. */
export interface DetectOptions {
  /** Probe host when the dialect's `*_HOST` env var is unset. Default `localhost`. */
  host?: string
  /** Probe port when the dialect's `*_PORT` env var is unset. Defaults 5432/3306/1433. */
  port?: number
  /** TCP probe budget in milliseconds. Default 300. */
  timeoutMs?: number
}

/** Availability of all three server dialects, as returned by {@link resolveTestDatabases}. */
export type TestDatabaseMatrix = Record<TestDatabaseDialect, TestDbAvailability>

interface DialectEnv {
  readonly flag: string
  readonly hostVar: string
  readonly portVar: string
  /** Older suites configured the postgres port via DB_PORT. */
  readonly legacyPortVar?: string
  readonly defaultPort: number
}

const DIALECT_ENV: Record<TestDatabaseDialect, DialectEnv> = {
  postgres: {
    flag: 'TEST_POSTGRES',
    hostVar: 'POSTGRES_HOST',
    portVar: 'POSTGRES_PORT',
    legacyPortVar: 'DB_PORT',
    defaultPort: 5432
  },
  mysql: { flag: 'TEST_MYSQL', hostVar: 'MYSQL_HOST', portVar: 'MYSQL_PORT', defaultPort: 3306 },
  mssql: { flag: 'TEST_MSSQL', hostVar: 'MSSQL_HOST', portVar: 'MSSQL_PORT', defaultPort: 1433 }
}

const DEFAULT_PROBE_TIMEOUT_MS = 300

/**
 * How long a successfully-connected probe socket is held open. Docker's
 * userland proxy accepts connections to published ports even when nothing is
 * listening inside the container yet, then closes them immediately — a close
 * within this window is treated as "not available".
 */
const CONNECTED_LINGER_MS = 150

/** `undefined` and `''` both mean "not configured". */
function envValue(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function envPort(name: string): number | undefined {
  const raw = envValue(name)
  if (raw === undefined) return undefined
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined
}

/**
 * Check whether a TCP endpoint accepts connections.
 *
 * Resolves `true` when the connection is established and survives a short
 * linger window (or the server sends data first, as MySQL does). Resolves
 * `false` on connection error, on timeout, or when the peer closes the
 * connection immediately after accepting it (docker proxy with a dead
 * backend). Never rejects.
 */
export async function probeTcp(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return await new Promise<boolean>(resolve => {
    const socket = createConnection({ host, port })
    let lingerTimer: NodeJS.Timeout | undefined
    let settled = false

    const settle = (result: boolean): void => {
      if (settled) return
      settled = true
      if (lingerTimer !== undefined) clearTimeout(lingerTimer)
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('timeout', () => {
      settle(false)
    })
    socket.once('error', () => {
      settle(false)
    })
    socket.once('close', () => {
      settle(false)
    })
    socket.once('data', () => {
      settle(true)
    })
    socket.once('connect', () => {
      socket.setTimeout(0)
      lingerTimer = setTimeout(
        () => {
          settle(true)
        },
        Math.min(CONNECTED_LINGER_MS, timeoutMs)
      )
    })
  })
}

/** Cache of in-flight/completed detections, keyed by dialect + endpoint. */
const detectionCache = new Map<string, Promise<TestDbAvailability>>()

const DIAG_PRINTED_KEY = Symbol.for('kysera.testing.multiDbDiagPrinted')

/**
 * Decide whether a test database is available for `dialect`.
 *
 * Resolution order: explicit `TEST_<DIALECT>` env var (both ways — see module
 * docs), else a TCP probe of the endpoint from env vars / `options` /
 * defaults. Results are cached per process; concurrent calls for the same
 * endpoint share one probe.
 */
export async function detectTestDatabase(
  dialect: TestDatabaseDialect,
  options: DetectOptions = {}
): Promise<TestDbAvailability> {
  const env = DIALECT_ENV[dialect]
  const host = envValue(env.hostVar) ?? options.host ?? 'localhost'
  const port =
    envPort(env.portVar) ??
    (env.legacyPortVar === undefined ? undefined : envPort(env.legacyPortVar)) ??
    options.port ??
    env.defaultPort

  const key = `${dialect}@${host}:${String(port)}`
  const cached = detectionCache.get(key)
  if (cached) return await cached

  const pending = resolveAvailability(dialect, host, port, options.timeoutMs)
  detectionCache.set(key, pending)
  return await pending
}

async function resolveAvailability(
  dialect: TestDatabaseDialect,
  host: string,
  port: number,
  timeoutMs: number | undefined
): Promise<TestDbAvailability> {
  const flagValue = envValue(DIALECT_ENV[dialect].flag)
  if (flagValue === 'true') {
    return { dialect, available: true, source: 'env-forced-on', host, port }
  }
  if (flagValue !== undefined) {
    return { dialect, available: false, source: 'env-forced-off', host, port }
  }
  const available = await probeTcp(host, port, timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS)
  return { dialect, available, source: 'probe', host, port }
}

/**
 * Resolve availability of all three server dialects in parallel.
 *
 * The first call per process writes a one-line summary to stderr so skipped
 * suites are explainable from the test log alone.
 */
export async function resolveTestDatabases(
  options: Partial<Record<TestDatabaseDialect, DetectOptions>> = {}
): Promise<TestDatabaseMatrix> {
  const [postgres, mysql, mssql] = await Promise.all([
    detectTestDatabase('postgres', options.postgres),
    detectTestDatabase('mysql', options.mysql),
    detectTestDatabase('mssql', options.mssql)
  ])
  printDiagnosticOnce([postgres, mysql, mssql])
  return { postgres, mysql, mssql }
}

function printDiagnosticOnce(entries: readonly TestDbAvailability[]): void {
  // Keyed on globalThis so the line prints once per worker process even
  // though vitest isolates module registries per test file.
  const marker = globalThis as Record<symbol, unknown>
  if (marker[DIAG_PRINTED_KEY] === true) return
  marker[DIAG_PRINTED_KEY] = true

  const parts = entries.map(entry => {
    const mark = entry.available ? '✓' : '✗'
    const via = entry.source === 'probe' ? `probe@${entry.host}:${String(entry.port)}` : 'env'
    return `${entry.dialect} ${mark}(${via})`
  })
  process.stderr.write(`multi-db: ${parts.join(' ')}\n`)
}

/**
 * Human-readable one-liner for skip messages and suite titles, e.g.
 * `postgres not reachable at localhost:5432 (start docker or set TEST_POSTGRES=true)`.
 */
export function explainAvailability(availability: TestDbAvailability): string {
  const { flag } = DIALECT_ENV[availability.dialect]
  switch (availability.source) {
    case 'env-forced-on':
      return `${availability.dialect} forced on via ${flag}=true`
    case 'env-forced-off':
      return `${availability.dialect} forced off via ${flag}`
    case 'probe':
      return availability.available
        ? `${availability.dialect} detected at ${availability.host}:${String(availability.port)}`
        : `${availability.dialect} not reachable at ${availability.host}:${String(availability.port)} (start docker or set ${flag}=true)`
  }
}

/**
 * Clear cached detection results and the diagnostic-printed marker.
 *
 * Detection reads env vars at call time but caches aggressively; call this
 * after mutating `TEST_*`/host/port env vars in tests. Not needed in suites.
 */
export function resetDetectionCache(): void {
  detectionCache.clear()
  const marker = globalThis as Record<symbol, unknown>
  marker[DIAG_PRINTED_KEY] = undefined
}

// ---------------------------------------------------------------------------
// Cross-process suite lock
// ---------------------------------------------------------------------------

/** Options for {@link acquireMultiDbLock}. Defaults suit the shared docker stack. */
export interface MultiDbLockOptions {
  /** Lock identity; suites sharing a database must share a name. Default `'default'`. */
  name?: string
  /** How long to wait for the lock before throwing. Default 600 000 ms. */
  timeoutMs?: number
  /** Poll interval while waiting. Default 250 ms. */
  pollIntervalMs?: number
  /**
   * Age after which a lock without a readable owner pid is considered
   * abandoned (owner crashed between creating the lock and recording its
   * pid). Locks whose recorded owner process is dead are reclaimed
   * immediately regardless of age. Default 30 000 ms.
   */
  staleMs?: number
}

/** Releases a held lock. Idempotent. */
export type MultiDbLockRelease = () => void

/**
 * Serialize suites that use the shared multi-db docker databases.
 *
 * The suites drop and recreate the same tables in the same database, so any
 * two of them running concurrently — parallel vitest files in one package, or
 * parallel packages under `turbo run test` — corrupt each other. This is a
 * file-based mutex in the OS temp directory: acquire it in a file-level
 * `beforeAll` (with a generous hook timeout — holders may legitimately run
 * for minutes) and release it in `afterAll`. Locks left behind by crashed
 * processes are detected via pid liveness and reclaimed.
 *
 * Skip it when only sqlite is in play: sqlite databases are per-process.
 */
export async function acquireMultiDbLock(
  options: MultiDbLockOptions = {}
): Promise<MultiDbLockRelease> {
  const name = options.name ?? 'default'
  const timeoutMs = options.timeoutMs ?? 600_000
  const pollIntervalMs = options.pollIntervalMs ?? 250
  const staleMs = options.staleMs ?? 30_000
  const lockDir = join(tmpdir(), `kysera-multidb-${name}.lock`)
  const deadline = Date.now() + timeoutMs

  for (;;) {
    if (tryAcquire(lockDir)) {
      let released = false
      return () => {
        if (released) return
        released = true
        rmSync(lockDir, { recursive: true, force: true })
      }
    }
    if (isLockStale(lockDir, staleMs)) {
      reclaimStaleLock(lockDir)
      continue
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${String(timeoutMs)}ms waiting for the multi-db test lock at ${lockDir}. ` +
          `If no other test run is active, remove the directory manually.`
      )
    }
    await sleep(pollIntervalMs)
  }
}

function tryAcquire(lockDir: string): boolean {
  try {
    mkdirSync(lockDir) // atomic: fails with EEXIST when someone else holds it
    writeFileSync(join(lockDir, 'pid'), String(process.pid))
    return true
  } catch {
    return false
  }
}

function isLockStale(lockDir: string, staleMs: number): boolean {
  try {
    const pid = Number(readFileSync(join(lockDir, 'pid'), 'utf8').trim())
    if (Number.isInteger(pid) && pid > 0) {
      return !isProcessAlive(pid)
    }
  } catch {
    // Unreadable pid — owner may have crashed right after mkdir; use age.
  }
  try {
    return Date.now() - statSync(lockDir).mtimeMs > staleMs
  } catch {
    return false // lock vanished; the next tryAcquire will race for it
  }
}

/**
 * Reclaim via rename-then-remove: rename is atomic, so when several waiters
 * spot the same stale lock only one wins and the losers never remove a lock
 * that a faster waiter has already re-acquired.
 */
function reclaimStaleLock(lockDir: string): void {
  const graveyard = `${lockDir}.stale-${String(process.pid)}-${String(Date.now())}`
  try {
    renameSync(lockDir, graveyard)
    rmSync(graveyard, { recursive: true, force: true })
  } catch {
    // Another waiter reclaimed it first.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: exists but owned by someone else. Anything else: gone.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, ms))
}
