/**
 * Runtime Activation Enforcement Tests
 *
 * Conditional policies (whenEnvironment / whenFeature / whenTimeRange /
 * whenCondition and PolicyOptions.condition) must be evaluated at
 * enforcement time: an inactive policy is treated as absent for that call,
 * an activation condition that throws fails closed (policy stays active),
 * and async activation conditions are rejected with RLSSchemaError.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { rlsPlugin } from '../../src/plugin.js'
import { defineRLSSchema, allow, deny, filter, validate } from '../../src/policy/index.js'
import { whenEnvironment, whenFeature, whenTimeRange } from '../../src/policy/builder.js'
import { PolicyRegistry } from '../../src/policy/registry.js'
import { resolveActivationContext } from '../../src/policy/activation.js'
import { rlsContext, createRLSContext } from '../../src/context/index.js'
import { RLSSchemaError, RLSPolicyViolation } from '../../src/errors.js'
import type { PolicyActivationCondition } from '../../src/policy/types.js'
import type { Plugin, QueryBuilderContext, AnyQueryBuilder } from '@kysera/repository'
import type { Kysely } from 'kysely'

interface TestDB {
  posts: {
    id: number
    title: string
    author_id: number
    tenant_id: string
    status: string
  }
}

/**
 * Mock query builder capturing where() calls (same shape plugin.test.ts uses)
 */
class MockQueryBuilder {
  public readonly metadata: Record<string, unknown> = {}
  private whereCalls: Array<Record<string, unknown>> = []

  where(
    columnOrFilter: string | Record<string, unknown>,
    _operator?: string,
    value?: unknown
  ): this {
    if (typeof columnOrFilter === 'string') {
      const column = columnOrFilter.includes('.')
        ? columnOrFilter.split('.').pop()!
        : columnOrFilter
      this.whereCalls.push({ [column]: value })
    } else {
      this.whereCalls.push(columnOrFilter)
    }
    return this
  }

  getWhereCalls(): Array<Record<string, unknown>> {
    return this.whereCalls
  }

  appliedColumns(): string[] {
    return this.whereCalls.flatMap(call => Object.keys(call))
  }
}

interface MockRepository {
  tableName: string
  executor: Kysely<TestDB>
  findById?: (id: unknown) => Promise<unknown>
  create?: (data: unknown) => Promise<unknown>
  update?: (id: unknown, data: unknown) => Promise<unknown>
  delete?: (id: unknown) => Promise<unknown>
}

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

const userCtx = () => createRLSContext({ auth: { userId: 1, roles: ['user'], tenantId: 't1' } })

function selectContext(table = 'posts'): QueryBuilderContext {
  return { operation: 'select', table, metadata: {} } as QueryBuilderContext
}

async function initPlugin(options: Parameters<typeof rlsPlugin<TestDB>>[0]): Promise<Plugin> {
  const plugin = rlsPlugin<TestDB>(options)
  await plugin.onInit!({} as Kysely<TestDB>)
  return plugin
}

function interceptedColumns(plugin: Plugin): string[] {
  const qb = new MockQueryBuilder()
  rlsContext.run(userCtx(), () => {
    plugin.interceptQuery!(qb as unknown as AnyQueryBuilder, selectContext())
  })
  return qb.appliedColumns()
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// ============================================================================
// resolveActivationContext
// ============================================================================

describe('resolveActivationContext', () => {
  it('prefers the configured environment over NODE_ENV', () => {
    vi.stubEnv('NODE_ENV', 'test')
    const activation = resolveActivationContext({ environment: 'production' }, null)
    expect(activation.environment).toBe('production')
  })

  it('falls back to NODE_ENV when no environment is configured', () => {
    vi.stubEnv('NODE_ENV', 'staging')
    const activation = resolveActivationContext(undefined, null)
    expect(activation.environment).toBe('staging')
  })

  it('passes configured features through unchanged', () => {
    const features = { beta: true }
    const activation = resolveActivationContext({ features }, null)
    expect(activation.features).toBe(features)
  })

  it('resolves the timestamp per call, not per context', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T10:00:00'))
    const activation = resolveActivationContext(undefined, null)
    expect(activation.timestamp).toEqual(new Date('2026-01-15T10:00:00'))
  })

  it('copies auth from the RLS context and merges meta (context wins)', () => {
    const ctx = createRLSContext({
      auth: { userId: 42, roles: ['user'], tenantId: 't1' },
      meta: { region: 'eu', tier: 'pro' }
    })

    const activation = resolveActivationContext({ meta: { region: 'us', static: true } }, ctx)

    expect(activation.auth?.userId).toBe(42)
    expect(activation.auth?.roles).toEqual(['user'])
    expect(activation.meta).toEqual({ region: 'eu', tier: 'pro', static: true })
  })

  it('omits auth and context meta when no context is active', () => {
    const activation = resolveActivationContext(undefined, null)
    expect(activation.auth).toBeUndefined()
    expect(activation.meta).toBeUndefined()
  })
})

// ============================================================================
// PolicyRegistry gating
// ============================================================================

describe('PolicyRegistry activation gating', () => {
  function buildRegistry(logger = createLogger()) {
    const registry = new PolicyRegistry<TestDB>(undefined, { logger })
    registry.register('posts', [
      filter('read', () => ({ tenant_id: 't1' }), { name: 'always-filter' }),
      filter('read', () => ({ status: 'active' }), {
        name: 'gated-filter',
        condition: ctx => ctx.environment === 'production'
      }),
      allow('create', () => true, {
        name: 'gated-allow',
        condition: ctx => {
          const features = ctx.features as Record<string, unknown> | undefined
          return features?.['new_create'] === true
        }
      }),
      deny('delete', () => true, {
        name: 'gated-deny',
        condition: ctx => ctx.environment === 'production'
      }),
      validate('create', () => false, {
        name: 'gated-validate',
        condition: ctx => ctx.environment === 'production'
      })
    ])
    return { registry, logger }
  }

  it('returns all policies when no activation context is provided', () => {
    const { registry } = buildRegistry()
    expect(registry.getFilters('posts').map(f => f.name)).toEqual([
      'always-filter',
      'gated-filter'
    ])
    expect(registry.getAllows('posts', 'create').map(p => p.name)).toEqual(['gated-allow'])
    expect(registry.getDenies('posts', 'delete').map(p => p.name)).toEqual(['gated-deny'])
    expect(registry.getValidates('posts', 'create').map(p => p.name)).toEqual(['gated-validate'])
  })

  it('omits inactive policies and keeps unconditional ones', () => {
    const { registry } = buildRegistry()
    const dev = { environment: 'development', features: {} }

    expect(registry.getFilters('posts', dev).map(f => f.name)).toEqual(['always-filter'])
    expect(registry.getAllows('posts', 'create', dev)).toEqual([])
    expect(registry.getDenies('posts', 'delete', dev)).toEqual([])
    expect(registry.getValidates('posts', 'create', dev)).toEqual([])
  })

  it('keeps conditional policies whose activation condition passes', () => {
    const { registry } = buildRegistry()
    const prod = { environment: 'production', features: { new_create: true } }

    expect(registry.getFilters('posts', prod).map(f => f.name)).toEqual([
      'always-filter',
      'gated-filter'
    ])
    expect(registry.getAllows('posts', 'create', prod).map(p => p.name)).toEqual(['gated-allow'])
    expect(registry.getDenies('posts', 'delete', prod).map(p => p.name)).toEqual(['gated-deny'])
    expect(registry.getValidates('posts', 'create', prod).map(p => p.name)).toEqual([
      'gated-validate'
    ])
  })

  it('fails closed when an activation condition throws: policy stays active, warning logged', () => {
    const logger = createLogger()
    const registry = new PolicyRegistry<TestDB>(undefined, { logger })
    registry.register('posts', [
      deny('delete', () => true, {
        name: 'broken-gate',
        condition: () => {
          throw new Error('flag service down')
        }
      })
    ])

    const denies = registry.getDenies('posts', 'delete', { environment: 'development' })
    expect(denies.map(p => p.name)).toEqual(['broken-gate'])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failing closed: policy treated as ACTIVE')
    )
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('flag service down'))
  })

  it('rejects a condition that returns a Promise with RLSSchemaError on first use', () => {
    const registry = new PolicyRegistry<TestDB>()
    // Deliberately a non-async function returning a Promise: passes the
    // compile-time async check, must be caught at evaluation time
    const promiseCondition = (() => Promise.resolve(true)) as unknown as PolicyActivationCondition
    registry.register('posts', [
      filter('read', () => ({ tenant_id: 't1' }), {
        name: 'promise-gate',
        condition: promiseCondition
      })
    ])

    expect(() => registry.getFilters('posts', { environment: 'test' })).toThrow(RLSSchemaError)
    expect(() => registry.getFilters('posts', { environment: 'test' })).toThrow(
      /must be synchronous/
    )
  })

  it('rejects async activation conditions at compile time with RLSSchemaError', () => {
    const registry = new PolicyRegistry<TestDB>()
    const asyncCondition = (async () => true) as unknown as PolicyActivationCondition

    expect(() =>
      registry.register('posts', [
        allow('read', () => true, { name: 'async-gate', condition: asyncCondition })
      ])
    ).toThrow(RLSSchemaError)
    expect(() =>
      registry.register('posts', [
        allow('read', () => true, { name: 'async-gate', condition: asyncCondition })
      ])
    ).toThrow(/must be synchronous/)
  })
})

// ============================================================================
// Plugin SELECT path (interceptQuery)
// ============================================================================

describe('rlsPlugin activation: SELECT filters', () => {
  const schema = defineRLSSchema<TestDB>({
    posts: {
      policies: [
        filter('read', () => ({ tenant_id: 't1' }), { name: 'tenant-filter' }),
        whenEnvironment(['production'], () =>
          filter('read', () => ({ status: 'active' }), { name: 'prod-filter' })
        ),
        allow('all', () => true)
      ]
    }
  })

  it('does not apply a filter whose environment gate rejects', async () => {
    const plugin = await initPlugin({ schema, activation: { environment: 'development' } })
    expect(interceptedColumns(plugin)).toEqual(['tenant_id'])
  })

  it('applies a filter whose environment gate passes', async () => {
    const plugin = await initPlugin({ schema, activation: { environment: 'production' } })
    expect(interceptedColumns(plugin)).toEqual(['tenant_id', 'status'])
  })

  it('falls back to NODE_ENV when no activation environment is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const plugin = await initPlugin({ schema })
    expect(interceptedColumns(plugin)).toEqual(['tenant_id', 'status'])

    vi.stubEnv('NODE_ENV', 'development')
    expect(interceptedColumns(plugin)).toEqual(['tenant_id'])
  })

  it('gates filters on plugin-configured feature flags', async () => {
    const featureSchema = defineRLSSchema<TestDB>({
      posts: {
        policies: [
          whenFeature('strict_reads', () =>
            filter('read', () => ({ status: 'active' }), { name: 'strict-filter' })
          ),
          allow('all', () => true)
        ]
      }
    })

    const off = await initPlugin({ schema: featureSchema, activation: { features: {} } })
    expect(interceptedColumns(off)).toEqual([])

    const on = await initPlugin({
      schema: featureSchema,
      activation: { features: { strict_reads: true } }
    })
    expect(interceptedColumns(on)).toEqual(['status'])
  })

  it('evaluates time-gated filters against the query-time clock', async () => {
    const timeSchema = defineRLSSchema<TestDB>({
      posts: {
        policies: [
          whenTimeRange(9, 17, () =>
            filter('read', () => ({ status: 'active' }), { name: 'business-hours' })
          ),
          allow('all', () => true)
        ]
      }
    })
    const plugin = await initPlugin({ schema: timeSchema })

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T10:00:00'))
    expect(interceptedColumns(plugin)).toEqual(['status'])

    vi.setSystemTime(new Date('2026-01-15T20:00:00'))
    expect(interceptedColumns(plugin)).toEqual([])
  })

  it('throws RLSSchemaError on first use when a gate returns a Promise', async () => {
    const promiseCondition = (() => Promise.resolve(true)) as unknown as PolicyActivationCondition
    const badSchema = defineRLSSchema<TestDB>({
      posts: {
        policies: [
          filter('read', () => ({ tenant_id: 't1' }), {
            name: 'promise-gate',
            condition: promiseCondition
          }),
          allow('all', () => true)
        ]
      }
    })
    const plugin = await initPlugin({ schema: badSchema })

    rlsContext.run(userCtx(), () => {
      expect(() =>
        plugin.interceptQuery!(
          new MockQueryBuilder() as unknown as AnyQueryBuilder,
          selectContext()
        )
      ).toThrow(RLSSchemaError)
    })
  })

  it('rejects async activation conditions at plugin init', async () => {
    const asyncCondition = (async () => true) as unknown as PolicyActivationCondition
    const badSchema = defineRLSSchema<TestDB>({
      posts: {
        policies: [
          allow('read', () => true, { name: 'async-gate', condition: asyncCondition })
        ]
      }
    })

    const plugin = rlsPlugin<TestDB>({ schema: badSchema })
    await expect(async () => plugin.onInit!({} as Kysely<TestDB>)).rejects.toThrow(
      RLSSchemaError
    )
  })
})

// ============================================================================
// Plugin mutation path (extendRepository)
// ============================================================================

describe('rlsPlugin activation: mutations', () => {
  it('treats an inactive allow as absent: default deny applies', async () => {
    const schema = defineRLSSchema<TestDB>({
      posts: {
        policies: [
          allow('create', () => true, {
            name: 'feature-create',
            condition: ctx => {
              const features = ctx.features as Record<string, unknown> | undefined
              return features?.['new_create'] === true
            }
          })
        ]
      }
    })

    const mockCreate = vi.fn().mockResolvedValue({ id: 1 })
    const makeRepo = (): MockRepository => ({
      tableName: 'posts',
      executor: {} as Kysely<TestDB>,
      create: mockCreate
    })

    const off = await initPlugin({ schema, activation: { features: {} } })
    const offRepo = off.extendRepository!(makeRepo())
    await rlsContext.runAsync(userCtx(), async () => {
      await expect(offRepo.create!({ title: 'x' })).rejects.toThrow(RLSPolicyViolation)
    })
    expect(mockCreate).not.toHaveBeenCalled()

    const on = await initPlugin({ schema, activation: { features: { new_create: true } } })
    const onRepo = on.extendRepository!(makeRepo())
    await rlsContext.runAsync(userCtx(), async () => {
      await onRepo.create!({ title: 'x' })
    })
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('treats an inactive deny as absent and enforces it when active', async () => {
    const schema = defineRLSSchema<TestDB>({
      posts: {
        policies: [
          allow('delete', () => true),
          whenEnvironment(['production'], () => deny('delete', () => true, { name: 'prod-lock' }))
        ]
      }
    })

    const makeRepo = (mockDelete: ReturnType<typeof vi.fn>): MockRepository => ({
      tableName: 'posts',
      executor: {} as Kysely<TestDB>,
      findById: vi.fn().mockResolvedValue({ id: 1, author_id: 1, tenant_id: 't1' }),
      delete: mockDelete
    })

    const devDelete = vi.fn().mockResolvedValue(true)
    const dev = await initPlugin({ schema, activation: { environment: 'development' } })
    const devRepo = dev.extendRepository!(makeRepo(devDelete))
    await rlsContext.runAsync(userCtx(), async () => {
      await devRepo.delete!(1)
    })
    expect(devDelete).toHaveBeenCalledTimes(1)

    const prodDelete = vi.fn().mockResolvedValue(true)
    const prod = await initPlugin({ schema, activation: { environment: 'production' } })
    const prodRepo = prod.extendRepository!(makeRepo(prodDelete))
    await rlsContext.runAsync(userCtx(), async () => {
      await expect(prodRepo.delete!(1)).rejects.toThrow(RLSPolicyViolation)
    })
    expect(prodDelete).not.toHaveBeenCalled()
  })

  it('skips inactive validate policies and enforces active ones', async () => {
    const schema = defineRLSSchema<TestDB>({
      posts: {
        policies: [
          allow('create', () => true),
          validate('create', ctx => ctx.data?.['tenant_id'] === 't1', {
            name: 'strict-tenant',
            condition: ctx => ctx.environment === 'production'
          })
        ]
      }
    })

    const makeRepo = (mockCreate: ReturnType<typeof vi.fn>): MockRepository => ({
      tableName: 'posts',
      executor: {} as Kysely<TestDB>,
      create: mockCreate
    })

    const devCreate = vi.fn().mockResolvedValue({ id: 1 })
    const dev = await initPlugin({ schema, activation: { environment: 'development' } })
    const devRepo = dev.extendRepository!(makeRepo(devCreate))
    await rlsContext.runAsync(userCtx(), async () => {
      await devRepo.create!({ title: 'x', tenant_id: 'other' })
    })
    expect(devCreate).toHaveBeenCalledTimes(1)

    const prodCreate = vi.fn().mockResolvedValue({ id: 1 })
    const prod = await initPlugin({ schema, activation: { environment: 'production' } })
    const prodRepo = prod.extendRepository!(makeRepo(prodCreate))
    await rlsContext.runAsync(userCtx(), async () => {
      await expect(prodRepo.create!({ title: 'x', tenant_id: 'other' })).rejects.toThrow(
        RLSPolicyViolation
      )
    })
    expect(prodCreate).not.toHaveBeenCalled()
  })

  it('fails closed on a throwing gate: deny stays active and blocks the mutation', async () => {
    const logger = createLogger()
    const schema = defineRLSSchema<TestDB>({
      posts: {
        policies: [
          allow('delete', () => true),
          deny('delete', () => true, {
            name: 'broken-gate',
            condition: () => {
              throw new Error('flag service down')
            }
          })
        ]
      }
    })

    const mockDelete = vi.fn().mockResolvedValue(true)
    const plugin = await initPlugin({
      schema,
      logger,
      activation: { environment: 'development' }
    })
    const repo = plugin.extendRepository!({
      tableName: 'posts',
      executor: {} as Kysely<TestDB>,
      findById: vi.fn().mockResolvedValue({ id: 1 }),
      delete: mockDelete
    } satisfies MockRepository)

    await rlsContext.runAsync(userCtx(), async () => {
      await expect(repo.delete!(1)).rejects.toThrow(RLSPolicyViolation)
    })
    expect(mockDelete).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failing closed: policy treated as ACTIVE')
    )
  })
})
