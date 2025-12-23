import { describe, it, expect } from 'vitest'
import type { PrimaryKeyConfig } from '../src/types.js'

/**
 * Examples showing how plugins can extend PrimaryKeyConfig
 * These examples demonstrate the intended usage pattern for plugin authors
 */

describe('PrimaryKeyConfig - Plugin Extension Examples', () => {
  describe('Soft-Delete Plugin', () => {
    interface SoftDeleteOptions extends PrimaryKeyConfig {
      deletedAtColumn?: string
      includeDeleted?: boolean
      tables?: string[]
    }

    it('should work with default id column', () => {
      const config: SoftDeleteOptions = {
        deletedAtColumn: 'deleted_at'
        // primaryKeyColumn defaults to 'id'
      }

      expect(config.deletedAtColumn).toBe('deleted_at')
      expect(config.primaryKeyColumn).toBeUndefined() // Will use 'id' as default
    })

    it('should work with custom primary key', () => {
      const config: SoftDeleteOptions = {
        primaryKeyColumn: 'uuid',
        deletedAtColumn: 'deleted_at',
        includeDeleted: false
      }

      expect(config.primaryKeyColumn).toBe('uuid')
      expect(config.deletedAtColumn).toBe('deleted_at')
      expect(config.includeDeleted).toBe(false)
    })

    it('should work with composite primary key', () => {
      const config: SoftDeleteOptions = {
        primaryKeyColumn: ['tenant_id', 'user_id'],
        deletedAtColumn: 'deleted_at',
        tables: ['users', 'posts']
      }

      expect(config.primaryKeyColumn).toEqual(['tenant_id', 'user_id'])
      expect(config.tables).toEqual(['users', 'posts'])
    })
  })

  describe('Audit Plugin', () => {
    interface AuditOptions extends PrimaryKeyConfig {
      auditTable?: string
      captureOldValues?: boolean
      captureNewValues?: boolean
      skipSystemOperations?: boolean
      tables?: string[]
    }

    it('should work with UUID primary keys', () => {
      const config: AuditOptions = {
        primaryKeyColumn: 'uuid',
        auditTable: 'audit_log',
        captureOldValues: true,
        captureNewValues: true
      }

      expect(config.primaryKeyColumn).toBe('uuid')
      expect(config.auditTable).toBe('audit_log')
      expect(config.captureOldValues).toBe(true)
    })

    it('should work with prefixed ID columns', () => {
      const config: AuditOptions = {
        primaryKeyColumn: 'user_id',
        auditTable: 'user_audit',
        skipSystemOperations: true
      }

      expect(config.primaryKeyColumn).toBe('user_id')
      expect(config.skipSystemOperations).toBe(true)
    })

    it('should work with composite keys for multi-tenant systems', () => {
      const config: AuditOptions = {
        primaryKeyColumn: ['organization_id', 'user_id'],
        auditTable: 'audit_log',
        captureOldValues: true,
        tables: ['users', 'roles', 'permissions']
      }

      expect(config.primaryKeyColumn).toEqual(['organization_id', 'user_id'])
      expect(config.tables).toHaveLength(3)
    })
  })

  describe('Timestamps Plugin', () => {
    interface TimestampsOptions extends PrimaryKeyConfig {
      createdAtColumn?: string
      updatedAtColumn?: string
      setUpdatedAtOnInsert?: boolean
      tables?: string[]
      excludeTables?: string[]
    }

    it('should work with standard configuration', () => {
      const config: TimestampsOptions = {
        createdAtColumn: 'created_at',
        updatedAtColumn: 'updated_at',
        setUpdatedAtOnInsert: true
      }

      expect(config.createdAtColumn).toBe('created_at')
      expect(config.updatedAtColumn).toBe('updated_at')
      expect(config.setUpdatedAtOnInsert).toBe(true)
    })

    it('should work with custom primary key for touch() method', () => {
      const config: TimestampsOptions = {
        primaryKeyColumn: 'document_id',
        updatedAtColumn: 'last_modified'
      }

      expect(config.primaryKeyColumn).toBe('document_id')
      expect(config.updatedAtColumn).toBe('last_modified')
    })

    it('should work with time-series composite keys', () => {
      const config: TimestampsOptions = {
        primaryKeyColumn: ['device_id', 'timestamp'],
        createdAtColumn: 'inserted_at',
        tables: ['sensor_readings', 'device_logs']
      }

      expect(config.primaryKeyColumn).toEqual(['device_id', 'timestamp'])
      expect(config.tables).toEqual(['sensor_readings', 'device_logs'])
    })
  })

  describe('Custom Plugin Examples', () => {
    it('should support RLS (Row-Level Security) plugin', () => {
      interface RLSOptions extends PrimaryKeyConfig {
        tenantColumn: string
        enableSuperuserBypass?: boolean
      }

      const config: RLSOptions = {
        primaryKeyColumn: ['tenant_id', 'id'],
        tenantColumn: 'tenant_id',
        enableSuperuserBypass: true
      }

      expect(config.primaryKeyColumn).toEqual(['tenant_id', 'id'])
      expect(config.tenantColumn).toBe('tenant_id')
      expect(config.enableSuperuserBypass).toBe(true)
    })

    it('should support versioning plugin', () => {
      interface VersioningOptions extends PrimaryKeyConfig {
        versionColumn: string
        autoIncrement?: boolean
      }

      const config: VersioningOptions = {
        primaryKeyColumn: 'document_id',
        versionColumn: 'version',
        autoIncrement: true
      }

      expect(config.primaryKeyColumn).toBe('document_id')
      expect(config.versionColumn).toBe('version')
      expect(config.autoIncrement).toBe(true)
    })

    it('should support encryption plugin', () => {
      interface EncryptionOptions extends PrimaryKeyConfig {
        encryptedColumns: string[]
        algorithm: 'aes-256-gcm' | 'aes-128-gcm'
      }

      const config: EncryptionOptions = {
        primaryKeyColumn: 'id',
        encryptedColumns: ['ssn', 'credit_card', 'phone'],
        algorithm: 'aes-256-gcm'
      }

      expect(config.primaryKeyColumn).toBe('id')
      expect(config.encryptedColumns).toHaveLength(3)
      expect(config.algorithm).toBe('aes-256-gcm')
    })

    it('should support caching plugin with composite keys', () => {
      interface CachingOptions extends PrimaryKeyConfig {
        ttl: number
        keyPrefix: string
        invalidateOn: Array<'insert' | 'update' | 'delete'>
      }

      const config: CachingOptions = {
        primaryKeyColumn: ['region', 'user_id'],
        ttl: 300,
        keyPrefix: 'user:',
        invalidateOn: ['update', 'delete']
      }

      expect(config.primaryKeyColumn).toEqual(['region', 'user_id'])
      expect(config.ttl).toBe(300)
      expect(config.invalidateOn).toEqual(['update', 'delete'])
    })
  })

  describe('Utility Functions for Plugin Authors', () => {
    it('should provide helper to normalize primary key to array', () => {
      function getPrimaryKeyColumns(config: PrimaryKeyConfig): string[] {
        const pk = config.primaryKeyColumn ?? 'id'
        return Array.isArray(pk) ? pk : [pk]
      }

      expect(getPrimaryKeyColumns({})).toEqual(['id'])
      expect(getPrimaryKeyColumns({ primaryKeyColumn: 'uuid' })).toEqual(['uuid'])
      expect(getPrimaryKeyColumns({ primaryKeyColumn: ['a', 'b'] })).toEqual(['a', 'b'])
    })

    it('should provide helper to check if composite key', () => {
      function isCompositeKey(config: PrimaryKeyConfig): boolean {
        return Array.isArray(config.primaryKeyColumn)
      }

      expect(isCompositeKey({})).toBe(false)
      expect(isCompositeKey({ primaryKeyColumn: 'id' })).toBe(false)
      expect(isCompositeKey({ primaryKeyColumn: ['a', 'b'] })).toBe(true)
    })

    it('should provide helper to get primary key string', () => {
      function getPrimaryKeyString(config: PrimaryKeyConfig): string {
        const pk = config.primaryKeyColumn ?? 'id'
        return Array.isArray(pk) ? pk.join(',') : pk
      }

      expect(getPrimaryKeyString({})).toBe('id')
      expect(getPrimaryKeyString({ primaryKeyColumn: 'uuid' })).toBe('uuid')
      expect(getPrimaryKeyString({ primaryKeyColumn: ['a', 'b', 'c'] })).toBe('a,b,c')
    })

    it('should provide helper for WHERE clause building', () => {
      function buildWhereClause(
        config: PrimaryKeyConfig,
        value: unknown | unknown[]
      ): Record<string, unknown> {
        const columns = Array.isArray(config.primaryKeyColumn)
          ? config.primaryKeyColumn
          : [config.primaryKeyColumn ?? 'id']

        const values = Array.isArray(value) ? value : [value]

        if (columns.length !== values.length) {
          throw new Error(
            `Primary key columns (${columns.length}) and values (${values.length}) count mismatch`
          )
        }

        return Object.fromEntries(columns.map((col, idx) => [col, values[idx]]))
      }

      // Single column
      expect(buildWhereClause({}, 123)).toEqual({ id: 123 })
      expect(buildWhereClause({ primaryKeyColumn: 'uuid' }, 'abc')).toEqual({ uuid: 'abc' })

      // Composite key
      expect(buildWhereClause({ primaryKeyColumn: ['a', 'b'] }, [1, 2])).toEqual({
        a: 1,
        b: 2
      })
    })
  })

  describe('Real-World Configuration Examples', () => {
    it('should handle e-commerce multi-tenant configuration', () => {
      interface ECommerceConfig extends PrimaryKeyConfig {
        softDelete?: boolean
        audit?: boolean
        timestamps?: boolean
      }

      const config: ECommerceConfig = {
        primaryKeyColumn: ['store_id', 'product_id'],
        softDelete: true,
        audit: true,
        timestamps: true
      }

      expect(config.primaryKeyColumn).toEqual(['store_id', 'product_id'])
      expect(config.softDelete).toBe(true)
      expect(config.audit).toBe(true)
      expect(config.timestamps).toBe(true)
    })

    it('should handle SaaS application configuration', () => {
      interface SaaSConfig extends PrimaryKeyConfig {
        tenantIsolation: boolean
        dataResidency?: string
      }

      const config: SaaSConfig = {
        primaryKeyColumn: ['tenant_id', 'entity_id'],
        tenantIsolation: true,
        dataResidency: 'EU'
      }

      expect(config.primaryKeyColumn).toEqual(['tenant_id', 'entity_id'])
      expect(config.tenantIsolation).toBe(true)
      expect(config.dataResidency).toBe('EU')
    })

    it('should handle IoT time-series configuration', () => {
      interface IoTConfig extends PrimaryKeyConfig {
        retention: number
        aggregation?: 'minute' | 'hour' | 'day'
      }

      const config: IoTConfig = {
        primaryKeyColumn: ['device_id', 'timestamp'],
        retention: 90, // days
        aggregation: 'hour'
      }

      expect(config.primaryKeyColumn).toEqual(['device_id', 'timestamp'])
      expect(config.retention).toBe(90)
      expect(config.aggregation).toBe('hour')
    })

    it('should handle legacy system migration', () => {
      interface LegacyMigrationConfig extends PrimaryKeyConfig {
        legacyIdColumn?: string
        mapping?: Record<string, string>
      }

      const config: LegacyMigrationConfig = {
        primaryKeyColumn: 'new_id',
        legacyIdColumn: 'old_id',
        mapping: {
          old_name: 'new_name',
          old_status: 'new_status'
        }
      }

      expect(config.primaryKeyColumn).toBe('new_id')
      expect(config.legacyIdColumn).toBe('old_id')
      expect(config.mapping).toHaveProperty('old_name')
    })
  })
})
