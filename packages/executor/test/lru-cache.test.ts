/**
 * White-box tests for the real LRUCache used by the executor proxy
 * (imported from src — previously this file tested a hand-copied duplicate).
 */

import { describe, it, expect } from 'vitest'
import { LRUCache } from '../src/lru-cache.js'

describe('LRUCache', () => {
  describe('undefined handling (sentinel pattern)', () => {
    it('distinguishes cached undefined from missing key via has()', () => {
      const cache = new LRUCache<string, string | undefined>(10)
      cache.set('key', undefined)

      expect(cache.has('key')).toBe(true)
      expect(cache.has('missing')).toBe(false)
      expect(cache.get('key')).toBeUndefined()
      expect(cache.get('missing')).toBeUndefined()
    })

    it('cached undefined survives LRU refresh', () => {
      const cache = new LRUCache<string, string | undefined>(2)
      cache.set('a', undefined)
      cache.set('b', 'value')
      // Refresh 'a' — must stay retrievable and still count as present
      expect(cache.get('a')).toBeUndefined()
      expect(cache.has('a')).toBe(true)
      cache.set('c', 'evicts-b')
      expect(cache.has('a')).toBe(true)
      expect(cache.has('b')).toBe(false)
    })
  })

  describe('basic operations', () => {
    it('stores and retrieves values', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('one', 1)
      cache.set('two', 2)
      expect(cache.get('one')).toBe(1)
      expect(cache.get('two')).toBe(2)
      expect(cache.size).toBe(2)
    })

    it('overwrites existing keys without growing', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('key', 1)
      cache.set('key', 2)
      expect(cache.get('key')).toBe(2)
      expect(cache.size).toBe(1)
    })

    it('rejects invalid maxSize', () => {
      expect(() => new LRUCache(0)).toThrow(RangeError)
      expect(() => new LRUCache(-1)).toThrow(RangeError)
    })
  })

  describe('eviction', () => {
    it('evicts the least recently used entry when full', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)
      cache.set('d', 4) // evicts 'a'

      expect(cache.has('a')).toBe(false)
      expect(cache.has('b')).toBe(true)
      expect(cache.has('c')).toBe(true)
      expect(cache.has('d')).toBe(true)
      expect(cache.size).toBe(3)
    })

    it('get() refreshes recency and changes the eviction victim', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)
      cache.get('a') // 'a' is now most recent; 'b' is oldest
      cache.set('d', 4) // evicts 'b'

      expect(cache.has('a')).toBe(true)
      expect(cache.has('b')).toBe(false)
    })

    it('set() on an existing key refreshes recency', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)
      cache.set('a', 10) // refresh 'a'; 'b' becomes oldest
      cache.set('d', 4) // evicts 'b'

      expect(cache.get('a')).toBe(10)
      expect(cache.has('b')).toBe(false)
    })

    it('handles heavy churn without exceeding maxSize', () => {
      const cache = new LRUCache<number, number>(100)
      for (let i = 0; i < 1000; i++) {
        cache.set(i, i)
      }
      expect(cache.size).toBe(100)
      // Only the last 100 survive
      expect(cache.has(899)).toBe(false)
      expect(cache.has(900)).toBe(true)
      expect(cache.get(999)).toBe(999)
    })
  })
})
