import { describe, it, expect } from 'vitest'
import { shouldApplyToTable, type TableFilterConfig } from '../src/helpers.js'

describe('shouldApplyToTable', () => {
  describe('whitelist only', () => {
    it('should return true for tables in whitelist', () => {
      const config: TableFilterConfig = {
        tables: ['users', 'posts', 'comments']
      }

      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('posts', config)).toBe(true)
      expect(shouldApplyToTable('comments', config)).toBe(true)
    })

    it('should return false for tables not in whitelist', () => {
      const config: TableFilterConfig = {
        tables: ['users', 'posts']
      }

      expect(shouldApplyToTable('comments', config)).toBe(false)
      expect(shouldApplyToTable('sessions', config)).toBe(false)
      expect(shouldApplyToTable('migrations', config)).toBe(false)
    })

    it('should handle single table whitelist', () => {
      const config: TableFilterConfig = {
        tables: ['users']
      }

      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('posts', config)).toBe(false)
    })

    it('should treat empty whitelist as no whitelist', () => {
      const config: TableFilterConfig = {
        tables: []
      }

      // Empty array means no whitelist, should allow all
      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('posts', config)).toBe(true)
    })
  })

  describe('blacklist only', () => {
    it('should return false for tables in blacklist', () => {
      const config: TableFilterConfig = {
        excludeTables: ['migrations', 'sessions']
      }

      expect(shouldApplyToTable('migrations', config)).toBe(false)
      expect(shouldApplyToTable('sessions', config)).toBe(false)
    })

    it('should return true for tables not in blacklist', () => {
      const config: TableFilterConfig = {
        excludeTables: ['migrations', 'sessions']
      }

      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('posts', config)).toBe(true)
      expect(shouldApplyToTable('comments', config)).toBe(true)
    })

    it('should handle single table blacklist', () => {
      const config: TableFilterConfig = {
        excludeTables: ['migrations']
      }

      expect(shouldApplyToTable('migrations', config)).toBe(false)
      expect(shouldApplyToTable('users', config)).toBe(true)
    })

    it('should treat empty blacklist as no blacklist', () => {
      const config: TableFilterConfig = {
        excludeTables: []
      }

      // Empty array means no blacklist, should allow all
      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('migrations', config)).toBe(true)
    })
  })

  describe('whitelist takes precedence', () => {
    it('should ignore blacklist when whitelist is provided', () => {
      const config: TableFilterConfig = {
        tables: ['users', 'posts'],
        excludeTables: ['posts', 'comments']
      }

      // 'posts' is in whitelist, so blacklist is ignored
      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('posts', config)).toBe(true)

      // 'comments' is not in whitelist
      expect(shouldApplyToTable('comments', config)).toBe(false)
    })

    it('should use whitelist exclusively when both are provided', () => {
      const config: TableFilterConfig = {
        tables: ['users'],
        excludeTables: ['users', 'posts', 'comments']
      }

      // Whitelist takes precedence - blacklist is completely ignored
      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('posts', config)).toBe(false)
    })
  })

  describe('allow all (no configuration)', () => {
    it('should return true when no whitelist or blacklist is provided', () => {
      const config: TableFilterConfig = {}

      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('posts', config)).toBe(true)
      expect(shouldApplyToTable('comments', config)).toBe(true)
      expect(shouldApplyToTable('migrations', config)).toBe(true)
    })

    it('should return true when both are empty arrays', () => {
      const config: TableFilterConfig = {
        tables: [],
        excludeTables: []
      }

      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('posts', config)).toBe(true)
    })

    it('should return true when properties are omitted', () => {
      const config: TableFilterConfig = {}

      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('posts', config)).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle special characters in table names', () => {
      const config: TableFilterConfig = {
        tables: ['user_data', 'user-profile', 'user.info']
      }

      expect(shouldApplyToTable('user_data', config)).toBe(true)
      expect(shouldApplyToTable('user-profile', config)).toBe(true)
      expect(shouldApplyToTable('user.info', config)).toBe(true)
      expect(shouldApplyToTable('user', config)).toBe(false)
    })

    it('should be case-sensitive', () => {
      const config: TableFilterConfig = {
        tables: ['users']
      }

      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('Users', config)).toBe(false)
      expect(shouldApplyToTable('USERS', config)).toBe(false)
    })

    it('should handle exact string matching', () => {
      const config: TableFilterConfig = {
        tables: ['user']
      }

      expect(shouldApplyToTable('user', config)).toBe(true)
      expect(shouldApplyToTable('users', config)).toBe(false)
      expect(shouldApplyToTable('user_data', config)).toBe(false)
    })
  })

  describe('real-world scenarios', () => {
    it('should work for soft-delete plugin excluding audit tables', () => {
      const config: TableFilterConfig = {
        excludeTables: ['audit_logs', 'migrations', 'sessions']
      }

      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('posts', config)).toBe(true)
      expect(shouldApplyToTable('audit_logs', config)).toBe(false)
      expect(shouldApplyToTable('migrations', config)).toBe(false)
    })

    it('should work for audit plugin on specific tables only', () => {
      const config: TableFilterConfig = {
        tables: ['users', 'orders', 'payments']
      }

      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('orders', config)).toBe(true)
      expect(shouldApplyToTable('payments', config)).toBe(true)
      expect(shouldApplyToTable('sessions', config)).toBe(false)
      expect(shouldApplyToTable('cache', config)).toBe(false)
    })

    it('should work for timestamps plugin with system table exclusions', () => {
      const config: TableFilterConfig = {
        excludeTables: ['kysely_migration', 'kysely_migration_lock']
      }

      expect(shouldApplyToTable('users', config)).toBe(true)
      expect(shouldApplyToTable('kysely_migration', config)).toBe(false)
      expect(shouldApplyToTable('kysely_migration_lock', config)).toBe(false)
    })
  })
})
