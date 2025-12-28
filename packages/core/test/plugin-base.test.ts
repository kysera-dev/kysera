import { describe, it, expect, vi } from 'vitest'
import {
  createPluginConfig,
  createPluginMetadata,
  PLUGIN_PRIORITIES,
  type BasePluginOptions,
  type BasePluginOptionsWithPrimaryKey,
  type ResolvedPluginConfig,
  type PluginMetadata,
  type PluginPriority
} from '../src/plugin-base.js'
import { silentLogger, type KyseraLogger } from '../src/logger.js'

describe('plugin-base', () => {
  describe('createPluginConfig', () => {
    describe('with full options', () => {
      it('should create config with all options specified', () => {
        const customLogger: KyseraLogger = {
          trace: vi.fn(),
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          fatal: vi.fn()
        }

        const options: BasePluginOptionsWithPrimaryKey = {
          logger: customLogger,
          tables: ['users', 'posts'],
          excludeTables: ['migrations'],
          primaryKeyColumn: 'uuid'
        }

        const config = createPluginConfig('test-plugin', options)

        expect(config.name).toBe('test-plugin')
        expect(config.logger).toBe(customLogger)
        expect(config.tables).toEqual(['users', 'posts'])
        expect(config.excludeTables).toEqual(['migrations'])
        expect(config.primaryKeyColumn).toBe('uuid')
      })

      it('should preserve all provided values without modification', () => {
        const tables = ['table1', 'table2', 'table3']
        const excludeTables = ['exclude1', 'exclude2']

        const options: BasePluginOptionsWithPrimaryKey = {
          tables,
          excludeTables,
          primaryKeyColumn: 'custom_id'
        }

        const config = createPluginConfig('preserve-test', options)

        expect(config.tables).toEqual(tables)
        expect(config.excludeTables).toEqual(excludeTables)
        expect(config.primaryKeyColumn).toBe('custom_id')
      })
    })

    describe('with minimal options (defaults applied)', () => {
      it('should use silentLogger as default logger', () => {
        const config = createPluginConfig('default-logger-test', {})

        expect(config.logger).toBe(silentLogger)
      })

      it('should use undefined for tables by default', () => {
        const config = createPluginConfig('default-tables-test', {})

        expect(config.tables).toBeUndefined()
      })

      it('should use empty array for excludeTables by default', () => {
        const config = createPluginConfig('default-exclude-test', {})

        expect(config.excludeTables).toEqual([])
      })

      it('should use "id" for primaryKeyColumn by default', () => {
        const config = createPluginConfig('default-pk-test', {})

        expect(config.primaryKeyColumn).toBe('id')
      })

      it('should apply all defaults when empty options provided', () => {
        const config = createPluginConfig('all-defaults', {})

        expect(config.name).toBe('all-defaults')
        expect(config.logger).toBe(silentLogger)
        expect(config.tables).toBeUndefined()
        expect(config.excludeTables).toEqual([])
        expect(config.primaryKeyColumn).toBe('id')
      })
    })

    describe('with custom logger', () => {
      it('should use provided custom logger', () => {
        const customLogger: KyseraLogger = {
          trace: vi.fn(),
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          fatal: vi.fn()
        }

        const config = createPluginConfig('custom-logger', { logger: customLogger })

        expect(config.logger).toBe(customLogger)
        expect(config.logger).not.toBe(silentLogger)
      })

      it('should allow logger methods to be called', () => {
        const debugMock = vi.fn()
        const customLogger: KyseraLogger = {
          trace: vi.fn(),
          debug: debugMock,
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          fatal: vi.fn()
        }

        const config = createPluginConfig('callable-logger', { logger: customLogger })
        config.logger.debug('test message', { extra: 'data' })

        expect(debugMock).toHaveBeenCalledWith('test message', { extra: 'data' })
      })

      it('should prefer custom logger over default silentLogger', () => {
        const warnMock = vi.fn()
        const customLogger: KyseraLogger = {
          trace: vi.fn(),
          debug: vi.fn(),
          info: vi.fn(),
          warn: warnMock,
          error: vi.fn(),
          fatal: vi.fn()
        }

        const config = createPluginConfig('prefer-custom', { logger: customLogger })
        config.logger.warn('warning')

        expect(warnMock).toHaveBeenCalled()
      })
    })

    describe('table filtering (tables, excludeTables)', () => {
      it('should accept tables whitelist', () => {
        const config = createPluginConfig('whitelist-test', {
          tables: ['users', 'posts', 'comments']
        })

        expect(config.tables).toEqual(['users', 'posts', 'comments'])
      })

      it('should accept excludeTables blacklist', () => {
        const config = createPluginConfig('blacklist-test', {
          excludeTables: ['migrations', 'sessions', 'cache']
        })

        expect(config.excludeTables).toEqual(['migrations', 'sessions', 'cache'])
      })

      it('should accept both tables and excludeTables', () => {
        const config = createPluginConfig('both-lists-test', {
          tables: ['users'],
          excludeTables: ['migrations']
        })

        expect(config.tables).toEqual(['users'])
        expect(config.excludeTables).toEqual(['migrations'])
      })

      it('should handle empty tables array', () => {
        const config = createPluginConfig('empty-tables', {
          tables: []
        })

        expect(config.tables).toEqual([])
      })

      it('should handle empty excludeTables array', () => {
        const config = createPluginConfig('empty-exclude', {
          excludeTables: []
        })

        expect(config.excludeTables).toEqual([])
      })

      it('should handle single table in whitelist', () => {
        const config = createPluginConfig('single-table', {
          tables: ['users']
        })

        expect(config.tables).toEqual(['users'])
      })

      it('should handle tables with special characters', () => {
        const config = createPluginConfig('special-chars', {
          tables: ['user_data', 'my-table', 'schema.table']
        })

        expect(config.tables).toEqual(['user_data', 'my-table', 'schema.table'])
      })
    })

    describe('primaryKeyColumn handling', () => {
      it('should use "id" as default primaryKeyColumn', () => {
        const config = createPluginConfig('default-pk', {})

        expect(config.primaryKeyColumn).toBe('id')
      })

      it('should accept custom primaryKeyColumn', () => {
        const options: BasePluginOptionsWithPrimaryKey = {
          primaryKeyColumn: 'uuid'
        }
        const config = createPluginConfig('custom-pk', options)

        expect(config.primaryKeyColumn).toBe('uuid')
      })

      it('should handle various primaryKeyColumn names', () => {
        const testCases = ['uuid', 'user_id', 'ID', '_id', 'pk']

        for (const pkColumn of testCases) {
          const options: BasePluginOptionsWithPrimaryKey = {
            primaryKeyColumn: pkColumn
          }
          const config = createPluginConfig(`pk-${pkColumn}`, options)

          expect(config.primaryKeyColumn).toBe(pkColumn)
        }
      })

      it('should work with BasePluginOptions (no primaryKeyColumn)', () => {
        const options: BasePluginOptions = {
          tables: ['users']
        }
        const config = createPluginConfig('base-options', options)

        // Should default to 'id' when using BasePluginOptions
        expect(config.primaryKeyColumn).toBe('id')
      })

      it('should work with BasePluginOptionsWithPrimaryKey', () => {
        const options: BasePluginOptionsWithPrimaryKey = {
          tables: ['users'],
          primaryKeyColumn: 'entity_id'
        }
        const config = createPluginConfig('with-pk-options', options)

        expect(config.primaryKeyColumn).toBe('entity_id')
      })
    })

    describe('ResolvedPluginConfig interface', () => {
      it('should return object conforming to ResolvedPluginConfig', () => {
        const config: ResolvedPluginConfig = createPluginConfig('interface-test', {
          tables: ['users'],
          excludeTables: ['migrations']
        })

        expect(config.name).toBeDefined()
        expect(config.logger).toBeDefined()
        expect(config.excludeTables).toBeDefined()
        expect(config.primaryKeyColumn).toBeDefined()
        // tables can be undefined
      })

      it('should have all required properties', () => {
        const config = createPluginConfig('required-props', {})

        expect(typeof config.name).toBe('string')
        expect(typeof config.logger).toBe('object')
        expect(Array.isArray(config.excludeTables)).toBe(true)
        expect(typeof config.primaryKeyColumn).toBe('string')
      })
    })
  })

  describe('createPluginMetadata', () => {
    describe('with full options', () => {
      it('should create metadata with all options specified', () => {
        const metadata = createPluginMetadata('test-plugin', '1.0.0', {
          dependencies: ['dep1', 'dep2'],
          priority: 100,
          conflictsWith: ['conflict1', 'conflict2']
        })

        expect(metadata.name).toBe('test-plugin')
        expect(metadata.version).toBe('1.0.0')
        expect(metadata.dependencies).toEqual(['dep1', 'dep2'])
        expect(metadata.priority).toBe(100)
        expect(metadata.conflictsWith).toEqual(['conflict1', 'conflict2'])
      })

      it('should preserve exact values without modification', () => {
        const metadata = createPluginMetadata('preserve-test', '2.5.3', {
          dependencies: ['@kysera/core', '@kysera/executor'],
          priority: PLUGIN_PRIORITIES.SECURITY,
          conflictsWith: ['unsafe-plugin']
        })

        expect(metadata.version).toBe('2.5.3')
        expect(metadata.priority).toBe(1000)
        expect(metadata.dependencies).toHaveLength(2)
      })
    })

    describe('with minimal options', () => {
      it('should create metadata with only name and version', () => {
        const metadata = createPluginMetadata('minimal-plugin', '0.1.0')

        expect(metadata.name).toBe('minimal-plugin')
        expect(metadata.version).toBe('0.1.0')
      })

      it('should not include optional properties when not provided', () => {
        const metadata = createPluginMetadata('no-optional', '1.0.0')

        // Optional properties should be undefined (not present)
        expect(metadata.dependencies).toBeUndefined()
        expect(metadata.priority).toBeUndefined()
        expect(metadata.conflictsWith).toBeUndefined()
      })

      it('should not include dependencies when not specified', () => {
        const metadata = createPluginMetadata('no-deps', '1.0.0', {
          priority: 50
        })

        expect(metadata.dependencies).toBeUndefined()
        expect(metadata.priority).toBe(50)
      })

      it('should not include priority when not specified', () => {
        const metadata = createPluginMetadata('no-priority', '1.0.0', {
          dependencies: ['dep1']
        })

        expect(metadata.priority).toBeUndefined()
        expect(metadata.dependencies).toEqual(['dep1'])
      })

      it('should not include conflictsWith when not specified', () => {
        const metadata = createPluginMetadata('no-conflicts', '1.0.0', {
          priority: 100
        })

        expect(metadata.conflictsWith).toBeUndefined()
      })

      it('should handle empty options object', () => {
        const metadata = createPluginMetadata('empty-options', '1.0.0', {})

        expect(metadata.name).toBe('empty-options')
        expect(metadata.version).toBe('1.0.0')
        expect(metadata.dependencies).toBeUndefined()
        expect(metadata.priority).toBeUndefined()
        expect(metadata.conflictsWith).toBeUndefined()
      })
    })

    describe('dependencies and conflictsWith', () => {
      it('should accept single dependency', () => {
        const metadata = createPluginMetadata('single-dep', '1.0.0', {
          dependencies: ['@kysera/core']
        })

        expect(metadata.dependencies).toEqual(['@kysera/core'])
      })

      it('should accept multiple dependencies', () => {
        const metadata = createPluginMetadata('multi-dep', '1.0.0', {
          dependencies: ['@kysera/core', '@kysera/executor', '@kysera/dal']
        })

        expect(metadata.dependencies).toHaveLength(3)
        expect(metadata.dependencies).toContain('@kysera/core')
        expect(metadata.dependencies).toContain('@kysera/executor')
      })

      it('should accept empty dependencies array', () => {
        const metadata = createPluginMetadata('empty-deps', '1.0.0', {
          dependencies: []
        })

        expect(metadata.dependencies).toEqual([])
      })

      it('should accept single conflict', () => {
        const metadata = createPluginMetadata('single-conflict', '1.0.0', {
          conflictsWith: ['incompatible-plugin']
        })

        expect(metadata.conflictsWith).toEqual(['incompatible-plugin'])
      })

      it('should accept multiple conflicts', () => {
        const metadata = createPluginMetadata('multi-conflict', '1.0.0', {
          conflictsWith: ['plugin-a', 'plugin-b', 'plugin-c']
        })

        expect(metadata.conflictsWith).toHaveLength(3)
      })

      it('should accept empty conflictsWith array', () => {
        const metadata = createPluginMetadata('empty-conflicts', '1.0.0', {
          conflictsWith: []
        })

        expect(metadata.conflictsWith).toEqual([])
      })

      it('should accept both dependencies and conflicts', () => {
        const metadata = createPluginMetadata('both', '1.0.0', {
          dependencies: ['required-plugin'],
          conflictsWith: ['incompatible-plugin']
        })

        expect(metadata.dependencies).toEqual(['required-plugin'])
        expect(metadata.conflictsWith).toEqual(['incompatible-plugin'])
      })

      it('should preserve readonly arrays', () => {
        const deps: readonly string[] = ['dep1', 'dep2']
        const conflicts: readonly string[] = ['conflict1']

        const metadata = createPluginMetadata('readonly-test', '1.0.0', {
          dependencies: deps,
          conflictsWith: conflicts
        })

        expect(metadata.dependencies).toEqual(['dep1', 'dep2'])
        expect(metadata.conflictsWith).toEqual(['conflict1'])
      })
    })

    describe('PluginMetadata interface', () => {
      it('should return object conforming to PluginMetadata', () => {
        const metadata: PluginMetadata = createPluginMetadata('interface-test', '1.0.0', {
          priority: 100
        })

        expect(metadata.name).toBeDefined()
        expect(metadata.version).toBeDefined()
      })

      it('should have required name and version', () => {
        const metadata = createPluginMetadata('required-test', '2.0.0')

        expect(typeof metadata.name).toBe('string')
        expect(typeof metadata.version).toBe('string')
      })
    })

    describe('version format handling', () => {
      it('should accept semver versions', () => {
        const versions = ['0.0.1', '1.0.0', '1.2.3', '10.20.30']

        for (const version of versions) {
          const metadata = createPluginMetadata('semver-test', version)
          expect(metadata.version).toBe(version)
        }
      })

      it('should accept prerelease versions', () => {
        const metadata = createPluginMetadata('prerelease', '1.0.0-beta.1')

        expect(metadata.version).toBe('1.0.0-beta.1')
      })

      it('should accept build metadata versions', () => {
        const metadata = createPluginMetadata('build-meta', '1.0.0+build.123')

        expect(metadata.version).toBe('1.0.0+build.123')
      })
    })
  })

  describe('PLUGIN_PRIORITIES', () => {
    describe('values', () => {
      it('should have SECURITY priority of 1000', () => {
        expect(PLUGIN_PRIORITIES.SECURITY).toBe(1000)
      })

      it('should have FILTER priority of 500', () => {
        expect(PLUGIN_PRIORITIES.FILTER).toBe(500)
      })

      it('should have TRANSFORM priority of 100', () => {
        expect(PLUGIN_PRIORITIES.TRANSFORM).toBe(100)
      })

      it('should have AUDIT priority of 50', () => {
        expect(PLUGIN_PRIORITIES.AUDIT).toBe(50)
      })

      it('should have DEFAULT priority of 0', () => {
        expect(PLUGIN_PRIORITIES.DEFAULT).toBe(0)
      })

      it('should have DEBUG priority of -100', () => {
        expect(PLUGIN_PRIORITIES.DEBUG).toBe(-100)
      })
    })

    describe('ordering', () => {
      it('should have SECURITY > FILTER > TRANSFORM > AUDIT > DEFAULT > DEBUG', () => {
        expect(PLUGIN_PRIORITIES.SECURITY).toBeGreaterThan(PLUGIN_PRIORITIES.FILTER)
        expect(PLUGIN_PRIORITIES.FILTER).toBeGreaterThan(PLUGIN_PRIORITIES.TRANSFORM)
        expect(PLUGIN_PRIORITIES.TRANSFORM).toBeGreaterThan(PLUGIN_PRIORITIES.AUDIT)
        expect(PLUGIN_PRIORITIES.AUDIT).toBeGreaterThan(PLUGIN_PRIORITIES.DEFAULT)
        expect(PLUGIN_PRIORITIES.DEFAULT).toBeGreaterThan(PLUGIN_PRIORITIES.DEBUG)
      })

      it('should sort plugins correctly by priority (highest first)', () => {
        const plugins = [
          { name: 'debug', priority: PLUGIN_PRIORITIES.DEBUG },
          { name: 'security', priority: PLUGIN_PRIORITIES.SECURITY },
          { name: 'filter', priority: PLUGIN_PRIORITIES.FILTER },
          { name: 'default', priority: PLUGIN_PRIORITIES.DEFAULT },
          { name: 'audit', priority: PLUGIN_PRIORITIES.AUDIT },
          { name: 'transform', priority: PLUGIN_PRIORITIES.TRANSFORM }
        ]

        const sorted = [...plugins].sort((a, b) => b.priority - a.priority)

        expect(sorted[0]?.name).toBe('security')
        expect(sorted[1]?.name).toBe('filter')
        expect(sorted[2]?.name).toBe('transform')
        expect(sorted[3]?.name).toBe('audit')
        expect(sorted[4]?.name).toBe('default')
        expect(sorted[5]?.name).toBe('debug')
      })
    })

    describe('const assertion', () => {
      it('should be readonly (as const)', () => {
        // TypeScript ensures this at compile time, but we can verify the values are stable
        const priorities = { ...PLUGIN_PRIORITIES }

        expect(priorities.SECURITY).toBe(1000)
        expect(priorities.FILTER).toBe(500)
        expect(priorities.TRANSFORM).toBe(100)
        expect(priorities.AUDIT).toBe(50)
        expect(priorities.DEFAULT).toBe(0)
        expect(priorities.DEBUG).toBe(-100)
      })
    })

    describe('PluginPriority type', () => {
      it('should accept valid priority values', () => {
        const security: PluginPriority = PLUGIN_PRIORITIES.SECURITY
        const filter: PluginPriority = PLUGIN_PRIORITIES.FILTER
        const transform: PluginPriority = PLUGIN_PRIORITIES.TRANSFORM
        const audit: PluginPriority = PLUGIN_PRIORITIES.AUDIT
        const defaultPriority: PluginPriority = PLUGIN_PRIORITIES.DEFAULT
        const debug: PluginPriority = PLUGIN_PRIORITIES.DEBUG

        expect(security).toBe(1000)
        expect(filter).toBe(500)
        expect(transform).toBe(100)
        expect(audit).toBe(50)
        expect(defaultPriority).toBe(0)
        expect(debug).toBe(-100)
      })

      it('should be usable in createPluginMetadata', () => {
        const metadata = createPluginMetadata('priority-type-test', '1.0.0', {
          priority: PLUGIN_PRIORITIES.SECURITY
        })

        expect(metadata.priority).toBe(1000)
      })
    })
  })

  describe('edge cases and type safety', () => {
    describe('createPluginConfig edge cases', () => {
      it('should handle very long plugin names', () => {
        const longName = 'a'.repeat(1000)
        const config = createPluginConfig(longName, {})

        expect(config.name).toBe(longName)
        expect(config.name.length).toBe(1000)
      })

      it('should handle special characters in plugin names', () => {
        const specialNames = ['my-plugin', 'my_plugin', 'my.plugin', '@scope/plugin', 'plugin:v1']

        for (const name of specialNames) {
          const config = createPluginConfig(name, {})
          expect(config.name).toBe(name)
        }
      })

      it('should handle empty string plugin name', () => {
        const config = createPluginConfig('', {})

        expect(config.name).toBe('')
      })

      it('should handle very large tables array', () => {
        const tables = Array.from({ length: 1000 }, (_, i) => `table_${i}`)
        const config = createPluginConfig('large-tables', { tables })

        expect(config.tables?.length).toBe(1000)
      })

      it('should handle very large excludeTables array', () => {
        const excludeTables = Array.from({ length: 500 }, (_, i) => `exclude_${i}`)
        const config = createPluginConfig('large-exclude', { excludeTables })

        expect(config.excludeTables.length).toBe(500)
      })
    })

    describe('createPluginMetadata edge cases', () => {
      it('should handle very long plugin names', () => {
        const longName = 'plugin-'.repeat(100)
        const metadata = createPluginMetadata(longName, '1.0.0')

        expect(metadata.name).toBe(longName)
      })

      it('should handle empty string plugin name', () => {
        const metadata = createPluginMetadata('', '1.0.0')

        expect(metadata.name).toBe('')
      })

      it('should handle empty string version', () => {
        const metadata = createPluginMetadata('test', '')

        expect(metadata.version).toBe('')
      })

      it('should handle negative priority', () => {
        const metadata = createPluginMetadata('negative-priority', '1.0.0', {
          priority: -500
        })

        expect(metadata.priority).toBe(-500)
      })

      it('should handle zero priority', () => {
        const metadata = createPluginMetadata('zero-priority', '1.0.0', {
          priority: 0
        })

        expect(metadata.priority).toBe(0)
      })

      it('should handle very large priority', () => {
        const metadata = createPluginMetadata('large-priority', '1.0.0', {
          priority: 1000000
        })

        expect(metadata.priority).toBe(1000000)
      })

      it('should handle many dependencies', () => {
        const dependencies = Array.from({ length: 100 }, (_, i) => `dep-${i}`)
        const metadata = createPluginMetadata('many-deps', '1.0.0', { dependencies })

        expect(metadata.dependencies?.length).toBe(100)
      })

      it('should handle many conflicts', () => {
        const conflictsWith = Array.from({ length: 50 }, (_, i) => `conflict-${i}`)
        const metadata = createPluginMetadata('many-conflicts', '1.0.0', { conflictsWith })

        expect(metadata.conflictsWith?.length).toBe(50)
      })
    })

    describe('type safety', () => {
      it('should maintain type safety for ResolvedPluginConfig', () => {
        const options: BasePluginOptionsWithPrimaryKey = {
          tables: ['users'],
          primaryKeyColumn: 'id'
        }
        const config = createPluginConfig('type-safe', options)

        // These should all be correctly typed
        const name: string = config.name
        const logger: KyseraLogger = config.logger
        const tables: string[] | undefined = config.tables
        const excludeTables: string[] = config.excludeTables
        const primaryKeyColumn: string = config.primaryKeyColumn

        expect(typeof name).toBe('string')
        expect(typeof logger).toBe('object')
        expect(Array.isArray(tables)).toBe(true)
        expect(Array.isArray(excludeTables)).toBe(true)
        expect(typeof primaryKeyColumn).toBe('string')
      })

      it('should maintain type safety for PluginMetadata', () => {
        const metadata = createPluginMetadata('type-safe', '1.0.0', {
          dependencies: ['dep1'],
          priority: 100,
          conflictsWith: ['conflict1']
        })

        // These should all be correctly typed
        const name: string = metadata.name
        const version: string = metadata.version
        const deps: readonly string[] | undefined = metadata.dependencies
        const priority: number | undefined = metadata.priority
        const conflicts: readonly string[] | undefined = metadata.conflictsWith

        expect(typeof name).toBe('string')
        expect(typeof version).toBe('string')
        expect(Array.isArray(deps)).toBe(true)
        expect(typeof priority).toBe('number')
        expect(Array.isArray(conflicts)).toBe(true)
      })

      it('should accept generic type extending BasePluginOptions', () => {
        interface CustomPluginOptions extends BasePluginOptions {
          customOption: string
          anotherOption?: number
        }

        const options: CustomPluginOptions = {
          customOption: 'value',
          anotherOption: 42,
          tables: ['users']
        }

        const config = createPluginConfig('custom', options)

        expect(config.name).toBe('custom')
        expect(config.tables).toEqual(['users'])
      })
    })

    describe('integration scenarios', () => {
      it('should work for soft-delete plugin configuration', () => {
        interface SoftDeleteOptions extends BasePluginOptionsWithPrimaryKey {
          deletedAtColumn?: string
          includeDeleted?: boolean
        }

        const options: SoftDeleteOptions = {
          tables: ['users', 'posts'],
          excludeTables: ['audit_logs'],
          primaryKeyColumn: 'id',
          deletedAtColumn: 'deleted_at',
          includeDeleted: false
        }

        const config = createPluginConfig('soft-delete', options)
        const metadata = createPluginMetadata('soft-delete', '0.8.0', {
          priority: PLUGIN_PRIORITIES.FILTER,
          dependencies: ['@kysera/executor']
        })

        expect(config.name).toBe('soft-delete')
        expect(config.tables).toEqual(['users', 'posts'])
        expect(config.primaryKeyColumn).toBe('id')
        expect(metadata.priority).toBe(500)
      })

      it('should work for audit plugin configuration', () => {
        interface AuditOptions extends BasePluginOptionsWithPrimaryKey {
          auditTableName?: string
          captureOldValues?: boolean
        }

        const options: AuditOptions = {
          tables: ['users', 'orders', 'payments'],
          primaryKeyColumn: 'uuid',
          auditTableName: 'audit_logs',
          captureOldValues: true
        }

        const config = createPluginConfig('audit', options)
        const metadata = createPluginMetadata('audit', '0.8.0', {
          priority: PLUGIN_PRIORITIES.AUDIT,
          conflictsWith: ['simple-audit']
        })

        expect(config.name).toBe('audit')
        expect(config.primaryKeyColumn).toBe('uuid')
        expect(metadata.priority).toBe(50)
        expect(metadata.conflictsWith).toEqual(['simple-audit'])
      })

      it('should work for RLS plugin configuration', () => {
        interface RLSOptions extends BasePluginOptions {
          tenantColumn: string
          getTenantId: () => string
        }

        const options: RLSOptions = {
          excludeTables: ['public_data', 'configurations'],
          tenantColumn: 'tenant_id',
          getTenantId: () => 'tenant-123'
        }

        const config = createPluginConfig('rls', options)
        const metadata = createPluginMetadata('rls', '0.8.0', {
          priority: PLUGIN_PRIORITIES.SECURITY,
          dependencies: ['@kysera/executor']
        })

        expect(config.name).toBe('rls')
        expect(config.excludeTables).toEqual(['public_data', 'configurations'])
        expect(metadata.priority).toBe(1000)
      })

      it('should work for debug plugin configuration', () => {
        const customLogger: KyseraLogger = {
          trace: vi.fn(),
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          fatal: vi.fn()
        }

        const config = createPluginConfig('debug', {
          logger: customLogger,
          excludeTables: ['_internal']
        })

        const metadata = createPluginMetadata('debug', '0.8.0', {
          priority: PLUGIN_PRIORITIES.DEBUG
        })

        expect(config.logger).toBe(customLogger)
        expect(metadata.priority).toBe(-100)
      })

      it('should work for timestamps plugin configuration', () => {
        interface TimestampsOptions extends BasePluginOptions {
          createdAtColumn?: string
          updatedAtColumn?: string
        }

        const options: TimestampsOptions = {
          excludeTables: ['kysely_migration', 'kysely_migration_lock'],
          createdAtColumn: 'created_at',
          updatedAtColumn: 'updated_at'
        }

        const config = createPluginConfig('timestamps', options)
        const metadata = createPluginMetadata('timestamps', '0.8.0', {
          priority: PLUGIN_PRIORITIES.TRANSFORM
        })

        expect(config.name).toBe('timestamps')
        expect(config.excludeTables).toContain('kysely_migration')
        expect(metadata.priority).toBe(100)
      })
    })
  })
})
