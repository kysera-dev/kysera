import { describe, it, expect } from 'vitest'
import { resolvePluginOrder } from '../src/executor.js'
import type { Plugin } from '../src/types.js'

describe('Plugin Order Resolution', () => {
  it('should sort plugins by priority (higher first)', () => {
    const plugins: Plugin[] = [
      { name: 'audit', version: '1.0.0', priority: -100 },
      { name: 'soft-delete', version: '1.0.0', priority: 100 },
      { name: 'timestamps', version: '1.0.0', priority: 50 },
      { name: 'rls', version: '1.0.0', priority: 50 }
    ]

    const sorted = resolvePluginOrder(plugins)

    expect(sorted.map(p => p.name)).toEqual([
      'soft-delete', // priority 100
      'rls', // priority 50, alphabetically before timestamps
      'timestamps', // priority 50
      'audit' // priority -100
    ])
  })

  it('should handle Kysera standard plugin priorities', () => {
    // Simulate the priority values from actual Kysera plugins
    const plugins: Plugin[] = [
      { name: '@kysera/audit', version: '0.7.0', priority: -100 },
      { name: '@kysera/soft-delete', version: '0.7.0', priority: 100 },
      { name: '@kysera/timestamps', version: '0.7.0', priority: 50 },
      { name: '@kysera/rls', version: '0.7.0', priority: 50 }
    ]

    const sorted = resolvePluginOrder(plugins)

    // soft-delete first (100), then rls and timestamps (50, alphabetically), then audit (-100)
    expect(sorted.map(p => p.name)).toEqual([
      '@kysera/soft-delete', // priority 100
      '@kysera/rls', // priority 50, alphabetically before @kysera/timestamps
      '@kysera/timestamps', // priority 50
      '@kysera/audit' // priority -100
    ])
  })

  it('should run soft-delete before audit for correct state capture', () => {
    const plugins: Plugin[] = [
      { name: '@kysera/audit', version: '0.7.0', priority: -100 },
      { name: '@kysera/soft-delete', version: '0.7.0', priority: 100 }
    ]

    const sorted = resolvePluginOrder(plugins)

    // soft-delete should run first to filter deleted records
    // audit should run last to capture final state
    const softDeleteIndex = sorted.findIndex(p => p.name === '@kysera/soft-delete')
    const auditIndex = sorted.findIndex(p => p.name === '@kysera/audit')

    expect(softDeleteIndex).toBeLessThan(auditIndex)
  })

  it('should maintain stable order for plugins with same priority', () => {
    const plugins: Plugin[] = [
      { name: 'z-plugin', version: '1.0.0', priority: 50 },
      { name: 'a-plugin', version: '1.0.0', priority: 50 },
      { name: 'm-plugin', version: '1.0.0', priority: 50 }
    ]

    const sorted = resolvePluginOrder(plugins)

    // Alphabetical order when priorities are equal
    expect(sorted.map(p => p.name)).toEqual(['a-plugin', 'm-plugin', 'z-plugin'])
  })

  it('should handle plugins without priority (default 0)', () => {
    const plugins: Plugin[] = [
      { name: 'no-priority', version: '1.0.0' }, // defaults to 0
      { name: 'positive', version: '1.0.0', priority: 10 },
      { name: 'negative', version: '1.0.0', priority: -10 }
    ]

    const sorted = resolvePluginOrder(plugins)

    expect(sorted.map(p => p.name)).toEqual(['positive', 'no-priority', 'negative'])
  })
})
