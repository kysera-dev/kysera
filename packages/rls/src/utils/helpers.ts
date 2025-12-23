/**
 * Utility helper functions for RLS
 */

import type { RLSContext, PolicyEvaluationContext, Operation } from '../policy/types.js'

/**
 * Create a policy evaluation context from RLS context
 */
export function createEvaluationContext<TRow = unknown, TData = unknown>(
  rlsCtx: RLSContext,
  options?: {
    row?: TRow
    data?: TData
  }
): PolicyEvaluationContext<unknown, TRow, TData> {
  const ctx: PolicyEvaluationContext<unknown, TRow, TData> = {
    auth: rlsCtx.auth
  }

  if (options?.row !== undefined) {
    ctx.row = options.row
  }

  if (options?.data !== undefined) {
    ctx.data = options.data
  }

  if (rlsCtx.request !== undefined) {
    ctx.request = rlsCtx.request
  }

  if (rlsCtx.meta !== undefined) {
    ctx.meta = rlsCtx.meta as Record<string, unknown>
  }

  return ctx
}

/**
 * Check if a condition function is async
 *
 * NOTE: This function checks both constructor.name (for native async functions)
 * and return type (for transpiled code that returns Promise).
 * Transpilers often convert async functions to regular functions that return Promise.
 */
export function isAsyncFunction(fn: unknown): fn is (...args: unknown[]) => Promise<unknown> {
  if (!(fn instanceof Function)) {
    return false
  }

  // Check constructor name for native async functions
  if (fn.constructor.name === 'AsyncFunction') {
    return true
  }

  // For transpiled code: call the function with empty args and check if it returns a Promise
  // This is safe because policy conditions should be pure functions
  try {
    const result = (fn as Function)()
    return result instanceof Promise
  } catch {
    // If calling with no args throws, assume it's not async
    // (async functions that require args should be wrapped in the policy definition)
    return false
  }
}

/**
 * Safely evaluate a policy condition
 */
export async function safeEvaluate<T>(fn: () => T | Promise<T>, defaultValue: T): Promise<T> {
  try {
    const result = fn()
    if (result instanceof Promise) {
      return await result
    }
    return result
  } catch (_error) {
    // Expected failure during policy evaluation - return default value
    // Logger not available in this utility function, error is handled gracefully
    return defaultValue
  }
}

/**
 * Deep merge two objects
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key]
    const targetValue = result[key]

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T]
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T]
    }
  }

  return result
}

/**
 * Create a simple hash for cache keys
 */
export function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(36)
}

/**
 * Normalize operations to array format
 */
export function normalizeOperations(operation: Operation | Operation[]): Operation[] {
  if (Array.isArray(operation)) {
    if (operation.includes('all')) {
      return ['read', 'create', 'update', 'delete']
    }
    return operation
  }

  if (operation === 'all') {
    return ['read', 'create', 'update', 'delete']
  }

  return [operation]
}
