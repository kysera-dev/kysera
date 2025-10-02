import { Kysely } from 'kysely'
import * as crypto from 'node:crypto'
import { verbose } from './global-options.js'

/**
 * Cache entry with TTL support
 */
interface CacheEntry<T> {
  value: T
  expires: number
  hits: number
  created: number
}

/**
 * Generic cache implementation
 */
export class Cache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private maxSize: number
  private defaultTTL: number
  private hits = 0
  private misses = 0

  constructor(options: {
    maxSize?: number
    defaultTTL?: number // in milliseconds
  } = {}) {
    this.maxSize = options.maxSize || 100
    this.defaultTTL = options.defaultTTL || 5 * 60 * 1000 // 5 minutes
  }

  /**
   * Get value from cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key)

    if (!entry) {
      this.misses++
      return undefined
    }

    // Check if expired
    if (Date.now() > entry.expires) {
      this.cache.delete(key)
      this.misses++
      return undefined
    }

    entry.hits++
    this.hits++
    return entry.value
  }

  /**
   * Set value in cache
   */
  set(key: string, value: T, ttl?: number): void {
    // Evict least recently used if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU()
    }

    const expires = Date.now() + (ttl || this.defaultTTL)
    this.cache.set(key, {
      value,
      expires,
      hits: 0,
      created: Date.now()
    })
  }

  /**
   * Delete from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get or compute value
   */
  async getOrCompute(
    key: string,
    compute: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get(key)
    if (cached !== undefined) {
      verbose(`Cache hit for key: ${key}`)
      return cached
    }

    verbose(`Cache miss for key: ${key}, computing...`)
    const value = await compute()
    this.set(key, value, ttl)
    return value
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let lruKey: string | null = null
    let lruTime = Infinity

    for (const [key, entry] of this.cache.entries()) {
      const lastAccess = entry.created + entry.hits * 1000
      if (lastAccess < lruTime) {
        lruTime = lastAccess
        lruKey = key
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey)
      verbose(`Evicted cache entry: ${lruKey}`)
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.hits + this.misses
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      entries: Array.from(this.cache.entries()).map(([key, entry]) => ({
        key,
        hits: entry.hits,
        age: Date.now() - entry.created,
        ttl: entry.expires - Date.now()
      }))
    }
  }
}

/**
 * Configuration cache
 */
export class ConfigCache {
  private static cache = new Cache<any>({
    maxSize: 10,
    defaultTTL: 10 * 60 * 1000 // 10 minutes
  })

  /**
   * Get cached configuration
   */
  static get(path: string): any {
    return this.cache.get(path)
  }

  /**
   * Cache configuration
   */
  static set(path: string, config: any): void {
    this.cache.set(path, config)
  }

  /**
   * Load configuration with caching
   */
  static async load(
    path: string,
    loader: () => Promise<any>
  ): Promise<any> {
    return this.cache.getOrCompute(path, loader)
  }

  /**
   * Clear cache
   */
  static clear(): void {
    this.cache.clear()
  }
}

/**
 * Database connection pool
 */
export class ConnectionPool {
  private static connections = new Map<string, {
    db: Kysely<any>
    lastAccess: number
    refs: number
  }>()
  private static maxConnections = 10
  private static idleTimeout = 30 * 1000 // 30 seconds

  /**
   * Get or create connection
   */
  static async get(
    key: string,
    factory: () => Promise<Kysely<any>>
  ): Promise<Kysely<any>> {
    const existing = this.connections.get(key)

    if (existing) {
      existing.lastAccess = Date.now()
      existing.refs++
      verbose(`Reusing database connection: ${key} (${existing.refs} refs)`)
      return existing.db
    }

    // Check connection limit
    if (this.connections.size >= this.maxConnections) {
      await this.evictIdle()
    }

    verbose(`Creating new database connection: ${key}`)
    const db = await factory()

    this.connections.set(key, {
      db,
      lastAccess: Date.now(),
      refs: 1
    })

    return db
  }

  /**
   * Release connection reference
   */
  static release(key: string): void {
    const conn = this.connections.get(key)
    if (conn) {
      conn.refs--
      verbose(`Released connection reference: ${key} (${conn.refs} refs remaining)`)

      if (conn.refs <= 0) {
        // Schedule cleanup after idle timeout
        setTimeout(() => {
          const current = this.connections.get(key)
          if (current && current.refs <= 0 &&
              Date.now() - current.lastAccess > this.idleTimeout) {
            this.close(key)
          }
        }, this.idleTimeout)
      }
    }
  }

  /**
   * Close a connection
   */
  static async close(key: string): Promise<void> {
    const conn = this.connections.get(key)
    if (conn) {
      verbose(`Closing database connection: ${key}`)
      await conn.db.destroy()
      this.connections.delete(key)
    }
  }

  /**
   * Close all connections
   */
  static async closeAll(): Promise<void> {
    verbose(`Closing all ${this.connections.size} database connections`)
    const closePromises = Array.from(this.connections.entries()).map(
      async ([key, conn]) => {
        await conn.db.destroy()
      }
    )
    await Promise.all(closePromises)
    this.connections.clear()
  }

  /**
   * Evict idle connections
   */
  private static async evictIdle(): Promise<void> {
    const now = Date.now()
    const idle = Array.from(this.connections.entries())
      .filter(([_, conn]) =>
        conn.refs === 0 && now - conn.lastAccess > this.idleTimeout
      )
      .map(([key]) => key)

    for (const key of idle) {
      await this.close(key)
    }
  }

  /**
   * Get pool statistics
   */
  static getStats() {
    return {
      size: this.connections.size,
      maxSize: this.maxConnections,
      connections: Array.from(this.connections.entries()).map(([key, conn]) => ({
        key,
        refs: conn.refs,
        idleTime: Date.now() - conn.lastAccess
      }))
    }
  }
}

/**
 * Query result cache
 */
export class QueryCache {
  private static cache = new Cache<any>({
    maxSize: 50,
    defaultTTL: 60 * 1000 // 1 minute
  })

  /**
   * Create cache key from query
   */
  static createKey(query: string, params?: any[]): string {
    const data = JSON.stringify({ query, params })
    return crypto.createHash('md5').update(data).digest('hex')
  }

  /**
   * Get cached query result
   */
  static get(query: string, params?: any[]): any {
    const key = this.createKey(query, params)
    return this.cache.get(key)
  }

  /**
   * Cache query result
   */
  static set(query: string, result: any, params?: any[], ttl?: number): void {
    const key = this.createKey(query, params)
    this.cache.set(key, result, ttl)
  }

  /**
   * Execute query with caching
   */
  static async execute(
    query: string,
    executor: () => Promise<any>,
    options: {
      params?: any[]
      ttl?: number
      skipCache?: boolean
    } = {}
  ): Promise<any> {
    if (options.skipCache) {
      return executor()
    }

    const key = this.createKey(query, options.params)
    return this.cache.getOrCompute(key, executor, options.ttl)
  }

  /**
   * Clear cache
   */
  static clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  static getStats() {
    return this.cache.getStats()
  }
}

/**
 * Schema cache for introspection results
 */
export class SchemaCache {
  private static cache = new Cache<any>({
    maxSize: 20,
    defaultTTL: 5 * 60 * 1000 // 5 minutes
  })

  /**
   * Get cached schema
   */
  static get(database: string): any {
    return this.cache.get(database)
  }

  /**
   * Cache schema
   */
  static set(database: string, schema: any): void {
    this.cache.set(database, schema)
  }

  /**
   * Load schema with caching
   */
  static async load(
    database: string,
    loader: () => Promise<any>
  ): Promise<any> {
    return this.cache.getOrCompute(database, loader)
  }

  /**
   * Invalidate schema cache
   */
  static invalidate(database: string): void {
    this.cache.delete(database)
  }

  /**
   * Clear all cache
   */
  static clear(): void {
    this.cache.clear()
  }
}

/**
 * Global cache manager
 */
export class CacheManager {
  /**
   * Clear all caches
   */
  static clearAll(): void {
    verbose('Clearing all caches')
    ConfigCache.clear()
    QueryCache.clear()
    SchemaCache.clear()
  }

  /**
   * Get statistics for all caches
   */
  static getAllStats() {
    return {
      config: ConfigCache['cache' as any].getStats(),
      query: QueryCache.getStats(),
      schema: SchemaCache['cache' as any].getStats(),
      connections: ConnectionPool.getStats()
    }
  }

  /**
   * Print cache statistics
   */
  static printStats(): void {
    const stats = this.getAllStats()

    console.log('Cache Statistics:')
    console.log('─'.repeat(60))

    // Config cache
    console.log(`Config Cache:`)
    console.log(`  Size: ${stats.config.size}/${stats.config.maxSize}`)
    console.log(`  Hit Rate: ${(stats.config.hitRate * 100).toFixed(1)}%`)

    // Query cache
    console.log(`Query Cache:`)
    console.log(`  Size: ${stats.query.size}/${stats.query.maxSize}`)
    console.log(`  Hit Rate: ${(stats.query.hitRate * 100).toFixed(1)}%`)

    // Schema cache
    console.log(`Schema Cache:`)
    console.log(`  Size: ${stats.schema.size}/${stats.schema.maxSize}`)
    console.log(`  Hit Rate: ${(stats.schema.hitRate * 100).toFixed(1)}%`)

    // Connection pool
    console.log(`Connection Pool:`)
    console.log(`  Active: ${stats.connections.size}/${stats.connections.maxSize}`)
    stats.connections.connections.forEach(conn => {
      console.log(`    ${conn.key}: ${conn.refs} refs, idle ${Math.round(conn.idleTime / 1000)}s`)
    })

    console.log('─'.repeat(60))
  }

  /**
   * Setup cleanup on process exit
   */
  static setupCleanup(): void {
    process.on('exit', () => {
      ConnectionPool.closeAll().catch(() => {})
    })

    process.on('SIGINT', async () => {
      await ConnectionPool.closeAll()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      await ConnectionPool.closeAll()
      process.exit(0)
    })
  }
}