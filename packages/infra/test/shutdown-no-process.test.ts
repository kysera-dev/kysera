/**
 * registerShutdownHandlers in runtimes without process signal support
 * (browser/workers): must warn and return instead of crashing.
 */
import { describe, it, expect, vi } from 'vitest'
import type { Kysely } from 'kysely'
import { registerShutdownHandlers } from '../src/shutdown.js'
import { silentLogger } from '@kysera/core'

describe('registerShutdownHandlers without process support', () => {
  it('warns and skips registration when process lacks signal APIs', () => {
    const warnings: string[] = []
    const logger = { ...silentLogger, warn: (msg: string) => warnings.push(msg) }

    const g = globalThis as { process?: unknown }
    const realProcess = g.process
    // Simulate a runtime whose `process` shim lacks .on/.exit (sync scope only)
    g.process = {}
    try {
      registerShutdownHandlers(
        { destroy: vi.fn() } as unknown as Kysely<never>,
        { logger }
      )
    } finally {
      g.process = realProcess
    }

    expect(warnings.some(w => w.includes('not available in this runtime'))).toBe(true)
  })
})
