/**
 * Tests for M-4: LRU cache undefined handling
 *
 * Verifies that the LRU cache correctly distinguishes between:
 * - Cached undefined values
 * - Keys not in cache
 */

import { describe, it, expect } from 'vitest'

/**
 * Re-export the LRU cache for testing purposes
 * In production, this is internal to executor.ts
 */

const UNDEFINED_SENTINEL = Symbol('UNDEFINED_SENTINEL')
type CacheValue<V> = V | typeof UNDEFINED_SENTINEL

class LRUCache<K, V> {
  private cache: Map<K, CacheValue<V>>
  private readonly maxSize: number

  constructor(maxSize: number) {
    this.cache = new Map()
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
      // Unwrap sentinel value
      return value === UNDEFINED_SENTINEL ? undefined : value
    }
    return undefined
  }

  set(key: K, value: V): void {
    // Wrap undefined values with sentinel
    const wrappedValue: CacheValue<V> = value === undefined ? UNDEFINED_SENTINEL : value

    // Delete if exists to move to end
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }
    this.cache.set(key, wrappedValue)

    // Evict oldest (first) entry if size exceeded
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
  }

  has(key: K): boolean {
    return this.cache.has(key)
  }
}

describe('M-4: LRU cache undefined handling', () => {
  it('should distinguish cached undefined from missing key', () => {
    const cache = new LRUCache<string, string | undefined>(10)

    // Set undefined explicitly
    cache.set('key1', undefined)

    // Check that key exists in cache
    expect(cache.has('key1')).toBe(true)

    // Get should return undefined
    expect(cache.get('key1')).toBeUndefined()

    // Missing key should also return undefined
    expect(cache.get('key2')).toBeUndefined()

    // But has() should distinguish them
    expect(cache.has('key1')).toBe(true)
    expect(cache.has('key2')).toBe(false)
  })

  it('should cache undefined values correctly', () => {
    const cache = new LRUCache<number, number | undefined>(5)

    cache.set(1, undefined)
    cache.set(2, 42)
    cache.set(3, undefined)

    expect(cache.has(1)).toBe(true)
    expect(cache.has(2)).toBe(true)
    expect(cache.has(3)).toBe(true)
    expect(cache.has(4)).toBe(false)

    expect(cache.get(1)).toBeUndefined()
    expect(cache.get(2)).toBe(42)
    expect(cache.get(3)).toBeUndefined()
    expect(cache.get(4)).toBeUndefined()
  })

  it('should handle LRU eviction with undefined values', () => {
    const cache = new LRUCache<number, number | undefined>(3)

    cache.set(1, undefined)
    cache.set(2, 42)
    cache.set(3, undefined)
    cache.set(4, 100) // Should evict key 1

    expect(cache.has(1)).toBe(false)
    expect(cache.has(2)).toBe(true)
    expect(cache.has(3)).toBe(true)
    expect(cache.has(4)).toBe(true)

    expect(cache.get(1)).toBeUndefined() // Not in cache
    expect(cache.get(2)).toBe(42)
    expect(cache.get(3)).toBeUndefined() // In cache, but value is undefined
    expect(cache.get(4)).toBe(100)
  })

  it('should maintain LRU order when accessing undefined values', () => {
    const cache = new LRUCache<string, string | undefined>(3)

    cache.set('a', undefined)
    cache.set('b', 'value-b')
    cache.set('c', 'value-c')

    // Access 'a' to make it most recently used
    cache.get('a')

    // Add new key, should evict 'b' (least recently used)
    cache.set('d', 'value-d')

    expect(cache.has('a')).toBe(true) // Still in cache (was accessed)
    expect(cache.has('b')).toBe(false) // Evicted
    expect(cache.has('c')).toBe(true)
    expect(cache.has('d')).toBe(true)
  })

  it('should handle mixed types with undefined', () => {
    interface TestValue {
      data: string | undefined
    }

    const cache = new LRUCache<string, TestValue | undefined>(5)

    cache.set('key1', { data: 'test' })
    cache.set('key2', { data: undefined })
    cache.set('key3', undefined)

    expect(cache.get('key1')).toEqual({ data: 'test' })
    expect(cache.get('key2')).toEqual({ data: undefined })
    expect(cache.get('key3')).toBeUndefined()

    expect(cache.has('key1')).toBe(true)
    expect(cache.has('key2')).toBe(true)
    expect(cache.has('key3')).toBe(true)
  })

  it('should handle overwriting undefined with value', () => {
    const cache = new LRUCache<string, number | undefined>(5)

    cache.set('key', undefined)
    expect(cache.get('key')).toBeUndefined()
    expect(cache.has('key')).toBe(true)

    cache.set('key', 42)
    expect(cache.get('key')).toBe(42)
    expect(cache.has('key')).toBe(true)
  })

  it('should handle overwriting value with undefined', () => {
    const cache = new LRUCache<string, number | undefined>(5)

    cache.set('key', 42)
    expect(cache.get('key')).toBe(42)
    expect(cache.has('key')).toBe(true)

    cache.set('key', undefined)
    expect(cache.get('key')).toBeUndefined()
    expect(cache.has('key')).toBe(true)
  })

  it('should handle null differently from undefined', () => {
    const cache = new LRUCache<string, string | null | undefined>(5)

    cache.set('undefined-key', undefined)
    cache.set('null-key', null)

    expect(cache.get('undefined-key')).toBeUndefined()
    expect(cache.get('null-key')).toBeNull()

    expect(cache.has('undefined-key')).toBe(true)
    expect(cache.has('null-key')).toBe(true)
  })

  it('should handle 0, false, and empty string correctly', () => {
    const cache = new LRUCache<string, number | boolean | string | undefined>(5)

    cache.set('zero', 0)
    cache.set('false', false)
    cache.set('empty', '')
    cache.set('undefined', undefined)

    expect(cache.get('zero')).toBe(0)
    expect(cache.get('false')).toBe(false)
    expect(cache.get('empty')).toBe('')
    expect(cache.get('undefined')).toBeUndefined()

    expect(cache.has('zero')).toBe(true)
    expect(cache.has('false')).toBe(true)
    expect(cache.has('empty')).toBe(true)
    expect(cache.has('undefined')).toBe(true)
  })
})
