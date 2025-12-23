/**
 * Tests for Zod schemas in migrations package.
 *
 * Tests validation improvements for M-14: replacing z.any() with proper types.
 */

import { describe, it, expect } from 'vitest'
import {
  MigrationRunnerOptionsSchema,
  MigrationPluginOptionsSchema,
  MigrationPluginSchema,
  parseMigrationRunnerOptions,
  safeParseMigrationRunnerOptions
} from '../src/schemas.js'

describe('Migration Schemas', () => {
  describe('MigrationRunnerOptionsSchema - Logger Validation', () => {
    it('should accept valid logger object', () => {
      const validLogger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {}
      }

      const result = MigrationRunnerOptionsSchema.safeParse({
        logger: validLogger
      })

      expect(result.success).toBe(true)
    })

    it('should reject logger missing required methods', () => {
      const invalidLogger = {
        debug: () => {},
        info: () => {}
        // Missing trace, warn, error, fatal
      }

      const result = MigrationRunnerOptionsSchema.safeParse({
        logger: invalidLogger
      })

      expect(result.success).toBe(false)
    })

    it('should reject logger with non-function methods', () => {
      const invalidLogger = {
        trace: () => {},
        debug: 'not a function',
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {}
      }

      const result = MigrationRunnerOptionsSchema.safeParse({
        logger: invalidLogger
      })

      expect(result.success).toBe(false)
    })

    it('should accept logger with additional properties', () => {
      const loggerWithExtras = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        customMethod: () => {},
        metadata: { level: 'debug' }
      }

      const result = MigrationRunnerOptionsSchema.safeParse({
        logger: loggerWithExtras
      })

      expect(result.success).toBe(true)
    })

    it('should accept undefined logger', () => {
      const result = MigrationRunnerOptionsSchema.safeParse({
        logger: undefined
      })

      expect(result.success).toBe(true)
    })

    it('should accept options without logger field', () => {
      const result = MigrationRunnerOptionsSchema.safeParse({
        dryRun: true,
        verbose: false
      })

      expect(result.success).toBe(true)
    })
  })

  describe('MigrationPluginOptionsSchema - Logger Validation', () => {
    it('should validate logger in plugin options', () => {
      const validLogger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {}
      }

      const result = MigrationPluginOptionsSchema.safeParse({
        logger: validLogger
      })

      expect(result.success).toBe(true)
    })

    it('should reject invalid logger in plugin options', () => {
      const result = MigrationPluginOptionsSchema.safeParse({
        logger: { debug: 'not a function' }
      })

      expect(result.success).toBe(false)
    })
  })

  describe('MigrationPluginSchema - Hook Function Validation', () => {
    it('should accept valid plugin with all hooks', () => {
      const validPlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        onInit: async () => {},
        beforeMigration: async () => {},
        afterMigration: async () => {},
        onMigrationError: async () => {}
      }

      const result = MigrationPluginSchema.safeParse(validPlugin)

      expect(result.success).toBe(true)
    })

    it('should accept plugin with only required fields', () => {
      const minimalPlugin = {
        name: 'minimal-plugin',
        version: '1.0.0'
      }

      const result = MigrationPluginSchema.safeParse(minimalPlugin)

      expect(result.success).toBe(true)
    })

    it('should accept plugin with some hooks', () => {
      const partialPlugin = {
        name: 'partial-plugin',
        version: '1.0.0',
        beforeMigration: async () => {},
        afterMigration: async () => {}
      }

      const result = MigrationPluginSchema.safeParse(partialPlugin)

      expect(result.success).toBe(true)
    })

    it('should reject plugin with non-function hook', () => {
      const invalidPlugin = {
        name: 'invalid-plugin',
        version: '1.0.0',
        onInit: 'not a function'
      }

      const result = MigrationPluginSchema.safeParse(invalidPlugin)

      expect(result.success).toBe(false)
    })

    it('should reject plugin with empty name', () => {
      const result = MigrationPluginSchema.safeParse({
        name: '',
        version: '1.0.0'
      })

      expect(result.success).toBe(false)
    })

    it('should reject plugin with empty version', () => {
      const result = MigrationPluginSchema.safeParse({
        name: 'test-plugin',
        version: ''
      })

      expect(result.success).toBe(false)
    })

    it('should reject plugin missing name', () => {
      const result = MigrationPluginSchema.safeParse({
        version: '1.0.0'
      })

      expect(result.success).toBe(false)
    })

    it('should reject plugin missing version', () => {
      const result = MigrationPluginSchema.safeParse({
        name: 'test-plugin'
      })

      expect(result.success).toBe(false)
    })
  })

  describe('parseMigrationRunnerOptions', () => {
    it('should parse valid options with defaults', () => {
      const result = parseMigrationRunnerOptions({})

      expect(result.dryRun).toBe(false)
      expect(result.useTransactions).toBe(false)
      expect(result.stopOnError).toBe(true)
      expect(result.verbose).toBe(true)
      expect(result.logger).toBeUndefined()
    })

    it('should parse options with custom values', () => {
      const logger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {}
      }

      const result = parseMigrationRunnerOptions({
        dryRun: true,
        logger,
        useTransactions: true,
        stopOnError: false,
        verbose: false
      })

      expect(result.dryRun).toBe(true)
      expect(result.logger).toBeDefined()
      expect(typeof result.logger?.trace).toBe('function')
      expect(typeof result.logger?.debug).toBe('function')
      expect(result.useTransactions).toBe(true)
      expect(result.stopOnError).toBe(false)
      expect(result.verbose).toBe(false)
    })

    it('should throw on invalid options', () => {
      expect(() => {
        parseMigrationRunnerOptions({ dryRun: 'not a boolean' })
      }).toThrow()
    })
  })

  describe('safeParseMigrationRunnerOptions', () => {
    it('should return success for valid options', () => {
      const result = safeParseMigrationRunnerOptions({
        dryRun: true
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.dryRun).toBe(true)
      }
    })

    it('should return error for invalid options', () => {
      const result = safeParseMigrationRunnerOptions({
        dryRun: 'not a boolean'
      })

      expect(result.success).toBe(false)
    })
  })

  describe('Comprehensive validation scenarios', () => {
    it('should validate complex runner options', () => {
      const logger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        customMethod: () => {}, // Extra method should be allowed
        context: { level: 'debug' } // Extra property should be allowed
      }

      const result = MigrationRunnerOptionsSchema.safeParse({
        dryRun: false,
        logger,
        useTransactions: true,
        stopOnError: true,
        verbose: true
      })

      expect(result.success).toBe(true)
    })

    it('should validate plugin with async arrow functions', () => {
      const plugin = {
        name: 'async-plugin',
        version: '2.0.0',
        beforeMigration: async (_migration: unknown) => {
          // Async hook implementation
          await Promise.resolve()
        },
        afterMigration: (_migration: unknown) => Promise.resolve()
      }

      const result = MigrationPluginSchema.safeParse(plugin)

      expect(result.success).toBe(true)
    })
  })
})
