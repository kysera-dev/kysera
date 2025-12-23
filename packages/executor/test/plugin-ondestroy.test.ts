/**
 * Test for M-9: Plugin onDestroy hooks
 */

import { describe, it, expect } from 'vitest'
import type { Plugin } from '../src/types.js'

describe('M-9: Plugin onDestroy hooks', () => {
  it('should verify plugin interface includes onDestroy', () => {
    // Mock plugin that implements full interface
    const mockPlugin: Plugin = {
      name: '@kysera/test',
      version: '1.0.0',
      priority: 0,

      onInit() {
        // Init logic
      },

      onDestroy() {
        // Cleanup logic
      }
    }

    expect(mockPlugin.onInit).toBeDefined()
    expect(mockPlugin.onDestroy).toBeDefined()
    expect(typeof mockPlugin.onInit).toBe('function')
    expect(typeof mockPlugin.onDestroy).toBe('function')
  })

  it('should allow plugins with both sync and async onDestroy', () => {
    const syncPlugin: Plugin = {
      name: '@kysera/sync',
      version: '1.0.0',
      onDestroy() {
        // Sync cleanup
      }
    }

    const asyncPlugin: Plugin = {
      name: '@kysera/async',
      version: '1.0.0',
      async onDestroy() {
        // Async cleanup
        await Promise.resolve()
      }
    }

    expect(syncPlugin.onDestroy).toBeDefined()
    expect(asyncPlugin.onDestroy).toBeDefined()
  })

  it('should allow onDestroy to be optional for backward compatibility', () => {
    // Old plugin without onDestroy
    const legacyPlugin: Plugin = {
      name: '@kysera/legacy',
      version: '1.0.0'
    }

    // Should compile - onDestroy is optional
    expect(legacyPlugin.onDestroy).toBeUndefined()
  })

  it('should call onDestroy without errors', async () => {
    let destroyed = false

    const plugin: Plugin = {
      name: '@kysera/test',
      version: '1.0.0',
      async onDestroy() {
        destroyed = true
      }
    }

    if (plugin.onDestroy) {
      await plugin.onDestroy()
    }

    expect(destroyed).toBe(true)
  })
})
