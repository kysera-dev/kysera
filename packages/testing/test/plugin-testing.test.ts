/**
 * Tests for plugin testing utilities.
 */

import { describe, it, expect, vi } from 'vitest'
import type { Plugin, QueryBuilderContext } from '@kysera/executor'
import {
  createMockPlugin,
  spyOnPlugin,
  assertPluginBehavior,
  createInMemoryDatabase,
  createPluginTestHarness,
  type RecordedOperation,
  type PluginTestResult
} from '../src/plugin-testing.js'

import type { Generated } from 'kysely'

/**
 * Mock database interface for testing
 * Using Generated<number> for auto-increment fields (Kysely pattern)
 */
interface TestDB {
  users: {
    id: Generated<number>
    email: string
    name: string | null
    deleted_at: string | null
  }
  posts: {
    id: Generated<number>
    title: string
    user_id: number
  }
}

/**
 * Create a simple plugin for testing spy functionality
 */
function createSimplePlugin(name: string): Plugin {
  return {
    name,
    version: '1.0.0',
    interceptQuery<QB>(qb: QB, _context: QueryBuilderContext): QB {
      // Simple passthrough that adds a marker for testing
      return qb
    }
  }
}

/**
 * Create a plugin that modifies query builders
 */
function createModifyingPlugin(): Plugin {
  return {
    name: 'modifying-plugin',
    version: '1.0.0',
    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      if (context.operation === 'select') {
        // Return a new object to indicate modification
        return { ...qb, modified: true } as QB
      }
      return qb
    }
  }
}

/**
 * Create a plugin without interceptQuery for edge case testing
 */
function createNoInterceptPlugin(): Plugin {
  return {
    name: 'no-intercept-plugin',
    version: '1.0.0'
    // No interceptQuery method
  }
}

describe('createMockPlugin', () => {
  describe('records operations correctly', () => {
    it('should record select operations', () => {
      const mockPlugin = createMockPlugin('test-plugin')

      const mockQb = { selectFrom: vi.fn() }
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      mockPlugin.interceptQuery!(mockQb, context)

      expect(mockPlugin.operations).toHaveLength(1)
      expect(mockPlugin.operations[0]!.operation).toBe('select')
      expect(mockPlugin.operations[0]!.table).toBe('users')
    })

    it('should record insert operations', () => {
      const mockPlugin = createMockPlugin('test-plugin')

      const mockQb = { insertInto: vi.fn() }
      const context: QueryBuilderContext = {
        operation: 'insert',
        table: 'users',
        metadata: { values: { name: 'Alice' } }
      }

      mockPlugin.interceptQuery!(mockQb, context)

      expect(mockPlugin.operations).toHaveLength(1)
      expect(mockPlugin.operations[0]!.operation).toBe('insert')
      expect(mockPlugin.operations[0]!.table).toBe('users')
      expect(mockPlugin.operations[0]!.metadata).toEqual({ values: { name: 'Alice' } })
    })

    it('should record update operations', () => {
      const mockPlugin = createMockPlugin('test-plugin')

      const mockQb = { updateTable: vi.fn() }
      const context: QueryBuilderContext = {
        operation: 'update',
        table: 'posts',
        metadata: {}
      }

      mockPlugin.interceptQuery!(mockQb, context)

      expect(mockPlugin.operations).toHaveLength(1)
      expect(mockPlugin.operations[0]!.operation).toBe('update')
      expect(mockPlugin.operations[0]!.table).toBe('posts')
    })

    it('should record delete operations', () => {
      const mockPlugin = createMockPlugin('test-plugin')

      const mockQb = { deleteFrom: vi.fn() }
      const context: QueryBuilderContext = {
        operation: 'delete',
        table: 'users',
        metadata: {}
      }

      mockPlugin.interceptQuery!(mockQb, context)

      expect(mockPlugin.operations).toHaveLength(1)
      expect(mockPlugin.operations[0]!.operation).toBe('delete')
      expect(mockPlugin.operations[0]!.table).toBe('users')
    })

    it('should record multiple operations in sequence', () => {
      const mockPlugin = createMockPlugin('test-plugin')

      // First operation
      mockPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata: {} })

      // Second operation
      mockPlugin.interceptQuery!({}, { operation: 'insert', table: 'posts', metadata: {} })

      // Third operation
      mockPlugin.interceptQuery!({}, { operation: 'delete', table: 'users', metadata: {} })

      expect(mockPlugin.operations).toHaveLength(3)
      expect(mockPlugin.operations[0]!.operation).toBe('select')
      expect(mockPlugin.operations[1]!.operation).toBe('insert')
      expect(mockPlugin.operations[2]!.operation).toBe('delete')
    })

    it('should record timestamp for each operation', () => {
      const mockPlugin = createMockPlugin('test-plugin')

      const beforeTime = new Date()

      mockPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata: {} })

      const afterTime = new Date()

      expect(mockPlugin.operations[0]!.timestamp).toBeInstanceOf(Date)
      expect(mockPlugin.operations[0]!.timestamp.getTime()).toBeGreaterThanOrEqual(
        beforeTime.getTime()
      )
      expect(mockPlugin.operations[0]!.timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime())
    })

    it('should copy metadata to prevent mutation', () => {
      const mockPlugin = createMockPlugin('test-plugin')

      const metadata = { key: 'original' }
      mockPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata })

      // Mutate original metadata
      metadata.key = 'mutated'

      // Recorded metadata should be unchanged
      expect(mockPlugin.operations[0]!.metadata['key']).toBe('original')
    })
  })

  describe('reset() clears operations', () => {
    it('should clear all recorded operations', () => {
      const mockPlugin = createMockPlugin('test-plugin')

      // Record some operations
      mockPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata: {} })
      mockPlugin.interceptQuery!({}, { operation: 'insert', table: 'posts', metadata: {} })

      expect(mockPlugin.operations).toHaveLength(2)

      // Reset
      mockPlugin.reset()

      expect(mockPlugin.operations).toHaveLength(0)
    })

    it('should allow recording new operations after reset', () => {
      const mockPlugin = createMockPlugin('test-plugin')

      // Record operation
      mockPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata: {} })
      expect(mockPlugin.operations).toHaveLength(1)

      // Reset
      mockPlugin.reset()
      expect(mockPlugin.operations).toHaveLength(0)

      // Record new operation
      mockPlugin.interceptQuery!({}, { operation: 'delete', table: 'posts', metadata: {} })
      expect(mockPlugin.operations).toHaveLength(1)
      expect(mockPlugin.operations[0]!.operation).toBe('delete')
    })

    it('should be callable multiple times', () => {
      const mockPlugin = createMockPlugin('test-plugin')

      mockPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata: {} })
      mockPlugin.reset()
      mockPlugin.reset()
      mockPlugin.reset()

      expect(mockPlugin.operations).toHaveLength(0)
    })
  })

  describe('custom onIntercept callback', () => {
    it('should call custom onIntercept when provided', () => {
      const onIntercept = vi.fn((qb) => qb)

      const mockPlugin = createMockPlugin('test-plugin', { onIntercept })

      const mockQb = { query: 'test' }
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      mockPlugin.interceptQuery!(mockQb, context)

      expect(onIntercept).toHaveBeenCalledTimes(1)
      expect(onIntercept).toHaveBeenCalledWith(mockQb, context)
    })

    it('should allow onIntercept to modify query builder', () => {
      const onIntercept = vi.fn((qb, _ctx) => ({ ...qb, modified: true }))

      const mockPlugin = createMockPlugin('test-plugin', { onIntercept })

      const mockQb = { original: true }
      const result = mockPlugin.interceptQuery!(mockQb, {
        operation: 'select',
        table: 'users',
        metadata: {}
      })

      expect(result).toEqual({ original: true, modified: true })
    })

    it('should still record operations when onIntercept is provided', () => {
      const onIntercept = vi.fn((qb) => qb)

      const mockPlugin = createMockPlugin('test-plugin', { onIntercept })

      mockPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata: {} })

      expect(mockPlugin.operations).toHaveLength(1)
      expect(onIntercept).toHaveBeenCalledTimes(1)
    })

    it('should return original query builder when no onIntercept provided', () => {
      const mockPlugin = createMockPlugin('test-plugin')

      const mockQb = { original: true }
      const result = mockPlugin.interceptQuery!(mockQb, {
        operation: 'select',
        table: 'users',
        metadata: {}
      })

      expect(result).toBe(mockQb)
    })
  })

  describe('plugin properties', () => {
    it('should have correct name', () => {
      const mockPlugin = createMockPlugin('my-custom-plugin')

      expect(mockPlugin.name).toBe('my-custom-plugin')
    })

    it('should have test version', () => {
      const mockPlugin = createMockPlugin('test-plugin')

      expect(mockPlugin.version).toBe('1.0.0-test')
    })

    it('should have default priority of 0', () => {
      const mockPlugin = createMockPlugin('test-plugin')

      expect(mockPlugin.priority).toBe(0)
    })

    it('should allow custom priority', () => {
      const mockPlugin = createMockPlugin('test-plugin', { priority: 100 })

      expect(mockPlugin.priority).toBe(100)
    })

    it('should allow negative priority', () => {
      const mockPlugin = createMockPlugin('test-plugin', { priority: -50 })

      expect(mockPlugin.priority).toBe(-50)
    })
  })
})

describe('spyOnPlugin', () => {
  describe('preserves original plugin behavior', () => {
    it('should preserve plugin name', () => {
      const originalPlugin = createSimplePlugin('original-plugin')
      const spiedPlugin = spyOnPlugin(originalPlugin)

      expect(spiedPlugin.name).toBe('original-plugin')
    })

    it('should preserve plugin version', () => {
      const originalPlugin: Plugin = {
        name: 'versioned-plugin',
        version: '2.5.0'
      }
      const spiedPlugin = spyOnPlugin(originalPlugin)

      expect(spiedPlugin.version).toBe('2.5.0')
    })

    it('should preserve plugin priority', () => {
      const originalPlugin: Plugin = {
        name: 'priority-plugin',
        version: '1.0.0',
        priority: 42
      }
      const spiedPlugin = spyOnPlugin(originalPlugin)

      expect(spiedPlugin.priority).toBe(42)
    })

    it('should call original interceptQuery method', () => {
      const interceptQuery = vi.fn((qb) => ({ ...qb, intercepted: true }))
      const originalPlugin: Plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        interceptQuery
      }
      const spiedPlugin = spyOnPlugin(originalPlugin)

      const mockQb = { original: true }
      const result = spiedPlugin.interceptQuery!(mockQb, {
        operation: 'select',
        table: 'users',
        metadata: {}
      })

      expect(interceptQuery).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ original: true, intercepted: true })
    })

    it('should preserve query builder modification behavior', () => {
      const modifyingPlugin = createModifyingPlugin()
      const spiedPlugin = spyOnPlugin(modifyingPlugin)

      const mockQb = { query: 'original' }
      const result = spiedPlugin.interceptQuery!(mockQb, {
        operation: 'select',
        table: 'users',
        metadata: {}
      })

      expect(result).toHaveProperty('modified', true)
    })

    it('should work with plugins that have no interceptQuery', () => {
      const noInterceptPlugin = createNoInterceptPlugin()
      const spiedPlugin = spyOnPlugin(noInterceptPlugin)

      expect(spiedPlugin.name).toBe('no-intercept-plugin')
      expect(spiedPlugin.interceptQuery).toBeUndefined()
      expect(spiedPlugin.calls).toHaveLength(0)
    })
  })

  describe('records all calls', () => {
    it('should record single call', () => {
      const originalPlugin = createSimplePlugin('test-plugin')
      const spiedPlugin = spyOnPlugin(originalPlugin)

      spiedPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata: {} })

      expect(spiedPlugin.calls).toHaveLength(1)
      expect(spiedPlugin.calls[0]!.operation).toBe('select')
      expect(spiedPlugin.calls[0]!.table).toBe('users')
    })

    it('should record multiple calls', () => {
      const originalPlugin = createSimplePlugin('test-plugin')
      const spiedPlugin = spyOnPlugin(originalPlugin)

      spiedPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata: {} })
      spiedPlugin.interceptQuery!({}, { operation: 'insert', table: 'posts', metadata: {} })
      spiedPlugin.interceptQuery!({}, { operation: 'delete', table: 'comments', metadata: {} })

      expect(spiedPlugin.calls).toHaveLength(3)
      expect(spiedPlugin.calls[0]!.operation).toBe('select')
      expect(spiedPlugin.calls[1]!.operation).toBe('insert')
      expect(spiedPlugin.calls[2]!.operation).toBe('delete')
    })

    it('should record call timestamps', () => {
      const originalPlugin = createSimplePlugin('test-plugin')
      const spiedPlugin = spyOnPlugin(originalPlugin)

      const beforeTime = new Date()
      spiedPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata: {} })
      const afterTime = new Date()

      expect(spiedPlugin.calls[0]!.timestamp).toBeInstanceOf(Date)
      expect(spiedPlugin.calls[0]!.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
      expect(spiedPlugin.calls[0]!.timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime())
    })

    it('should record metadata', () => {
      const originalPlugin = createSimplePlugin('test-plugin')
      const spiedPlugin = spyOnPlugin(originalPlugin)

      const metadata = { customKey: 'customValue', count: 42 }
      spiedPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata })

      expect(spiedPlugin.calls[0]!.metadata).toEqual(metadata)
    })

    it('should copy metadata to prevent mutation', () => {
      const originalPlugin = createSimplePlugin('test-plugin')
      const spiedPlugin = spyOnPlugin(originalPlugin)

      const metadata = { key: 'original' }
      spiedPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata })

      metadata.key = 'mutated'

      expect(spiedPlugin.calls[0]!.metadata['key']).toBe('original')
    })
  })

  describe('reset functionality', () => {
    it('should have reset method', () => {
      const originalPlugin = createSimplePlugin('test-plugin')
      const spiedPlugin = spyOnPlugin(originalPlugin)

      expect(typeof spiedPlugin.reset).toBe('function')
    })

    it('should clear calls on reset', () => {
      const originalPlugin = createSimplePlugin('test-plugin')
      const spiedPlugin = spyOnPlugin(originalPlugin)

      spiedPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata: {} })
      spiedPlugin.interceptQuery!({}, { operation: 'insert', table: 'posts', metadata: {} })

      expect(spiedPlugin.calls).toHaveLength(2)

      spiedPlugin.reset()

      expect(spiedPlugin.calls).toHaveLength(0)
    })

    it('should allow recording after reset', () => {
      const originalPlugin = createSimplePlugin('test-plugin')
      const spiedPlugin = spyOnPlugin(originalPlugin)

      spiedPlugin.interceptQuery!({}, { operation: 'select', table: 'users', metadata: {} })
      spiedPlugin.reset()
      spiedPlugin.interceptQuery!({}, { operation: 'delete', table: 'posts', metadata: {} })

      expect(spiedPlugin.calls).toHaveLength(1)
      expect(spiedPlugin.calls[0]!.operation).toBe('delete')
    })
  })
})

describe('assertPluginBehavior', () => {
  describe('verifies intercepted', () => {
    it('should return intercepted: true when plugin has interceptQuery', () => {
      const plugin = createSimplePlugin('test-plugin')
      const mockQb = { query: 'test' }
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      const result = assertPluginBehavior(plugin, mockQb, context)

      expect(result.intercepted).toBe(true)
    })

    it('should return intercepted: false when plugin has no interceptQuery', () => {
      const plugin = createNoInterceptPlugin()
      const mockQb = { query: 'test' }
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      const result = assertPluginBehavior(plugin, mockQb, context)

      expect(result.intercepted).toBe(false)
    })

    it('should capture errors from interceptQuery', () => {
      const errorPlugin: Plugin = {
        name: 'error-plugin',
        version: '1.0.0',
        interceptQuery() {
          throw new Error('Intercept failed')
        }
      }
      const mockQb = {}
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      const result = assertPluginBehavior(errorPlugin, mockQb, context)

      expect(result.error).toBeInstanceOf(Error)
      expect(result.error!.message).toBe('Intercept failed')
    })
  })

  describe('verifies query modifications', () => {
    it('should return modified: true when query builder is modified', () => {
      const modifyingPlugin = createModifyingPlugin()
      const mockQb = { original: true }
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      const result = assertPluginBehavior(modifyingPlugin, mockQb, context)

      expect(result.modified).toBe(true)
    })

    it('should return modified: false when query builder is unchanged', () => {
      const passThroughPlugin = createSimplePlugin('passthrough')
      const mockQb = { original: true }
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      const result = assertPluginBehavior(passThroughPlugin, mockQb, context)

      expect(result.modified).toBe(false)
    })

    it('should throw when shouldModifyQuery assertion fails (expected true)', () => {
      const passThroughPlugin = createSimplePlugin('passthrough')
      const mockQb = { original: true }
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      expect(() =>
        assertPluginBehavior(passThroughPlugin, mockQb, context, {
          shouldModifyQuery: true
        })
      ).toThrow('Expected plugin to modify query, but it didn\'t')
    })

    it('should throw when shouldModifyQuery assertion fails (expected false)', () => {
      const modifyingPlugin = createModifyingPlugin()
      const mockQb = { original: true }
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      expect(() =>
        assertPluginBehavior(modifyingPlugin, mockQb, context, {
          shouldModifyQuery: false
        })
      ).toThrow('Expected plugin to not modify query, but it did')
    })

    it('should not throw when shouldModifyQuery assertion passes', () => {
      const modifyingPlugin = createModifyingPlugin()
      const mockQb = { original: true }
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      expect(() =>
        assertPluginBehavior(modifyingPlugin, mockQb, context, {
          shouldModifyQuery: true
        })
      ).not.toThrow()
    })

    it('should return modified: false when plugin has no interceptQuery', () => {
      const noInterceptPlugin = createNoInterceptPlugin()
      const mockQb = { original: true }
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      const result = assertPluginBehavior(noInterceptPlugin, mockQb, context)

      expect(result.modified).toBe(false)
    })
  })

  describe('handles edge cases', () => {
    it('should work with empty metadata', () => {
      const plugin = createSimplePlugin('test-plugin')
      const mockQb = {}
      const context: QueryBuilderContext = {
        operation: 'select',
        table: 'users',
        metadata: {}
      }

      const result = assertPluginBehavior(plugin, mockQb, context)

      expect(result.intercepted).toBe(true)
    })

    it('should work with all operation types', () => {
      const plugin = createSimplePlugin('test-plugin')
      const operations: QueryBuilderContext['operation'][] = [
        'select',
        'insert',
        'update',
        'delete',
        'replace',
        'merge'
      ]

      for (const operation of operations) {
        const result = assertPluginBehavior(
          plugin,
          {},
          { operation, table: 'test', metadata: {} }
        )
        expect(result.intercepted).toBe(true)
      }
    })

    it('should return valid PluginTestResult structure', () => {
      const plugin = createSimplePlugin('test-plugin')
      const result = assertPluginBehavior(
        plugin,
        {},
        { operation: 'select', table: 'users', metadata: {} }
      )

      expect(result).toHaveProperty('intercepted')
      expect(result).toHaveProperty('modified')
      expect(typeof result.intercepted).toBe('boolean')
      expect(typeof result.modified).toBe('boolean')
    })
  })
})

describe('createInMemoryDatabase', () => {
  describe('creates valid Kysely instance', () => {
    it('should create database with simple schema', async () => {
      const db = await createInMemoryDatabase<TestDB>(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT,
          deleted_at TEXT
        )
      `)

      expect(db).toBeDefined()
      expect(typeof db.selectFrom).toBe('function')
      expect(typeof db.insertInto).toBe('function')
      expect(typeof db.updateTable).toBe('function')
      expect(typeof db.deleteFrom).toBe('function')

      await db.destroy()
    })

    it('should create database with multiple tables', async () => {
      const db = await createInMemoryDatabase<TestDB>(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT,
          deleted_at TEXT
        );
        CREATE TABLE posts (
          id INTEGER PRIMARY KEY,
          title TEXT NOT NULL,
          user_id INTEGER
        )
      `)

      expect(db).toBeDefined()

      await db.destroy()
    })

    it('should have destroy method', async () => {
      const db = await createInMemoryDatabase<TestDB>(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT,
          deleted_at TEXT
        )
      `)

      expect(typeof db.destroy).toBe('function')

      await db.destroy()
    })
  })

  describe('executes schema statements', () => {
    it('should allow inserting data after schema creation', async () => {
      const db = await createInMemoryDatabase<TestDB>(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT,
          deleted_at TEXT
        )
      `)

      const result = await db
        .insertInto('users')
        .values({ email: 'test@example.com', name: 'Test User', deleted_at: null })
        .returning('id')
        .executeTakeFirst()

      expect(result).toBeDefined()
      expect(result?.id).toBeDefined()

      await db.destroy()
    })

    it('should allow querying data after insert', async () => {
      const db = await createInMemoryDatabase<TestDB>(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT,
          deleted_at TEXT
        )
      `)

      await db
        .insertInto('users')
        .values({ email: 'alice@example.com', name: 'Alice', deleted_at: null })
        .execute()

      const users = await db.selectFrom('users').selectAll().execute()

      expect(users).toHaveLength(1)
      expect(users[0]?.email).toBe('alice@example.com')
      expect(users[0]?.name).toBe('Alice')

      await db.destroy()
    })

    it('should support updating data', async () => {
      const db = await createInMemoryDatabase<TestDB>(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT,
          deleted_at TEXT
        )
      `)

      await db
        .insertInto('users')
        .values({ email: 'test@example.com', name: 'Original', deleted_at: null })
        .execute()

      await db
        .updateTable('users')
        .set({ name: 'Updated' })
        .where('email', '=', 'test@example.com')
        .execute()

      const user = await db
        .selectFrom('users')
        .selectAll()
        .where('email', '=', 'test@example.com')
        .executeTakeFirst()

      expect(user?.name).toBe('Updated')

      await db.destroy()
    })

    it('should support deleting data', async () => {
      const db = await createInMemoryDatabase<TestDB>(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT,
          deleted_at TEXT
        )
      `)

      await db
        .insertInto('users')
        .values({ email: 'test@example.com', name: 'Test', deleted_at: null })
        .execute()

      await db.deleteFrom('users').where('email', '=', 'test@example.com').execute()

      const users = await db.selectFrom('users').selectAll().execute()

      expect(users).toHaveLength(0)

      await db.destroy()
    })

    it('should handle empty schema statements gracefully', async () => {
      const db = await createInMemoryDatabase<TestDB>(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT,
          deleted_at TEXT
        );
        ;
        ;
      `)

      expect(db).toBeDefined()

      await db.destroy()
    })
  })

  describe('error handling', () => {
    it('should throw on invalid SQL schema', async () => {
      await expect(createInMemoryDatabase<TestDB>('INVALID SQL STATEMENT')).rejects.toThrow()
    })
  })
})

describe('createPluginTestHarness', () => {
  describe('full lifecycle (setup, execute, verify, teardown)', () => {
    it('should complete full lifecycle with mock plugin', async () => {
      const mockPlugin = createMockPlugin('test-plugin')

      const harness = createPluginTestHarness<TestDB>({
        plugins: [mockPlugin],
        schema: `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            deleted_at TEXT
          )
        `
      })

      // Setup
      await harness.setup()

      // Execute
      const insertResult = await harness.execute(async (executor) => {
        return executor
          .insertInto('users')
          .values({ email: 'test@example.com', name: 'Test User', deleted_at: null })
          .returning('id')
          .executeTakeFirst()
      })

      // Verify
      harness.verify(insertResult, (result) => {
        expect(result).toBeDefined()
        expect(result?.id).toBeDefined()
      })

      // Teardown
      await harness.teardown()
    })

    it('should track plugin operations during execute', async () => {
      const mockPlugin = createMockPlugin('tracking-plugin')

      const harness = createPluginTestHarness<TestDB>({
        plugins: [mockPlugin],
        schema: `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            deleted_at TEXT
          )
        `
      })

      await harness.setup()

      await harness.execute(async (executor) => {
        await executor
          .insertInto('users')
          .values({ email: 'test@example.com', name: 'Test', deleted_at: null })
          .execute()

        await executor.selectFrom('users').selectAll().execute()
      })

      // Plugin should have recorded operations
      expect(mockPlugin.operations.length).toBeGreaterThan(0)

      await harness.teardown()
    })

    it('should support seed data', async () => {
      const mockPlugin = createMockPlugin('test-plugin')

      const harness = createPluginTestHarness<TestDB>({
        plugins: [mockPlugin],
        schema: `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            deleted_at TEXT
          )
        `,
        seedData: async (executor) => {
          await executor
            .insertInto('users')
            .values([
              { email: 'alice@example.com', name: 'Alice', deleted_at: null },
              { email: 'bob@example.com', name: 'Bob', deleted_at: null }
            ])
            .execute()
        }
      })

      await harness.setup()

      const users = await harness.execute(async (executor) => {
        return executor.selectFrom('users').selectAll().execute()
      })

      expect(users).toHaveLength(2)

      await harness.teardown()
    })

    it('should throw if execute called before setup', async () => {
      const harness = createPluginTestHarness<TestDB>({
        plugins: [],
        schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY)'
      })

      await expect(harness.execute(async () => {})).rejects.toThrow(
        'Test harness not set up. Call setup() first.'
      )
    })

    it('should throw if getDb called before setup', () => {
      const harness = createPluginTestHarness<TestDB>({
        plugins: [],
        schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY)'
      })

      expect(() => harness.getDb()).toThrow('Test harness not set up. Call setup() first.')
    })

    it('should provide access to raw db via getDb', async () => {
      const harness = createPluginTestHarness<TestDB>({
        plugins: [],
        schema: `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            deleted_at TEXT
          )
        `
      })

      await harness.setup()

      const db = harness.getDb()
      expect(db).toBeDefined()
      expect(typeof db.selectFrom).toBe('function')

      await harness.teardown()
    })

    it('should properly cleanup on teardown', async () => {
      const harness = createPluginTestHarness<TestDB>({
        plugins: [],
        schema: `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            deleted_at TEXT
          )
        `
      })

      await harness.setup()

      // Should work before teardown
      await harness.execute(async (executor) => {
        return executor.selectFrom('users').selectAll().execute()
      })

      await harness.teardown()

      // Should throw after teardown
      await expect(
        harness.execute(async (executor) => {
          return executor.selectFrom('users').selectAll().execute()
        })
      ).rejects.toThrow()
    })

    it('should handle multiple setup/teardown cycles', async () => {
      const harness = createPluginTestHarness<TestDB>({
        plugins: [],
        schema: `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            deleted_at TEXT
          )
        `
      })

      // First cycle
      await harness.setup()
      await harness.execute(async (executor) => {
        await executor
          .insertInto('users')
          .values({ email: 'first@example.com', name: 'First', deleted_at: null })
          .execute()
      })
      await harness.teardown()

      // Second cycle - should start fresh
      await harness.setup()
      const users = await harness.execute(async (executor) => {
        return executor.selectFrom('users').selectAll().execute()
      })

      // Second cycle should have empty table (fresh database)
      expect(users).toHaveLength(0)

      await harness.teardown()
    })
  })

  describe('verify method', () => {
    it('should pass result to assertion callback', async () => {
      const harness = createPluginTestHarness<TestDB>({
        plugins: [],
        schema: `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            deleted_at TEXT
          )
        `
      })

      await harness.setup()

      const result = { id: 1, name: 'Test' }

      const assertionCallback = vi.fn()
      harness.verify(result, assertionCallback)

      expect(assertionCallback).toHaveBeenCalledTimes(1)
      expect(assertionCallback).toHaveBeenCalledWith(result)

      await harness.teardown()
    })

    it('should allow multiple verifications', async () => {
      const harness = createPluginTestHarness<TestDB>({
        plugins: [],
        schema: `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            deleted_at TEXT
          )
        `
      })

      await harness.setup()

      const result = { value: 42 }

      harness.verify(result, (r) => {
        expect(r.value).toBe(42)
      })

      harness.verify(result, (r) => {
        expect(typeof r.value).toBe('number')
      })

      await harness.teardown()
    })

    it('should propagate assertion errors', async () => {
      const harness = createPluginTestHarness<TestDB>({
        plugins: [],
        schema: `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            deleted_at TEXT
          )
        `
      })

      await harness.setup()

      const result = { value: 42 }

      expect(() => {
        harness.verify(result, (r) => {
          expect(r.value).toBe(100) // This should fail
        })
      }).toThrow()

      await harness.teardown()
    })
  })

  describe('with multiple plugins', () => {
    it('should work with multiple mock plugins', async () => {
      const plugin1 = createMockPlugin('plugin-1')
      const plugin2 = createMockPlugin('plugin-2')

      const harness = createPluginTestHarness<TestDB>({
        plugins: [plugin1, plugin2],
        schema: `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            deleted_at TEXT
          )
        `
      })

      await harness.setup()

      await harness.execute(async (executor) => {
        await executor
          .insertInto('users')
          .values({ email: 'test@example.com', name: 'Test', deleted_at: null })
          .execute()
      })

      // Both plugins should have recorded operations
      expect(plugin1.operations.length).toBeGreaterThan(0)
      expect(plugin2.operations.length).toBeGreaterThan(0)

      await harness.teardown()
    })

    it('should respect plugin priority', async () => {
      const lowPriorityPlugin = createMockPlugin('low-priority', { priority: 0 })
      const highPriorityPlugin = createMockPlugin('high-priority', { priority: 100 })

      const harness = createPluginTestHarness<TestDB>({
        plugins: [lowPriorityPlugin, highPriorityPlugin],
        schema: `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            deleted_at TEXT
          )
        `
      })

      await harness.setup()

      await harness.execute(async (executor) => {
        await executor.selectFrom('users').selectAll().execute()
      })

      // Both plugins should record operations
      expect(highPriorityPlugin.operations.length).toBeGreaterThan(0)
      expect(lowPriorityPlugin.operations.length).toBeGreaterThan(0)

      await harness.teardown()
    })
  })
})

describe('type exports', () => {
  it('should export RecordedOperation type with correct structure', () => {
    const operation: RecordedOperation = {
      operation: 'select',
      table: 'users',
      timestamp: new Date(),
      metadata: { key: 'value' }
    }

    expect(operation.operation).toBe('select')
    expect(operation.table).toBe('users')
    expect(operation.timestamp).toBeInstanceOf(Date)
    expect(operation.metadata).toEqual({ key: 'value' })
  })

  it('should export PluginTestResult type with correct structure', () => {
    const result: PluginTestResult = {
      intercepted: true,
      modified: false
    }

    expect(result.intercepted).toBe(true)
    expect(result.modified).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it('should export PluginTestResult with error', () => {
    const result: PluginTestResult = {
      intercepted: false,
      modified: false,
      error: new Error('Test error')
    }

    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe('Test error')
  })
})
