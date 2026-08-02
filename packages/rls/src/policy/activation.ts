/**
 * Policy activation context resolution
 *
 * Builds the {@link PolicyActivationContext} that gates conditional policies
 * (created via `whenEnvironment` / `whenFeature` / `whenTimeRange` /
 * `whenCondition` or `PolicyOptions.condition`) at enforcement time.
 */

import { getEnv } from '@kysera/core'
import type { PolicyActivationContext, RLSContext } from './types.js'

/**
 * Static activation inputs configured on the plugin.
 *
 * These cover the activation-context fields that cannot be derived from the
 * per-request RLS context: the deployment environment and the set of enabled
 * feature flags. Everything else (auth, per-request meta, timestamp) is
 * resolved per call.
 */
export interface RLSActivationOptions {
  /**
   * Environment name used for `whenEnvironment` conditions.
   * Defaults to the `NODE_ENV` environment variable when omitted.
   */
  environment?: string

  /**
   * Enabled feature flags used for `whenFeature` conditions.
   * Accepts a Set, an array of flag names, or an object with truthy values.
   */
  features?: Set<string> | string[] | Record<string, unknown>

  /**
   * Static metadata merged into the activation context.
   * Per-request metadata from the RLS context overrides matching keys.
   */
  meta?: Record<string, unknown>
}

/**
 * Resolve the activation context for a single enforcement call.
 *
 * Sources, in order:
 * - `environment`: plugin option, falling back to `NODE_ENV`
 * - `features`: plugin option (no environment fallback)
 * - `timestamp`: the current time (evaluated per call, not per context)
 * - `auth` / `meta`: the active RLS context, when one exists
 *
 * @param options - Static activation options from the plugin configuration
 * @param ctx - Active RLS context, or null outside a context
 * @returns Activation context for evaluating `activationCondition` functions
 */
export function resolveActivationContext(
  options: RLSActivationOptions | undefined,
  ctx: RLSContext | null
): PolicyActivationContext {
  const activation: PolicyActivationContext = {
    timestamp: new Date()
  }

  const environment = options?.environment ?? getEnv('NODE_ENV')
  if (environment !== undefined) {
    activation.environment = environment
  }

  if (options?.features !== undefined) {
    activation.features = options.features
  }

  const contextMeta =
    ctx !== null && typeof ctx.meta === 'object' && ctx.meta !== null
      ? (ctx.meta as Record<string, unknown>)
      : undefined
  if (options?.meta !== undefined || contextMeta !== undefined) {
    activation.meta = { ...options?.meta, ...contextMeta }
  }

  if (ctx !== null) {
    // Spread: RLSAuthContext has no index signature, the activation auth
    // shape does — a fresh object literal bridges the two
    activation.auth = { ...ctx.auth }
  }

  return activation
}
