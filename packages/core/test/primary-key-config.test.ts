import { describe, it, expect } from 'vitest'
import type { PrimaryKeyConfig } from '../src/types.js'

describe('PrimaryKeyConfig', () => {
  describe('type safety', () => {
    it('should allow undefined primaryKeyColumn (uses default)', () => {
      const config: PrimaryKeyConfig = {}
      expect(config.primaryKeyColumn).toBeUndefined()
    })

    it('should allow single string column', () => {
      const config: PrimaryKeyConfig = {
        primaryKeyColumn: 'id'
      }
      expect(config.primaryKeyColumn).toBe('id')
    })

    it('should allow custom column name', () => {
      const config: PrimaryKeyConfig = {
        primaryKeyColumn: 'user_id'
      }
      expect(config.primaryKeyColumn).toBe('user_id')
    })

    it('should allow UUID column', () => {
      const config: PrimaryKeyConfig = {
        primaryKeyColumn: 'uuid'
      }
      expect(config.primaryKeyColumn).toBe('uuid')
    })

    it('should allow array of columns for composite keys', () => {
      const config: PrimaryKeyConfig = {
        primaryKeyColumn: ['organization_id', 'user_id']
      }
      expect(config.primaryKeyColumn).toEqual(['organization_id', 'user_id'])
    })

    it('should allow empty array (though not recommended)', () => {
      const config: PrimaryKeyConfig = {
        primaryKeyColumn: []
      }
      expect(config.primaryKeyColumn).toEqual([])
    })

    it('should allow single-item array', () => {
      const config: PrimaryKeyConfig = {
        primaryKeyColumn: ['id']
      }
      expect(config.primaryKeyColumn).toEqual(['id'])
    })

    it('should allow multi-column composite key', () => {
      const config: PrimaryKeyConfig = {
        primaryKeyColumn: ['tenant_id', 'entity_id', 'version']
      }
      expect(config.primaryKeyColumn).toEqual(['tenant_id', 'entity_id', 'version'])
    })
  })

  describe('extension pattern', () => {
    it('should be extendable by plugin configs', () => {
      interface SoftDeleteConfig extends PrimaryKeyConfig {
        deletedAtColumn?: string
        includeDeleted?: boolean
      }

      const config: SoftDeleteConfig = {
        primaryKeyColumn: 'id',
        deletedAtColumn: 'deleted_at',
        includeDeleted: false
      }

      expect(config.primaryKeyColumn).toBe('id')
      expect(config.deletedAtColumn).toBe('deleted_at')
      expect(config.includeDeleted).toBe(false)
    })

    it('should work with audit plugin config', () => {
      interface AuditConfig extends PrimaryKeyConfig {
        auditTable?: string
        captureOldValues?: boolean
      }

      const config: AuditConfig = {
        primaryKeyColumn: 'uuid',
        auditTable: 'audit_log',
        captureOldValues: true
      }

      expect(config.primaryKeyColumn).toBe('uuid')
      expect(config.auditTable).toBe('audit_log')
      expect(config.captureOldValues).toBe(true)
    })

    it('should work with timestamps plugin config', () => {
      interface TimestampsConfig extends PrimaryKeyConfig {
        createdAtColumn?: string
        updatedAtColumn?: string
      }

      const config: TimestampsConfig = {
        primaryKeyColumn: 'id',
        createdAtColumn: 'created_at',
        updatedAtColumn: 'updated_at'
      }

      expect(config.primaryKeyColumn).toBe('id')
      expect(config.createdAtColumn).toBe('created_at')
      expect(config.updatedAtColumn).toBe('updated_at')
    })

    it('should support multiple plugins extending PrimaryKeyConfig', () => {
      interface CombinedConfig extends PrimaryKeyConfig {
        softDelete?: boolean
        audit?: boolean
        timestamps?: boolean
      }

      const config: CombinedConfig = {
        primaryKeyColumn: ['tenant_id', 'id'],
        softDelete: true,
        audit: true,
        timestamps: true
      }

      expect(config.primaryKeyColumn).toEqual(['tenant_id', 'id'])
      expect(config.softDelete).toBe(true)
      expect(config.audit).toBe(true)
      expect(config.timestamps).toBe(true)
    })
  })

  describe('type narrowing', () => {
    it('should narrow string type', () => {
      const config: PrimaryKeyConfig = {
        primaryKeyColumn: 'id'
      }

      if (typeof config.primaryKeyColumn === 'string') {
        // Type should be narrowed to string
        const _columnName: string = config.primaryKeyColumn
        expect(_columnName).toBe('id')
      } else {
        throw new Error('Expected string')
      }
    })

    it('should narrow array type', () => {
      const config: PrimaryKeyConfig = {
        primaryKeyColumn: ['org_id', 'user_id']
      }

      if (Array.isArray(config.primaryKeyColumn)) {
        // Type should be narrowed to string[]
        const _columns: string[] = config.primaryKeyColumn
        expect(_columns).toEqual(['org_id', 'user_id'])
      } else {
        throw new Error('Expected array')
      }
    })

    it('should handle undefined', () => {
      const config: PrimaryKeyConfig = {}

      if (config.primaryKeyColumn === undefined) {
        // Type should be narrowed to undefined
        expect(config.primaryKeyColumn).toBeUndefined()
      } else {
        throw new Error('Expected undefined')
      }
    })
  })

  describe('utility functions', () => {
    it('should support helper function for single vs composite keys', () => {
      function isSingleColumn(config: PrimaryKeyConfig): boolean {
        return typeof config.primaryKeyColumn === 'string'
      }

      function isCompositeKey(config: PrimaryKeyConfig): boolean {
        return Array.isArray(config.primaryKeyColumn)
      }

      const singleConfig: PrimaryKeyConfig = { primaryKeyColumn: 'id' }
      const compositeConfig: PrimaryKeyConfig = {
        primaryKeyColumn: ['org_id', 'user_id']
      }
      const defaultConfig: PrimaryKeyConfig = {}

      expect(isSingleColumn(singleConfig)).toBe(true)
      expect(isCompositeKey(singleConfig)).toBe(false)

      expect(isSingleColumn(compositeConfig)).toBe(false)
      expect(isCompositeKey(compositeConfig)).toBe(true)

      expect(isSingleColumn(defaultConfig)).toBe(false)
      expect(isCompositeKey(defaultConfig)).toBe(false)
    })

    it('should support helper function to normalize to array', () => {
      function getPrimaryKeyColumns(config: PrimaryKeyConfig): string[] {
        if (!config.primaryKeyColumn) {
          return ['id'] // Default
        }
        return Array.isArray(config.primaryKeyColumn)
          ? config.primaryKeyColumn
          : [config.primaryKeyColumn]
      }

      expect(getPrimaryKeyColumns({})).toEqual(['id'])
      expect(getPrimaryKeyColumns({ primaryKeyColumn: 'uuid' })).toEqual(['uuid'])
      expect(getPrimaryKeyColumns({ primaryKeyColumn: ['a', 'b'] })).toEqual(['a', 'b'])
    })

    it('should support helper function to get first column', () => {
      function getFirstPrimaryKeyColumn(config: PrimaryKeyConfig): string {
        if (!config.primaryKeyColumn) {
          return 'id' // Default
        }
        return Array.isArray(config.primaryKeyColumn)
          ? config.primaryKeyColumn[0]!
          : config.primaryKeyColumn
      }

      expect(getFirstPrimaryKeyColumn({})).toBe('id')
      expect(getFirstPrimaryKeyColumn({ primaryKeyColumn: 'uuid' })).toBe('uuid')
      expect(getFirstPrimaryKeyColumn({ primaryKeyColumn: ['a', 'b', 'c'] })).toBe('a')
    })
  })

  describe('real-world scenarios', () => {
    it('should support multi-tenant application pattern', () => {
      interface MultiTenantConfig extends PrimaryKeyConfig {
        tenantColumn: string
      }

      const config: MultiTenantConfig = {
        primaryKeyColumn: ['organization_id', 'user_id'],
        tenantColumn: 'organization_id'
      }

      expect(config.primaryKeyColumn).toEqual(['organization_id', 'user_id'])
      expect(config.tenantColumn).toBe('organization_id')
    })

    it('should support time-series data pattern', () => {
      interface TimeSeriesConfig extends PrimaryKeyConfig {
        timestampColumn: string
        retention: number
      }

      const config: TimeSeriesConfig = {
        primaryKeyColumn: ['device_id', 'timestamp'],
        timestampColumn: 'timestamp',
        retention: 30 // days
      }

      expect(config.primaryKeyColumn).toEqual(['device_id', 'timestamp'])
      expect(config.timestampColumn).toBe('timestamp')
      expect(config.retention).toBe(30)
    })

    it('should support UUID-based systems', () => {
      interface UUIDSystemConfig extends PrimaryKeyConfig {
        generateUUID: () => string
      }

      const config: UUIDSystemConfig = {
        primaryKeyColumn: 'uuid',
        generateUUID: () => 'generated-uuid'
      }

      expect(config.primaryKeyColumn).toBe('uuid')
      expect(config.generateUUID()).toBe('generated-uuid')
    })

    it('should support prefixed ID naming convention', () => {
      interface PrefixedIDConfig extends PrimaryKeyConfig {
        tableName: string
      }

      const userConfig: PrefixedIDConfig = {
        primaryKeyColumn: 'user_id',
        tableName: 'users'
      }

      const postConfig: PrefixedIDConfig = {
        primaryKeyColumn: 'post_id',
        tableName: 'posts'
      }

      expect(userConfig.primaryKeyColumn).toBe('user_id')
      expect(postConfig.primaryKeyColumn).toBe('post_id')
    })
  })

  describe('documentation compliance', () => {
    it('should match specification examples', () => {
      // Example from SECURITY_FIXES_REMAINING.md L-8
      const config: PrimaryKeyConfig = {
        primaryKeyColumn: 'id'
      }
      expect(config.primaryKeyColumn).toBe('id')
    })

    it('should support both string and array as specified', () => {
      const stringConfig: PrimaryKeyConfig = {
        primaryKeyColumn: 'id'
      }

      const arrayConfig: PrimaryKeyConfig = {
        primaryKeyColumn: ['org_id', 'user_id']
      }

      // Verify types are accepted
      expect(typeof stringConfig.primaryKeyColumn).toBe('string')
      expect(Array.isArray(arrayConfig.primaryKeyColumn)).toBe(true)
    })
  })
})
