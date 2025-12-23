/**
 * Test for M-10: API naming consistency (excludeTables option)
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

    it('should work without excludeTables option', () => {
      const plugin = rlsPlugin({
        schema: createTestSchema()
      })

      expect(plugin.name).toBe('@kysera/rls')
    })
  })

  describe('Type-level API consistency', () => {
    it('should accept excludeTables as the standard option', () => {
      const optionsWithExclude: RLSPluginOptions = {
        schema: createTestSchema(),
        excludeTables: ['system_logs']
      }

      expect(optionsWithExclude).toBeDefined()
    })

    it('should accept excludeTables with multiple tables', () => {
      const plugin = rlsPlugin({
        schema: createTestSchema(),
        excludeTables: ['system_logs', 'migrations', 'audit_logs']
      })

      expect(plugin.name).toBe('@kysera/rls')
      expect(plugin).toBeDefined()
    })
  })
})
