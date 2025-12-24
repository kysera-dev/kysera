/**
 * Plugin Testing Utilities
 *
 * Provides utilities for testing Kysera plugins in isolation
 * and integration scenarios.
 *
 * @module
 */

import type { Kysely, Transaction } from 'kysely'
import type { Plugin, QueryBuilderContext } from '@kysera/executor'

/**
 * Recorded operation from mock plugin
 */
export interface RecordedOperation {
  /** The operation type */
  operation: QueryBuilderContext['operation']
  /** The table being operated on */
  table: string
  /** Timestamp when the operation was recorded */
  timestamp: Date
  /** Additional metadata */
  metadata: Record<string, unknown>
}

/**
 * Plugin test result for assertions
 */
export interface PluginTestResult {
  /** Whether the plugin intercepted the operation */
  intercepted: boolean
  /** Whether the query builder was modified */
  modified: boolean
  /** Error thrown by the plugin (if any) */
  error?: Error
}

/**
 * Plugin behavior assertion options
 */
export interface PluginAssertionOptions {
  /** Expected operation to be intercepted */
  expectedOperation?: QueryBuilderContext['operation']
  /** Expected table to be affected */
  expectedTable?: string
  /** Whether the plugin should modify the query */
  shouldModifyQuery?: boolean
}

/**
 * Creates a mock plugin for testing plugin interactions.
 *
 * Useful for testing how plugins compose with each other
 * and verifying plugin execution order.
 *
 * @param name - Name of the mock plugin
 * @param options - Configuration options
 * @returns A mock plugin that records all operations
 *
 * @example
 * ```typescript
 * const mockPlugin = createMockPlugin('test-plugin', {
 *   onIntercept: (qb, ctx) => {
 *     console.log(`Intercepted ${ctx.operation} on ${ctx.table}`);
 *     return qb; // Return unmodified
 *   }
 * });
 *
 * const executor = await createExecutor(db, [mockPlugin, softDeletePlugin()]);
 *
 * // Run some queries
 * await executor.selectFrom('users').selectAll().execute();
 *
 * // Check recorded operations
 * expect(mockPlugin.operations).toHaveLength(1);
 * expect(mockPlugin.operations[0].operation).toBe('select');
 * ```
 */
export function createMockPlugin(
  name: string,
  options?: {
    onIntercept?: <QB>(qb: QB, ctx: QueryBuilderContext) => QB
    priority?: number
  }
): Plugin & { operations: RecordedOperation[]; reset: () => void } {
  const operations: RecordedOperation[] = []

  return {
    name,
    version: '1.0.0-test',
    priority: options?.priority ?? 0,

    // Track all operations
    operations,

    // Reset tracking
    reset: () => {
      operations.length = 0
    },

    // Plugin hook - synchronous query builder transformation
    interceptQuery<QB>(qb: QB, context: QueryBuilderContext): QB {
      operations.push({
        operation: context.operation,
        table: context.table,
        timestamp: new Date(),
        metadata: { ...context.metadata }
      })

      if (options?.onIntercept) {
        return options.onIntercept(qb, context)
      }

      return qb
    }
  }
}

/**
 * Creates a spy wrapper for an existing plugin.
 *
 * Wraps a plugin to record all operations while preserving
 * the original plugin behavior.
 *
 * @param plugin - The plugin to spy on
 * @returns A wrapped plugin with spy capabilities
 *
 * @example
 * ```typescript
 * const spiedPlugin = spyOnPlugin(softDeletePlugin());
 *
 * const executor = await createExecutor(db, [spiedPlugin]);
 *
 * await executor.deleteFrom('users').where('id', '=', 1).execute();
 *
 * // Verify the plugin was called
 * expect(spiedPlugin.calls).toHaveLength(1);
 * expect(spiedPlugin.calls[0].operation).toBe('delete');
 * ```
 */
export function spyOnPlugin(
  plugin: Plugin
): Plugin & { calls: RecordedOperation[]; reset: () => void } {
  const calls: RecordedOperation[] = []

  const wrappedPlugin: Plugin & { calls: typeof calls; reset: () => void } = {
    ...plugin,
    calls,
    reset: () => {
      calls.length = 0
    }
  }

  // Wrap interceptQuery if it exists
  if (plugin.interceptQuery) {
    const originalIntercept = plugin.interceptQuery.bind(plugin)
    wrappedPlugin.interceptQuery = <QB>(qb: QB, context: QueryBuilderContext): QB => {
      calls.push({
        operation: context.operation,
        table: context.table,
        timestamp: new Date(),
        metadata: { ...context.metadata }
      })
      return originalIntercept(qb, context)
    }
  }

  return wrappedPlugin
}

/**
 * Asserts that a plugin behaves as expected for a given operation.
 *
 * @param plugin - The plugin to test
 * @param mockQb - A mock query builder object
 * @param context - The query builder context
 * @param assertions - Expected behavior assertions
 * @returns Test result with details
 *
 * @example
 * ```typescript
 * const plugin = softDeletePlugin({ deletedAtColumn: 'deleted_at' });
 *
 * const result = await assertPluginBehavior(
 *   plugin,
 *   { where: () => mockQb }, // Mock query builder
 *   { operation: 'select', table: 'users', metadata: {} },
 *   { shouldModifyQuery: true }
 * );
 *
 * expect(result.modified).toBe(true);
 * ```
 */
export function assertPluginBehavior(
  plugin: Plugin,
  mockQb: object,
  context: QueryBuilderContext,
  assertions?: PluginAssertionOptions
): PluginTestResult {
  const result: PluginTestResult = {
    intercepted: false,
    modified: false
  }

  if (!plugin.interceptQuery) {
    return result
  }

  try {
    const returnedQb = plugin.interceptQuery(mockQb, context)
    result.intercepted = true
    result.modified = returnedQb !== mockQb
  } catch (error) {
    result.error = error as Error
  }

  // Perform assertions
  if (assertions?.shouldModifyQuery !== undefined) {
    if (assertions.shouldModifyQuery !== result.modified) {
      throw new Error(
        `Expected plugin to ${assertions.shouldModifyQuery ? '' : 'not '}modify query, but it ${result.modified ? 'did' : "didn't"}`
      )
    }
  }

  return result
}

/**
 * Creates an in-memory SQLite database for plugin testing.
 *
 * Uses SQLite in-memory mode for fast, isolated plugin tests.
 *
 * @param schema - SQL schema to create tables
 * @returns A Kysely instance with the schema applied
 *
 * @example
 * ```typescript
 * const db = await createInMemoryDatabase(`
 *   CREATE TABLE users (
 *     id INTEGER PRIMARY KEY,
 *     email TEXT NOT NULL,
 *     deleted_at TEXT
 *   )
 * `);
 *
 * const executor = await createExecutor(db, [softDeletePlugin()]);
 *
 * // Run tests against in-memory database
 * await executor.insertInto('users').values({ email: 'test@example.com' }).execute();
 * ```
 */
export async function createInMemoryDatabase<DB>(schema: string): Promise<Kysely<DB>> {
  // Dynamic import to avoid requiring dependencies at module load time
  const { Kysely, SqliteDialect } = await import('kysely')

  // Try to import better-sqlite3
  let sqliteDb: unknown
  try {
    const sqliteModule = await import('better-sqlite3')
    const Database = sqliteModule.default as new (filename: string) => unknown
    sqliteDb = new Database(':memory:')
  } catch {
    throw new Error(
      'better-sqlite3 is required for createInMemoryDatabase. Install it with: pnpm add -D better-sqlite3'
    )
  }

  const db = new Kysely<DB>({
    dialect: new SqliteDialect({
      // Type assertion needed due to dynamic import - SqliteDatabase type is not available at compile time
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
      database: sqliteDb as any
    })
  })

  // Execute schema statements
  const statements = schema.split(';').filter((s) => s.trim())
  for (const statement of statements) {
    if (statement.trim()) {
      await (db as Kysely<unknown>).executeQuery({
        sql: statement.trim(),
        parameters: []
      } as never)
    }
  }

  return db
}

/**
 * Creates a test harness for plugin integration testing.
 *
 * Provides a structured way to set up, execute, and verify
 * plugin behavior in integration tests.
 *
 * @param options - Test harness configuration
 * @returns A test harness with setup, execute, and verify methods
 *
 * @example
 * ```typescript
 * const harness = createPluginTestHarness({
 *   plugins: [softDeletePlugin(), timestampsPlugin()],
 *   schema: `
 *     CREATE TABLE posts (
 *       id INTEGER PRIMARY KEY,
 *       title TEXT,
 *       deleted_at TEXT,
 *       created_at TEXT,
 *       updated_at TEXT
 *     )
 *   `
 * });
 *
 * await harness.setup();
 *
 * const result = await harness.execute(async (executor) => {
 *   return executor.insertInto('posts')
 *     .values({ title: 'Test Post' })
 *     .returningAll()
 *     .executeTakeFirst();
 * });
 *
 * harness.verify(result, (r) => {
 *   expect(r.created_at).toBeDefined();
 *   expect(r.updated_at).toBeDefined();
 * });
 *
 * await harness.teardown();
 * ```
 */
export function createPluginTestHarness<DB>(options: {
  plugins: Plugin[]
  schema: string
  seedData?: (executor: Kysely<DB>) => Promise<void>
}): {
  setup: () => Promise<void>
  execute: <T>(fn: (executor: Kysely<DB>) => Promise<T>) => Promise<T>
  verify: <T>(result: T, assertions: (result: T) => void) => void
  teardown: () => Promise<void>
  getDb: () => Kysely<DB>
} {
  let db: Kysely<DB> | null = null
  let executor: Kysely<DB> | null = null

  return {
    async setup() {
      db = await createInMemoryDatabase<DB>(options.schema)

      // Import and create executor dynamically
      const { createExecutor } = await import('@kysera/executor')
      executor = await createExecutor(db, options.plugins)

      if (options.seedData) {
        await options.seedData(executor)
      }
    },

    async execute<T>(fn: (executor: Kysely<DB>) => Promise<T>): Promise<T> {
      if (!executor || !db) {
        throw new Error('Test harness not set up. Call setup() first.')
      }
      return await fn(executor)
    },

    verify<T>(result: T, assertions: (result: T) => void): void {
      assertions(result)
    },

    async teardown() {
      if (db) {
        await db.destroy()
        db = null
        executor = null
      }
    },

    getDb(): Kysely<DB> {
      if (!db) {
        throw new Error('Test harness not set up. Call setup() first.')
      }
      return db
    }
  }
}

/**
 * Mock executor type - useful for mocking in unit tests
 */
export interface MockOperationContext {
  operation: QueryBuilderContext['operation']
  table: string
  executor: Kysely<unknown> | Transaction<unknown>
}

/**
 * Options for creating a test executor
 */
export interface CreateTestExecutorOptions<DB> {
  db: Kysely<DB>
  plugins: Plugin[]
  debug?: boolean
}
