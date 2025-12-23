/**
 * Tests for primary key extraction utilities (H-9 fix).
 *
 * @module @kysera/repository
 */

import { describe, it, expect } from 'vitest'
import { extractPrimaryKey } from '../src/primary-key-utils.js'

describe('extractPrimaryKey', () => {
  describe('single primary key', () => {
    it('should extract numeric primary key', () => {
      const row = { id: 42, name: 'Alice', email: 'alice@example.com' }
      const pkConfig = { columns: 'id', type: 'number' as const }

      const result = extractPrimaryKey(row, pkConfig)

      expect(result).toBe(42)
    })

    it('should extract string primary key', () => {
      const row = { uuid: '123e4567-e89b-12d3-a456-426614174000', name: 'Bob' }
      const pkConfig = { columns: 'uuid', type: 'string' as const }

      const result = extractPrimaryKey(row, pkConfig)

      expect(result).toBe('123e4567-e89b-12d3-a456-426614174000')
    })

    it('should extract bigint primary key', () => {
      const row = { id: BigInt('9007199254740991'), name: 'Charlie' }
      const pkConfig = { columns: 'id', type: 'string' as const } // bigint is stored as string in PrimaryKeyTypeHint

      const result = extractPrimaryKey(row, pkConfig)

      expect(result).toBe(BigInt('9007199254740991'))
    })

    it('should extract from column with underscores', () => {
      const row = { user_id: 123, user_name: 'Dave' }
      const pkConfig = { columns: 'user_id', type: 'number' as const }

      const result = extractPrimaryKey(row, pkConfig)

      expect(result).toBe(123)
    })
  })

  describe('composite primary key', () => {
    it('should extract two-column composite key', () => {
      const row = { userId: 1, roleId: 2, assignedAt: new Date() }
      const pkConfig = { columns: ['userId', 'roleId'], type: 'number' as const }

      const result = extractPrimaryKey(row, pkConfig)

      expect(result).toEqual({ userId: 1, roleId: 2 })
    })

    it('should extract three-column composite key', () => {
      const row = { orgId: 1, projectId: 2, taskId: 3, title: 'Task 1' }
      const pkConfig = { columns: ['orgId', 'projectId', 'taskId'], type: 'number' as const }

      const result = extractPrimaryKey(row, pkConfig)

      expect(result).toEqual({ orgId: 1, projectId: 2, taskId: 3 })
    })

    it('should extract mixed type composite key', () => {
      const row = { tenantId: 'tenant-123', userId: 456, data: {} }
      const pkConfig = { columns: ['tenantId', 'userId'], type: 'string' as const }

      const result = extractPrimaryKey(row, pkConfig)

      expect(result).toEqual({ tenantId: 'tenant-123', userId: 456 })
    })

    it('should not include non-key columns', () => {
      const row = { id: 1, categoryId: 2, name: 'Product', price: 99.99 }
      const pkConfig = { columns: ['id', 'categoryId'], type: 'number' as const }

      const result = extractPrimaryKey(row, pkConfig)

      expect(result).toEqual({ id: 1, categoryId: 2 })
      expect(result).not.toHaveProperty('name')
      expect(result).not.toHaveProperty('price')
    })
  })

  describe('edge cases', () => {
    it('should handle null primary key value', () => {
      const row = { id: null, name: 'Test' }
      const pkConfig = { columns: 'id', type: 'number' as const }

      const result = extractPrimaryKey(row, pkConfig)

      expect(result).toBeNull()
    })

    it('should handle undefined primary key value', () => {
      const row = { name: 'Test' }
      const pkConfig = { columns: 'id', type: 'number' as const }

      const result = extractPrimaryKey(row, pkConfig)

      expect(result).toBeUndefined()
    })

    it('should extract from row with extra properties', () => {
      const row = {
        id: 1,
        name: 'Test',
        nested: { data: 'value' },
        array: [1, 2, 3]
      }
      const pkConfig = { columns: 'id', type: 'number' as const }

      const result = extractPrimaryKey(row, pkConfig)

      expect(result).toBe(1)
    })
  })

  describe('consistency with table-operations', () => {
    it('should extract same value as old extractPrimaryKeyFromRow', () => {
      const row = { id: 123, name: 'Alice', email: 'alice@example.com' }
      const pkConfig = { columns: 'id', type: 'number' as const }

      const result = extractPrimaryKey(row, pkConfig)

      // This should match the behavior of the old extractPrimaryKeyFromRow
      expect(result).toBe(123)
      expect(typeof result).toBe('number')
    })

    it('should extract same composite value as old implementation', () => {
      const row = { userId: 1, roleId: 2, assignedAt: new Date() }
      const pkConfig = { columns: ['userId', 'roleId'], type: 'number' as const }

      const result = extractPrimaryKey(row, pkConfig)

      // Should match old behavior exactly
      expect(result).toEqual({ userId: 1, roleId: 2 })
      expect(Object.keys(result as object)).toEqual(['userId', 'roleId'])
    })
  })

  describe('consistency with base-repository', () => {
    it('should extract same value as old extractPrimaryKey<Entity, PK>', () => {
      interface User {
        id: number
        name: string
        email: string
      }

      const entity: User = { id: 456, name: 'Bob', email: 'bob@example.com' }
      const pkConfig = { columns: 'id', type: 'number' as const }

      const result = extractPrimaryKey(entity, pkConfig)

      expect(result).toBe(456)
    })

    it('should work with generic entity types', () => {
      interface Product {
        productId: string
        categoryId: number
        name: string
      }

      const entity: Product = { productId: 'PROD-123', categoryId: 1, name: 'Widget' }
      const pkConfig = { columns: ['productId', 'categoryId'], type: 'string' as const }

      const result = extractPrimaryKey(entity, pkConfig)

      expect(result).toEqual({ productId: 'PROD-123', categoryId: 1 })
    })
  })
})
