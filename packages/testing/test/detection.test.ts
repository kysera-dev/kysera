import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer, type Server } from 'node:net'
import { mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  probeTcp,
  detectTestDatabase,
  resolveTestDatabases,
  explainAvailability,
  resetDetectionCache,
  acquireMultiDbLock
} from '../src/detection.js'

/** Env vars the module reads — snapshotted and cleared around every test. */
const ENV_KEYS = [
  'TEST_POSTGRES',
  'TEST_MYSQL',
  'TEST_MSSQL',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'DB_PORT',
  'MYSQL_HOST',
  'MYSQL_PORT',
  'MSSQL_HOST',
  'MSSQL_PORT'
] as const

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  resetDetectionCache()
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  resetDetectionCache()
  vi.restoreAllMocks()
})

interface TestServer {
  server: Server
  port: number
  connections: () => number
  close: () => Promise<void>
}

/**
 * Start a local TCP server. `behavior`:
 * - 'silent': accept and hold the connection open (postgres-like)
 * - 'greet': immediately send bytes (mysql-like)
 * - 'reset': immediately destroy the connection (docker proxy with dead backend)
 */
async function startServer(behavior: 'silent' | 'greet' | 'reset' = 'silent'): Promise<TestServer> {
  let connections = 0
  const server = createServer(socket => {
    connections++
    socket.on('error', () => {})
    if (behavior === 'greet') socket.write('hello')
    if (behavior === 'reset') socket.destroy()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no server address')
  return {
    server,
    port: address.port,
    connections: () => connections,
    close: async () => {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }
}

/** A port that was just released — connecting to it is refused. */
async function closedPort(): Promise<number> {
  const { port, close } = await startServer()
  await close()
  return port
}

describe('probeTcp', () => {
  it('returns true for a listening (silent) server', async () => {
    const srv = await startServer('silent')
    try {
      await expect(probeTcp('127.0.0.1', srv.port)).resolves.toBe(true)
    } finally {
      await srv.close()
    }
  })

  it('returns true fast when the server greets first (mysql-style)', async () => {
    const srv = await startServer('greet')
    try {
      const started = Date.now()
      await expect(probeTcp('127.0.0.1', srv.port)).resolves.toBe(true)
      // greeting short-circuits the linger window
      expect(Date.now() - started).toBeLessThan(140)
    } finally {
      await srv.close()
    }
  })

  it('returns false for a closed port', async () => {
    const port = await closedPort()
    await expect(probeTcp('127.0.0.1', port)).resolves.toBe(false)
  })

  it('returns false when the peer accepts then immediately resets (docker proxy)', async () => {
    const srv = await startServer('reset')
    try {
      await expect(probeTcp('127.0.0.1', srv.port)).resolves.toBe(false)
    } finally {
      await srv.close()
    }
  })

  it('returns false on connect timeout without hanging', async () => {
    // TEST-NET-1 (RFC 5737): guaranteed unassigned; either blackholes (timeout)
    // or is rejected by the local network stack — false both ways.
    const started = Date.now()
    await expect(probeTcp('192.0.2.1', 81, 150)).resolves.toBe(false)
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})

describe('detectTestDatabase', () => {
  it('env-forced-on wins even when nothing is listening', async () => {
    process.env['TEST_POSTGRES'] = 'true'
    process.env['POSTGRES_PORT'] = String(await closedPort())
    const result = await detectTestDatabase('postgres')
    expect(result).toMatchObject({
      dialect: 'postgres',
      available: true,
      source: 'env-forced-on',
      host: 'localhost'
    })
  })

  it('env-forced-off wins even when a server is listening', async () => {
    const srv = await startServer()
    try {
      process.env['TEST_MYSQL'] = 'false'
      process.env['MYSQL_HOST'] = '127.0.0.1'
      process.env['MYSQL_PORT'] = String(srv.port)
      const result = await detectTestDatabase('mysql')
      expect(result.available).toBe(false)
      expect(result.source).toBe('env-forced-off')
      expect(srv.connections()).toBe(0)
    } finally {
      await srv.close()
    }
  })

  it('treats any non-true value as forced off (historical parity)', async () => {
    process.env['TEST_MSSQL'] = '1'
    const result = await detectTestDatabase('mssql')
    expect(result.available).toBe(false)
    expect(result.source).toBe('env-forced-off')
  })

  it('treats an empty flag as unset and probes', async () => {
    process.env['TEST_POSTGRES'] = ''
    process.env['POSTGRES_HOST'] = '127.0.0.1'
    process.env['POSTGRES_PORT'] = String(await closedPort())
    const result = await detectTestDatabase('postgres')
    expect(result.source).toBe('probe')
    expect(result.available).toBe(false)
  })

  it('probes the endpoint from env vars and reports success', async () => {
    const srv = await startServer()
    try {
      process.env['POSTGRES_HOST'] = '127.0.0.1'
      process.env['POSTGRES_PORT'] = String(srv.port)
      const result = await detectTestDatabase('postgres')
      expect(result).toEqual({
        dialect: 'postgres',
        available: true,
        source: 'probe',
        host: '127.0.0.1',
        port: srv.port
      })
    } finally {
      await srv.close()
    }
  })

  it('honors legacy DB_PORT for postgres when POSTGRES_PORT is unset', async () => {
    const srv = await startServer()
    try {
      process.env['POSTGRES_HOST'] = '127.0.0.1'
      process.env['DB_PORT'] = String(srv.port)
      const result = await detectTestDatabase('postgres')
      expect(result.available).toBe(true)
      expect(result.port).toBe(srv.port)
    } finally {
      await srv.close()
    }
  })

  it('uses option overrides when env is unset, but env wins over options', async () => {
    const srv = await startServer()
    try {
      const viaOptions = await detectTestDatabase('mysql', { host: '127.0.0.1', port: srv.port })
      expect(viaOptions.available).toBe(true)
      expect(viaOptions.port).toBe(srv.port)

      resetDetectionCache()
      const envPort = await closedPort()
      process.env['MYSQL_HOST'] = '127.0.0.1'
      process.env['MYSQL_PORT'] = String(envPort)
      const viaEnv = await detectTestDatabase('mysql', { host: '127.0.0.1', port: srv.port })
      expect(viaEnv.port).toBe(envPort)
      expect(viaEnv.available).toBe(false)
    } finally {
      await srv.close()
    }
  })

  it('ignores an unparsable port env var and falls back to defaults', async () => {
    process.env['MSSQL_PORT'] = 'not-a-port'
    const port = await closedPort()
    const result = await detectTestDatabase('mssql', { host: '127.0.0.1', port })
    expect(result.port).toBe(port)
  })

  it('caches per endpoint: repeated and concurrent calls share one probe', async () => {
    const srv = await startServer()
    try {
      process.env['MYSQL_HOST'] = '127.0.0.1'
      process.env['MYSQL_PORT'] = String(srv.port)
      const [first, second] = await Promise.all([
        detectTestDatabase('mysql'),
        detectTestDatabase('mysql')
      ])
      const third = await detectTestDatabase('mysql')
      expect(first.available).toBe(true)
      expect(second.available).toBe(true)
      expect(third.available).toBe(true)
      expect(srv.connections()).toBe(1)

      resetDetectionCache()
      await detectTestDatabase('mysql')
      expect(srv.connections()).toBe(2)
    } finally {
      await srv.close()
    }
  })
})

describe('resolveTestDatabases', () => {
  it('resolves all three dialects and prints the diagnostic line once', async () => {
    process.env['TEST_POSTGRES'] = 'true'
    process.env['TEST_MYSQL'] = 'false'
    process.env['TEST_MSSQL'] = 'nope'
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const dbs = await resolveTestDatabases()
    expect(dbs.postgres.available).toBe(true)
    expect(dbs.postgres.source).toBe('env-forced-on')
    expect(dbs.mysql.available).toBe(false)
    expect(dbs.mssql.available).toBe(false)

    const diagLines = write.mock.calls.filter(call => String(call[0]).startsWith('multi-db:'))
    expect(diagLines).toHaveLength(1)
    expect(String(diagLines[0]?.[0])).toContain('postgres ✓(env)')
    expect(String(diagLines[0]?.[0])).toContain('mysql ✗(env)')

    await resolveTestDatabases()
    const after = write.mock.calls.filter(call => String(call[0]).startsWith('multi-db:'))
    expect(after).toHaveLength(1)
  })

  it('routes per-dialect options (custom stacks like rls on 5433)', async () => {
    process.env['TEST_POSTGRES'] = 'true'
    process.env['TEST_MSSQL'] = 'false'
    const srv = await startServer()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const dbs = await resolveTestDatabases({ mysql: { host: '127.0.0.1', port: srv.port } })
      expect(dbs.mysql.available).toBe(true)
      expect(dbs.mysql.port).toBe(srv.port)
    } finally {
      await srv.close()
    }
  })
})

describe('explainAvailability', () => {
  it('names the flag and endpoint for every source', async () => {
    process.env['TEST_POSTGRES'] = 'true'
    const forcedOn = await detectTestDatabase('postgres')
    expect(explainAvailability(forcedOn)).toBe('postgres forced on via TEST_POSTGRES=true')

    process.env['TEST_MYSQL'] = 'false'
    const forcedOff = await detectTestDatabase('mysql')
    expect(explainAvailability(forcedOff)).toBe('mysql forced off via TEST_MYSQL')

    const port = await closedPort()
    const probed = await detectTestDatabase('mssql', { host: '127.0.0.1', port })
    expect(explainAvailability(probed)).toBe(
      `mssql not reachable at 127.0.0.1:${port} (start docker or set TEST_MSSQL=true)`
    )

    const srv = await startServer()
    try {
      resetDetectionCache()
      const up = await detectTestDatabase('mssql', { host: '127.0.0.1', port: srv.port })
      expect(explainAvailability(up)).toBe(`mssql detected at 127.0.0.1:${srv.port}`)
    } finally {
      await srv.close()
    }
  })
})

describe('acquireMultiDbLock', () => {
  const lockName = (suffix: string): string => `vitest-${process.pid}-${suffix}`
  const lockPath = (name: string): string => join(tmpdir(), `kysera-multidb-${name}.lock`)

  it('acquires, releases, and can re-acquire', async () => {
    const name = lockName('basic')
    const release = await acquireMultiDbLock({ name })
    expect(existsSync(lockPath(name))).toBe(true)
    release()
    expect(existsSync(lockPath(name))).toBe(false)
    const again = await acquireMultiDbLock({ name })
    again()
  })

  it('is mutually exclusive until released', async () => {
    const name = lockName('mutex')
    const first = await acquireMultiDbLock({ name })
    let secondHeld = false
    const secondPending = acquireMultiDbLock({ name, pollIntervalMs: 25 }).then(release => {
      secondHeld = true
      return release
    })
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(secondHeld).toBe(false)
    first()
    const second = await secondPending
    expect(secondHeld).toBe(true)
    second()
  })

  it('times out with a descriptive error when the lock stays held', async () => {
    const name = lockName('timeout')
    const release = await acquireMultiDbLock({ name })
    try {
      await expect(
        acquireMultiDbLock({ name, timeoutMs: 200, pollIntervalMs: 25 })
      ).rejects.toThrow(/multi-db test lock/)
    } finally {
      release()
    }
  })

  it('reclaims a lock whose owner process is dead', async () => {
    const name = lockName('stale-pid')
    const dir = lockPath(name)
    mkdirSync(dir)
    // pid far outside any plausible live range on the test host
    writeFileSync(join(dir, 'pid'), '999999999')
    const release = await acquireMultiDbLock({ name, timeoutMs: 5_000, pollIntervalMs: 25 })
    release()
  })

  it('reclaims an aged lock without a pid file via staleMs', async () => {
    const name = lockName('stale-age')
    const dir = lockPath(name)
    mkdirSync(dir)
    const past = new Date(Date.now() - 60_000)
    utimesSync(dir, past, past)
    const release = await acquireMultiDbLock({
      name,
      staleMs: 1_000,
      timeoutMs: 5_000,
      pollIntervalMs: 25
    })
    release()
  })

  it('does not reclaim a fresh pid-less lock before staleMs', async () => {
    const name = lockName('fresh')
    const dir = lockPath(name)
    mkdirSync(dir)
    try {
      await expect(
        acquireMultiDbLock({ name, staleMs: 60_000, timeoutMs: 150, pollIntervalMs: 25 })
      ).rejects.toThrow(/Timed out/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('release is idempotent', async () => {
    const name = lockName('idempotent')
    const release = await acquireMultiDbLock({ name })
    release()
    expect(() => {
      release()
    }).not.toThrow()
  })
})
