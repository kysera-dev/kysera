/**
 * Error-path coverage: destroyExecutor failure aggregation and
 * PluginValidationError structured fields.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Kysely, SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'
import {
  createExecutor,
  destroyExecutor,
  validatePlugins,
  PluginValidationError,
  type Plugin
} from '../src/index.js'

describe('destroyExecutor failure handling', () => {
  let db: Kysely<Record<string, never>>

  beforeEach(() => {
    db = new Kysely({ dialect: new SqliteDialect({ database: new Database(':memory:') }) })
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('continues destroying remaining plugins when one throws, then aggregates', async () => {
    const order: string[] = []
    const bad: Plugin = {
      name: 'bad',
      version: '1.0.0',
      onDestroy() {
        order.push('bad')
        throw new Error('bad destroy failure')
      }
    }
    const good: Plugin = {
      name: 'good',
      version: '1.0.0',
      onDestroy() {
        order.push('good')
      }
    }

    const executor = await createExecutor(db, [bad, good])

    await expect(destroyExecutor(executor)).rejects.toThrow(
      /Failed to destroy 1 plugin\(s\): bad: bad destroy failure/
    )
    // Reverse order: good destroyed first, bad still attempted
    expect(order).toEqual(['good', 'bad'])
  })

  it('aggregates multiple failures with all messages', async () => {
    const mk = (name: string): Plugin => ({
      name,
      version: '1.0.0',
      onDestroy() {
        throw new Error(`${name} exploded`)
      }
    })

    const executor = await createExecutor(db, [mk('p1'), mk('p2')])
    await expect(destroyExecutor(executor)).rejects.toThrow(/Failed to destroy 2 plugin\(s\)/)
    await expect(
      destroyExecutor(executor)
    ).rejects.toThrow(/p2: p2 exploded; p1: p1 exploded/)
  })

  it('handles non-Error throw values', async () => {
    const weird: Plugin = {
      name: 'weird',
      version: '1.0.0',
      onDestroy() {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'string failure'
      }
    }
    const executor = await createExecutor(db, [weird])
    await expect(destroyExecutor(executor)).rejects.toThrow(/weird: string failure/)
  })

  it('async onDestroy rejections are collected too', async () => {
    const asyncBad: Plugin = {
      name: 'async-bad',
      version: '1.0.0',
      onDestroy: vi.fn().mockRejectedValue(new Error('async failure'))
    }
    const executor = await createExecutor(db, [asyncBad])
    await expect(destroyExecutor(executor)).rejects.toThrow(/async-bad: async failure/)
  })
})

describe('PluginValidationError structured fields', () => {
  const base = (name: string, extra: Partial<Plugin> = {}): Plugin => ({
    name,
    version: '1.0.0',
    ...extra
  })

  it('DUPLICATE_NAME carries type and pluginName', () => {
    try {
      validatePlugins([base('dup'), base('dup')])
      expect.unreachable('should have thrown')
    } catch (error) {
      const e = error as PluginValidationError
      expect(e).toBeInstanceOf(PluginValidationError)
      expect(e.name).toBe('PluginValidationError')
      expect(e.type).toBe('DUPLICATE_NAME')
      expect(e.details).toEqual({ pluginName: 'dup' })
    }
  })

  it('MISSING_DEPENDENCY carries missingDependency detail', () => {
    try {
      validatePlugins([base('a', { dependencies: ['ghost'] })])
      expect.unreachable('should have thrown')
    } catch (error) {
      const e = error as PluginValidationError
      expect(e.type).toBe('MISSING_DEPENDENCY')
      expect(e.details.pluginName).toBe('a')
      expect(e.details.missingDependency).toBe('ghost')
    }
  })

  it('CONFLICT carries conflictingPlugin detail', () => {
    try {
      validatePlugins([base('a'), base('b', { conflictsWith: ['a'] })])
      expect.unreachable('should have thrown')
    } catch (error) {
      const e = error as PluginValidationError
      expect(e.type).toBe('CONFLICT')
      expect(e.details.pluginName).toBe('b')
      expect(e.details.conflictingPlugin).toBe('a')
    }
  })

  it('CIRCULAR_DEPENDENCY carries the full cycle path', () => {
    try {
      validatePlugins([
        base('a', { dependencies: ['b'] }),
        base('b', { dependencies: ['c'] }),
        base('c', { dependencies: ['a'] })
      ])
      expect.unreachable('should have thrown')
    } catch (error) {
      const e = error as PluginValidationError
      expect(e.type).toBe('CIRCULAR_DEPENDENCY')
      expect(e.details.cycle).toBeDefined()
      const cycle = e.details.cycle!
      // Cycle closes on itself
      expect(cycle[0]).toBe(cycle[cycle.length - 1])
      expect(cycle.length).toBeGreaterThanOrEqual(4)
    }
  })

  it('INITIALIZATION_FAILED carries the failing plugin name', async () => {
    const db = new Kysely<Record<string, never>>({
      dialect: new SqliteDialect({ database: new Database(':memory:') })
    })
    try {
      await expect(
        createExecutor(db, [
          base('boom', {
            onInit() {
              throw new Error('init failure')
            }
          })
        ])
      ).rejects.toMatchObject({
        name: 'PluginValidationError',
        type: 'INITIALIZATION_FAILED',
        details: { pluginName: 'boom' }
      })
    } finally {
      await db.destroy()
    }
  })
})
