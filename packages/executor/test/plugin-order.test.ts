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

  it('should respect dependencies in topological order', () => {
    const plugins: Plugin[] = [
      { name: 'audit', version: '1.0.0', priority: -100, dependencies: ['timestamps'] },
      { name: 'timestamps', version: '1.0.0', priority: 50 },
      { name: 'soft-delete', version: '1.0.0', priority: 100 }
    ]

    const sorted = resolvePluginOrder(plugins)

    // timestamps must come before audit due to dependency
    const timestampsIdx = sorted.findIndex(p => p.name === 'timestamps')
    const auditIdx = sorted.findIndex(p => p.name === 'audit')
    expect(timestampsIdx).toBeLessThan(auditIdx)
  })

  it('should handle multiple dependencies with priority ordering', () => {
    const plugins: Plugin[] = [
      { name: 'c-plugin', version: '1.0.0', priority: 10, dependencies: ['a-plugin', 'b-plugin'] },
      { name: 'a-plugin', version: '1.0.0', priority: 50 },
      { name: 'b-plugin', version: '1.0.0', priority: 30 }
    ]

    const sorted = resolvePluginOrder(plugins)

    // a-plugin and b-plugin must come before c-plugin
    const aIdx = sorted.findIndex(p => p.name === 'a-plugin')
    const bIdx = sorted.findIndex(p => p.name === 'b-plugin')
    const cIdx = sorted.findIndex(p => p.name === 'c-plugin')
    expect(aIdx).toBeLessThan(cIdx)
    expect(bIdx).toBeLessThan(cIdx)
    // a-plugin has higher priority so should come first
    expect(aIdx).toBeLessThan(bIdx)
  })

  it('should handle chain of dependencies', () => {
    const plugins: Plugin[] = [
      { name: 'plugin-c', version: '1.0.0', priority: 0, dependencies: ['plugin-b'] },
      { name: 'plugin-b', version: '1.0.0', priority: 0, dependencies: ['plugin-a'] },
      { name: 'plugin-a', version: '1.0.0', priority: 0 }
    ]

    const sorted = resolvePluginOrder(plugins)

    expect(sorted.map(p => p.name)).toEqual(['plugin-a', 'plugin-b', 'plugin-c'])
  })

  it('should insert dependent into sorted available list using binary search', () => {
    // This test ensures the insertSorted binary search is exercised:
    // We need multiple items in 'available' when a dependent becomes ready.
    // Plugins d, e, f have no dependencies and are available immediately.
    // Plugin g depends on d. When d is processed, g becomes available
    // and must be inserted into the sorted [e, f] list.
    const plugins: Plugin[] = [
      { name: 'd-plugin', version: '1.0.0', priority: 100 },
      { name: 'e-plugin', version: '1.0.0', priority: 50 },
      { name: 'f-plugin', version: '1.0.0', priority: 30 },
      { name: 'g-plugin', version: '1.0.0', priority: 40, dependencies: ['d-plugin'] }
    ]

    const sorted = resolvePluginOrder(plugins)

    // d-plugin (100) first, then e-plugin (50), then g-plugin (40, freed after d),
    // then f-plugin (30)
    const dIdx = sorted.findIndex(p => p.name === 'd-plugin')
    const gIdx = sorted.findIndex(p => p.name === 'g-plugin')
    expect(dIdx).toBeLessThan(gIdx)
    expect(sorted.map(p => p.name)).toEqual(['d-plugin', 'e-plugin', 'g-plugin', 'f-plugin'])
  })
})
