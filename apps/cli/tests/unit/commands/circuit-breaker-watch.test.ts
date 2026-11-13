import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { circuitBreakerCommand } from '@/commands/debug/circuit-breaker.js'
import { loadConfig } from '@/config/loader.js'
import { getDatabaseConnection } from '@/utils/database.js'
import { displayTable } from '@/utils/table-helper.js'
import { resetOutput } from '@/utils/output.js'

vi.mock('@/config/loader.js', () => ({ loadConfig: vi.fn() }))
vi.mock('@/utils/database.js', () => ({ getDatabaseConnection: vi.fn() }))
vi.mock('@/utils/table-helper.js', () => ({ displayTable: vi.fn() }))

const originalTTY = [process.stdin.isTTY, process.stdout.isTTY]
let originalInt: ReturnType<typeof process.listeners>
let originalTerm: ReturnType<typeof process.listeners>
let destroyed: number
let active: number
let largest: number
let calls: number
function stop(signal: 'SIGINT' | 'SIGTERM' = 'SIGTERM'): void {
  for (const listener of process.listeners(signal)) {
    if (!(signal === 'SIGINT' ? originalInt : originalTerm).includes(listener)) listener(signal)
  }
}
function observe(execute: () => Promise<unknown[]>): void {
  vi.mocked(getDatabaseConnection).mockImplementation(async () => {
    calls++
    active++
    largest = Math.max(largest, active)
    return {
      introspection: { getTables: async () => [{ name: 'circuit_breaker_state' }] },
      selectFrom: () => ({ selectAll: () => ({ execute }) }),
      destroy: async () => {
        active--
        destroyed++
      }
    } as unknown as Awaited<ReturnType<typeof getDatabaseConnection>>
  })
}
function row(state: string) {
  return {
    service: 'api',
    state,
    failure_count: 0,
    success_count: 2,
    error_threshold: 3,
    reset_timeout: 1000
  }
}
function run(args: string[] = []) {
  return circuitBreakerCommand()
    .exitOverride()
    .parseAsync(['--watch', '--service', 'api', '--config', 'chosen.json', ...args], {
      from: 'user'
    })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetOutput()
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
  originalInt = process.listeners('SIGINT')
  originalTerm = process.listeners('SIGTERM')
  destroyed = active = largest = calls = 0
  vi.mocked(loadConfig).mockResolvedValue({
    database: { dialect: 'sqlite', database: '/test-only/chosen.db' }
  } as Awaited<ReturnType<typeof loadConfig>>)
  vi.spyOn(console, 'clear').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  stop()
  expect(process.listeners('SIGINT')).toEqual(originalInt)
  expect(process.listeners('SIGTERM')).toEqual(originalTerm)
  Object.defineProperty(process.stdin, 'isTTY', { value: originalTTY[0], configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: originalTTY[1], configurable: true })
  resetOutput()
  vi.restoreAllMocks()
})

describe('circuit-breaker --watch', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'shows fresh observations from the selected database and stops on %s',
    async signal => {
      observe(async () => [row(calls === 1 ? 'open' : 'closed')])
      const running = run()
      await vi.waitFor(() => expect(displayTable).toHaveBeenCalledTimes(2), { timeout: 2500 })
      expect(JSON.stringify(vi.mocked(displayTable).mock.calls[0])).toContain('OPEN')
      expect(JSON.stringify(vi.mocked(displayTable).mock.calls[1])).toContain('CLOSED')
      expect(loadConfig).toHaveBeenCalledOnce()
      expect(loadConfig).toHaveBeenCalledWith('chosen.json')
      for (const [config] of vi.mocked(getDatabaseConnection).mock.calls)
        expect(config.database).toBe('/test-only/chosen.db')
      stop(signal)
      await running
      expect(destroyed).toBe(calls)
      expect(largest).toBe(1)
    }
  )
  it('does not overlap slow refreshes and awaits in-flight cleanup on cancellation', async () => {
    let release: (() => void) | undefined
    observe(async () => {
      if (calls === 2)
        await new Promise<void>(resolve => {
          release = resolve
        })
      return [row('open')]
    })
    let settled = false
    const running = run().finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(calls).toBe(2), { timeout: 2500 })
    await new Promise(resolve => setTimeout(resolve, 1150))
    expect(calls).toBe(2)
    stop()
    await Promise.resolve()
    expect(settled).toBe(false)
    release?.()
    await running
    expect(largest).toBe(1)
    expect(destroyed).toBe(2)
    expect(displayTable).toHaveBeenCalledOnce()
  })
  it('rejects refresh failure instead of replaying a stale healthy snapshot', async () => {
    observe(async () => {
      if (calls > 1) throw new Error('read failed')
      return [row('closed')]
    })
    await expect(run()).rejects.toThrow('read failed')
    expect(displayTable).toHaveBeenCalledOnce()
    expect(destroyed).toBe(2)
  })
  it.each([{ args: ['--json'] }, { args: ['--action', 'reset'] }])(
    'rejects unsupported options before connecting: $args',
    async ({ args }) => {
      await expect(run(args)).rejects.toMatchObject({ code: 'INVALID_OPTIONS' })
      expect(loadConfig).not.toHaveBeenCalled()
      expect(getDatabaseConnection).not.toHaveBeenCalled()
    }
  )
  it('does not clear or redraw output in a pipe', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    await expect(run()).rejects.toMatchObject({ code: 'INTERACTION_REQUIRED' })
    expect(console.clear).not.toHaveBeenCalled()
    expect(getDatabaseConnection).not.toHaveBeenCalled()
  })
})

it.each(['--threshold', '--timeout'])(
  'rejects former ignored option %s before connecting',
  async flag => {
    await expect(run([flag, '123'])).rejects.toMatchObject({ code: 'commander.unknownOption' })
    expect(loadConfig).not.toHaveBeenCalled()
    expect(getDatabaseConnection).not.toHaveBeenCalled()
  }
)
