/**
 * Signal-handler registration coverage for shutdown utilities.
 *
 * registerShutdownHandlers / registerSignals had zero coverage — the actual
 * `process.on(...)` wiring, the shutdown-once guard, and exit codes were
 * never executed. We stub globalThis.process methods (never sending real
 * signals) to keep the test hermetic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Kysely } from 'kysely'
import { registerShutdownHandlers, createShutdownController } from '../src/shutdown.js'
import { silentLogger } from '@kysera/core'

type SignalHandler = () => void

describe('registerShutdownHandlers', () => {
  let handlers: Map<string, SignalHandler[]>
  let onSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  const flush = async (): Promise<void> => {
    // Let the async handleShutdown chain settle
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  const emit = (signal: string): void => {
    for (const handler of handlers.get(signal) ?? []) handler()
  }

  const mkdb = (destroy = vi.fn().mockResolvedValue(undefined)): Kysely<never> =>
    ({ destroy }) as unknown as Kysely<never>

  beforeEach(() => {
    handlers = new Map()
    onSpy = vi.spyOn(process, 'on').mockImplementation(((signal: string, handler: SignalHandler) => {
      const list = handlers.get(signal) ?? []
      list.push(handler)
      handlers.set(signal, list)
      return process
    }) as never)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })

  afterEach(() => {
    onSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('registers handlers for SIGTERM and SIGINT by default', () => {
    registerShutdownHandlers(mkdb(), { logger: silentLogger })
    expect(handlers.has('SIGTERM')).toBe(true)
    expect(handlers.has('SIGINT')).toBe(true)
  })

  it('respects a custom signal list', () => {
    registerShutdownHandlers(mkdb(), { signals: ['SIGQUIT'], logger: silentLogger })
    expect(handlers.has('SIGQUIT')).toBe(true)
    expect(handlers.has('SIGTERM')).toBe(false)
  })

  it('destroys the database and exits 0 on signal', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined)
    const onShutdown = vi.fn().mockResolvedValue(undefined)
    registerShutdownHandlers(mkdb(destroy), { logger: silentLogger, onShutdown })

    emit('SIGTERM')
    await flush()

    expect(onShutdown).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('exits 1 when shutdown fails', async () => {
    const destroy = vi.fn().mockRejectedValue(new Error('close failed'))
    registerShutdownHandlers(mkdb(destroy), { logger: silentLogger })

    emit('SIGINT')
    await flush()

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('runs shutdown only once for repeated signals', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined)
    registerShutdownHandlers(mkdb(destroy), { logger: silentLogger })

    emit('SIGTERM')
    emit('SIGTERM')
    emit('SIGINT')
    await flush()

    expect(destroy).toHaveBeenCalledTimes(1)
  })
})

describe('createShutdownController.registerSignals', () => {
  it('wires the same handler registration as registerShutdownHandlers', () => {
    const registered: string[] = []
    const onSpy = vi.spyOn(process, 'on').mockImplementation(((signal: string) => {
      registered.push(signal)
      return process
    }) as never)
    try {
      const controller = createShutdownController(
        { destroy: vi.fn().mockResolvedValue(undefined) } as unknown as Kysely<never>,
        { logger: silentLogger, signals: ['SIGTERM'] }
      )
      expect(controller.isShuttingDown()).toBe(false)
      controller.registerSignals()
      expect(registered).toEqual(['SIGTERM'])
    } finally {
      onSpy.mockRestore()
    }
  })
})
