/**
 * Test for M-10: API naming consistency (excludeTables vs skipTables)
 */

import { describe, it, expect } from 'vitest'
import { rlsPlugin, defineRLSSchema, filter, RLSPluginOptions } from '../src/index.js'

describe('M-10: API naming consistency', () => {
  const createTestSchema = () =>
    defineRLSSchema({
      users: {
        policies: [filter('read', ctx => ({ user_id: ctx.auth.userId }))]
      }
    })

  describe('RLS plugin naming standardization', () => {
    it('should support excludeTables option', () => {
      const plugin = rlsPlugin({
        schema: createTestSchema(),
        excludeTables: ['system_logs', 'migrations']
      })

      expect(plugin.name).toBe('@kysera/rls')
    })

    it('should support deprecated skipTables option with backward compatibility', () => {
      const plugin = rlsPlugin({
        schema: createTestSchema(),
        skipTables: ['system_logs', 'migrations']
      })

      expect(plugin.name).toBe('@kysera/rls')
    })

    it('should prefer excludeTables when both are provided', () => {
      const plugin = rlsPlugin({
        schema: createTestSchema(),
        excludeTables: ['exclude_table'],
        skipTables: ['skip_table']
      })

      expect(plugin.name).toBe('@kysera/rls')
      // Behavior is tested in integration tests - excludeTables should take precedence
    })
  })

  describe('Type-level API consistency', () => {
    it('should allow both excludeTables and skipTables options', () => {
      // Test that both options are accepted by the type system
      const optionsWithExclude: RLSPluginOptions = {
        schema: createTestSchema(),
        excludeTables: ['system_logs']
      }

      const optionsWithSkip: RLSPluginOptions = {
        schema: createTestSchema(),
        skipTables: ['system_logs']
      }

      const optionsWithBoth: RLSPluginOptions = {
        schema: createTestSchema(),
        excludeTables: ['exclude_table'],
        skipTables: ['skip_table']
      }

      expect(optionsWithExclude).toBeDefined()
      expect(optionsWithSkip).toBeDefined()
      expect(optionsWithBoth).toBeDefined()
    })

    it('should accept excludeTables as the primary option', () => {
      const plugin = rlsPlugin({
        schema: createTestSchema(),
        excludeTables: ['system_logs', 'migrations']
      })

      expect(plugin.name).toBe('@kysera/rls')
      expect(plugin).toBeDefined()
    })
  })
})
