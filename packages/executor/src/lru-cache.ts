/**
 * Minimal LRU cache used by the executor proxy (withSchema proxy reuse).
 *
 * Correctly distinguishes "cached undefined" from "not in cache" via a
 * sentinel, so `V | undefined` value types behave predictably.
 *
 * @internal — exported for white-box tests only; not part of the public API.
 */

const UNDEFINED_SENTINEL = Symbol('UNDEFINED_SENTINEL')

type CacheValue<V> = V | typeof UNDEFINED_SENTINEL

export class LRUCache<K, V> {
  private readonly cache = new Map<K, CacheValue<V>>()
  private readonly maxSize: number

  constructor(maxSize: number) {
    if (maxSize < 1) {
      throw new RangeError(`LRUCache maxSize must be >= 1, got ${String(maxSize)}`)
    }
    this.maxSize = maxSize
  }

  get size(): number {
    return this.cache.size
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
