/**
 * Conditional Policy Activation Tests
 *
 * Tests for feature flags, environment-based, and time-based policy activation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  allow,
  deny,
  filter,
  validate,
  whenEnvironment,
  whenFeature,
  whenTimeRange,
  whenCondition,
  type PolicyOptions
} from '../../src/policy/builder.js'
import type {
  PolicyActivationContext,
  ConditionalPolicyDefinition
} from '../../src/policy/types.js'

// ============================================================================
// Helper Functions
// ============================================================================

function createActivationContext(
  overrides: Partial<PolicyActivationContext> = {}
): PolicyActivationContext {
  return {
    environment: 'production',
    features: {},
    timestamp: new Date(),
    ...overrides
  }
}

function evaluateActivation(
  policy: ConditionalPolicyDefinition,
  ctx: PolicyActivationContext
): boolean {
  if (!policy.activationCondition) {
    return true // always active if no condition
  }
  return policy.activationCondition(ctx)
}

// ============================================================================
// Basic Policy Builder Tests (Activation Support)
// ============================================================================

describe('Policy Builders with Activation Conditions', () => {
  describe('allow()', () => {
    it('should support activation condition', () => {
      const policy = allow('read', () => true, {
        name: 'test-allow',
        condition: ctx => ctx.environment === 'production'
      })

      expect(policy.activationCondition).toBeDefined()

      const prodCtx = createActivationContext({ environment: 'production' })
      expect(evaluateActivation(policy, prodCtx)).toBe(true)

      const devCtx = createActivationContext({ environment: 'development' })
      expect(evaluateActivation(policy, devCtx)).toBe(false)
    })
  })

  describe('deny()', () => {
    it('should support activation condition', () => {
      const policy = deny('delete', () => true, {
        name: 'test-deny',
        condition: ctx => ctx.features['strict_mode'] === true
      })

      const strictCtx = createActivationContext({ features: { strict_mode: true } })
      expect(evaluateActivation(policy, strictCtx)).toBe(true)

      const normalCtx = createActivationContext({ features: { strict_mode: false } })
      expect(evaluateActivation(policy, normalCtx)).toBe(false)
    })
  })

  describe('filter()', () => {
    it('should support activation condition', () => {
      const policy = filter('read', () => ({ active: true }), {
        name: 'test-filter',
        condition: ctx => ctx.environment !== 'test'
      })

      const prodCtx = createActivationContext({ environment: 'production' })
      expect(evaluateActivation(policy, prodCtx)).toBe(true)

      const testCtx = createActivationContext({ environment: 'test' })
      expect(evaluateActivation(policy, testCtx)).toBe(false)
    })
  })

  describe('validate()', () => {
    it('should support activation condition', () => {
      const policy = validate('create', () => true, {
        name: 'test-validate',
        condition: ctx => ctx.features['validation_v2'] === true
      })

      const v2Ctx = createActivationContext({ features: { validation_v2: true } })
      expect(evaluateActivation(policy, v2Ctx)).toBe(true)

      const v1Ctx = createActivationContext({ features: { validation_v2: false } })
      expect(evaluateActivation(policy, v1Ctx)).toBe(false)
    })
  })
})

// ============================================================================
// whenEnvironment Tests
// ============================================================================

describe('whenEnvironment', () => {
  it('should activate policy for specified environments', () => {
    const policy = whenEnvironment(['production', 'staging'], () =>
      allow('read', () => true, { name: 'prod-staging-only' })
    )

    const prodCtx = createActivationContext({ environment: 'production' })
    expect(evaluateActivation(policy, prodCtx)).toBe(true)

    const stagingCtx = createActivationContext({ environment: 'staging' })
    expect(evaluateActivation(policy, stagingCtx)).toBe(true)

    const devCtx = createActivationContext({ environment: 'development' })
    expect(evaluateActivation(policy, devCtx)).toBe(false)
  })

  it('should work with single environment', () => {
    const policy = whenEnvironment(['production'], () =>
      deny('delete', () => true, { name: 'prod-no-delete' })
    )

    const prodCtx = createActivationContext({ environment: 'production' })
    expect(evaluateActivation(policy, prodCtx)).toBe(true)

    const devCtx = createActivationContext({ environment: 'development' })
    expect(evaluateActivation(policy, devCtx)).toBe(false)
  })

  it('should preserve original policy properties', () => {
    const policy = whenEnvironment(['production'], () =>
      allow('read', () => true, {
        name: 'test-policy',
        priority: 100,
        hints: { cacheable: true }
      })
    )

    expect(policy.name).toBe('test-policy')
    expect(policy.priority).toBe(100)
    expect(policy.hints?.cacheable).toBe(true)
  })
})

// ============================================================================
// whenFeature Tests
// ============================================================================

describe('whenFeature', () => {
  it('should activate policy when feature is enabled', () => {
    const policy = whenFeature('new_permission_system', () =>
      filter('read', () => ({ version: 2 }), { name: 'v2-filter' })
    )

    const enabledCtx = createActivationContext({
      features: { new_permission_system: true }
    })
    expect(evaluateActivation(policy, enabledCtx)).toBe(true)

    const disabledCtx = createActivationContext({
      features: { new_permission_system: false }
    })
    expect(evaluateActivation(policy, disabledCtx)).toBe(false)
  })

  it('should not activate when feature is missing', () => {
    const policy = whenFeature('unknown_feature', () =>
      allow('read', () => true, { name: 'feature-policy' })
    )

    const ctx = createActivationContext({ features: {} })
    expect(evaluateActivation(policy, ctx)).toBe(false)
  })

  it('should handle truthy feature values', () => {
    const policy = whenFeature('numeric_feature', () =>
      allow('read', () => true, { name: 'numeric-feature-policy' })
    )

    const truthyCtx = createActivationContext({
      features: { numeric_feature: 1 }
    })
    expect(evaluateActivation(policy, truthyCtx)).toBe(true)

    const falsyCtx = createActivationContext({
      features: { numeric_feature: 0 }
    })
    expect(evaluateActivation(policy, falsyCtx)).toBe(false)
  })
})

// ============================================================================
// whenTimeRange Tests
// ============================================================================

describe('whenTimeRange', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should activate policy during business hours', () => {
    const policy = whenTimeRange(9, 17, () =>
      allow('read', () => true, { name: 'business-hours-only' })
    )

    // 10:00 AM - within range
    vi.setSystemTime(new Date('2024-01-15T10:00:00'))
    let ctx = createActivationContext({ timestamp: new Date() })
    expect(evaluateActivation(policy, ctx)).toBe(true)

    // 3:00 PM - within range
    vi.setSystemTime(new Date('2024-01-15T15:00:00'))
    ctx = createActivationContext({ timestamp: new Date() })
    expect(evaluateActivation(policy, ctx)).toBe(true)

    // 8:00 AM - before range
    vi.setSystemTime(new Date('2024-01-15T08:00:00'))
    ctx = createActivationContext({ timestamp: new Date() })
    expect(evaluateActivation(policy, ctx)).toBe(false)

    // 6:00 PM - after range
    vi.setSystemTime(new Date('2024-01-15T18:00:00'))
    ctx = createActivationContext({ timestamp: new Date() })
    expect(evaluateActivation(policy, ctx)).toBe(false)
  })

  it('should handle midnight crossing', () => {
    // Night hours: 22:00 to 06:00
    const policy = whenTimeRange(22, 6, () =>
      deny('create', () => true, { name: 'night-maintenance' })
    )

    // 11:00 PM - within range
    vi.setSystemTime(new Date('2024-01-15T23:00:00'))
    let ctx = createActivationContext({ timestamp: new Date() })
    expect(evaluateActivation(policy, ctx)).toBe(true)

    // 2:00 AM - within range (next day)
    vi.setSystemTime(new Date('2024-01-16T02:00:00'))
    ctx = createActivationContext({ timestamp: new Date() })
    expect(evaluateActivation(policy, ctx)).toBe(true)

    // 10:00 AM - outside range
    vi.setSystemTime(new Date('2024-01-15T10:00:00'))
    ctx = createActivationContext({ timestamp: new Date() })
    expect(evaluateActivation(policy, ctx)).toBe(false)
  })

  it('should handle edge cases at boundaries', () => {
    const policy = whenTimeRange(9, 17, () =>
      allow('read', () => true, { name: 'boundary-test' })
    )

    // Exactly 9:00 AM - should be included
    vi.setSystemTime(new Date('2024-01-15T09:00:00'))
    let ctx = createActivationContext({ timestamp: new Date() })
    expect(evaluateActivation(policy, ctx)).toBe(true)

    // 4:59 PM - should be included
    vi.setSystemTime(new Date('2024-01-15T16:59:59'))
    ctx = createActivationContext({ timestamp: new Date() })
    expect(evaluateActivation(policy, ctx)).toBe(true)

    // Exactly 5:00 PM - should NOT be included (exclusive end)
    vi.setSystemTime(new Date('2024-01-15T17:00:00'))
    ctx = createActivationContext({ timestamp: new Date() })
    expect(evaluateActivation(policy, ctx)).toBe(false)
  })
})

// ============================================================================
// whenCondition Tests
// ============================================================================

describe('whenCondition', () => {
  it('should support custom activation conditions', () => {
    const policy = whenCondition(
      ctx => ctx.environment === 'production' && ctx.features['beta'] === true,
      () => allow('read', () => true, { name: 'beta-production' })
    )

    const matchingCtx = createActivationContext({
      environment: 'production',
      features: { beta: true }
    })
    expect(evaluateActivation(policy, matchingCtx)).toBe(true)

    const prodNoBetaCtx = createActivationContext({
      environment: 'production',
      features: { beta: false }
    })
    expect(evaluateActivation(policy, prodNoBetaCtx)).toBe(false)

    const devBetaCtx = createActivationContext({
      environment: 'development',
      features: { beta: true }
    })
    expect(evaluateActivation(policy, devBetaCtx)).toBe(false)
  })

  it('should support complex conditional logic', () => {
    const policy = whenCondition(
      ctx => {
        const hour = ctx.timestamp.getHours()
        const isPeakHours = hour >= 9 && hour < 17
        const isLoadTest = ctx.features['load_test'] === true

        // Only active during peak hours OR during load testing
        return isPeakHours || isLoadTest
      },
      () => filter('read', () => ({ cached: true }), { name: 'peak-cache' })
    )

    vi.useFakeTimers()

    // Peak hours, no load test
    vi.setSystemTime(new Date('2024-01-15T12:00:00'))
    let ctx = createActivationContext({
      timestamp: new Date(),
      features: { load_test: false }
    })
    expect(evaluateActivation(policy, ctx)).toBe(true)

    // Off-peak, with load test
    vi.setSystemTime(new Date('2024-01-15T22:00:00'))
    ctx = createActivationContext({
      timestamp: new Date(),
      features: { load_test: true }
    })
    expect(evaluateActivation(policy, ctx)).toBe(true)

    // Off-peak, no load test
    ctx = createActivationContext({
      timestamp: new Date(),
      features: { load_test: false }
    })
    expect(evaluateActivation(policy, ctx)).toBe(false)

    vi.useRealTimers()
  })
})

// ============================================================================
// Combining Conditional Wrappers
// ============================================================================

describe('Combining Conditional Wrappers', () => {
  it('should allow nesting whenEnvironment and whenFeature', () => {
    // First check environment, then check feature
    const outerPolicy = whenEnvironment(['production'], () =>
      whenFeature('strict_mode', () =>
        deny('delete', () => true, { name: 'strict-delete-deny' })
      )
    )

    // Production + strict_mode
    const prodStrictCtx = createActivationContext({
      environment: 'production',
      features: { strict_mode: true }
    })
    expect(evaluateActivation(outerPolicy, prodStrictCtx)).toBe(true)

    // Production + no strict_mode
    const prodNoStrictCtx = createActivationContext({
      environment: 'production',
      features: { strict_mode: false }
    })
    // Outer passes (production), but inner fails
    expect(evaluateActivation(outerPolicy, prodNoStrictCtx)).toBe(false)

    // Development + strict_mode
    const devStrictCtx = createActivationContext({
      environment: 'development',
      features: { strict_mode: true }
    })
    // Outer fails (not production)
    expect(evaluateActivation(outerPolicy, devStrictCtx)).toBe(false)
  })

  it('should combine time range with feature flag', () => {
    vi.useFakeTimers()

    const policy = whenTimeRange(9, 17, () =>
      whenFeature('business_hours_only', () =>
        allow('read', () => true, { name: 'business-feature' })
      )
    )

    // Business hours + feature enabled
    vi.setSystemTime(new Date('2024-01-15T12:00:00'))
    let ctx = createActivationContext({
      timestamp: new Date(),
      features: { business_hours_only: true }
    })
    expect(evaluateActivation(policy, ctx)).toBe(true)

    // Business hours + feature disabled
    ctx = createActivationContext({
      timestamp: new Date(),
      features: { business_hours_only: false }
    })
    expect(evaluateActivation(policy, ctx)).toBe(false)

    // After hours + feature enabled
    vi.setSystemTime(new Date('2024-01-15T20:00:00'))
    ctx = createActivationContext({
      timestamp: new Date(),
      features: { business_hours_only: true }
    })
    expect(evaluateActivation(policy, ctx)).toBe(false)

    vi.useRealTimers()
  })
})

// ============================================================================
// Real-World Scenarios
// ============================================================================

describe('Real-World Scenarios', () => {
  describe('Gradual Feature Rollout', () => {
    it('should support percentage-based rollout', () => {
      const policy = whenCondition(
        ctx => {
          const rolloutPercentage = ctx.features['new_policy_rollout'] as number
          if (typeof rolloutPercentage !== 'number') return false

          // Use some user attribute to determine bucket
          // In real scenario, this would use user ID hash
          const userBucket = Math.random() * 100
          return userBucket < rolloutPercentage
        },
        () => allow('read', () => true, { name: 'new-policy' })
      )

      // 0% rollout
      let ctx = createActivationContext({
        features: { new_policy_rollout: 0 }
      })
      // With 0%, should never activate
      expect(evaluateActivation(policy, ctx)).toBe(false)

      // 100% rollout
      ctx = createActivationContext({
        features: { new_policy_rollout: 100 }
      })
      // With 100%, should always activate
      expect(evaluateActivation(policy, ctx)).toBe(true)
    })
  })

  describe('Maintenance Window', () => {
    it('should restrict operations during maintenance', () => {
      vi.useFakeTimers()

      const maintenancePolicy = whenCondition(
        ctx => {
          const maintenanceWindow = ctx.features['maintenance_window'] as {
            start: string
            end: string
          } | undefined

          if (!maintenanceWindow) return false

          const now = ctx.timestamp
          const start = new Date(maintenanceWindow.start)
          const end = new Date(maintenanceWindow.end)

          return now >= start && now < end
        },
        () => deny('all', () => true, { name: 'maintenance-deny', priority: 1000 })
      )

      // During maintenance window
      vi.setSystemTime(new Date('2024-01-15T02:30:00'))
      let ctx = createActivationContext({
        timestamp: new Date(),
        features: {
          maintenance_window: {
            start: '2024-01-15T02:00:00',
            end: '2024-01-15T04:00:00'
          }
        }
      })
      expect(evaluateActivation(maintenancePolicy, ctx)).toBe(true)

      // Outside maintenance window
      vi.setSystemTime(new Date('2024-01-15T10:00:00'))
      ctx = createActivationContext({
        timestamp: new Date(),
        features: {
          maintenance_window: {
            start: '2024-01-15T02:00:00',
            end: '2024-01-15T04:00:00'
          }
        }
      })
      expect(evaluateActivation(maintenancePolicy, ctx)).toBe(false)

      vi.useRealTimers()
    })
  })

  describe('Environment-Specific Behavior', () => {
    it('should have different policies per environment', () => {
      // Strict policy for production
      const prodPolicy = whenEnvironment(['production'], () =>
        deny('delete', () => true, { name: 'prod-no-delete', priority: 200 })
      )

      // Relaxed policy for development
      const devPolicy = whenEnvironment(['development', 'test'], () =>
        allow('all', () => true, { name: 'dev-allow-all', priority: 200 })
      )

      const prodCtx = createActivationContext({ environment: 'production' })
      const devCtx = createActivationContext({ environment: 'development' })
      const testCtx = createActivationContext({ environment: 'test' })

      expect(evaluateActivation(prodPolicy, prodCtx)).toBe(true)
      expect(evaluateActivation(prodPolicy, devCtx)).toBe(false)
      expect(evaluateActivation(prodPolicy, testCtx)).toBe(false)

      expect(evaluateActivation(devPolicy, prodCtx)).toBe(false)
      expect(evaluateActivation(devPolicy, devCtx)).toBe(true)
      expect(evaluateActivation(devPolicy, testCtx)).toBe(true)
    })
  })
})
