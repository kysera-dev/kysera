/**
 * Utility helper functions for RLS
 */

import type {
  RLSContext,
  PolicyEvaluationContext,
  Operation,
} from '../policy/types.js';

/**
 * Create a policy evaluation context from RLS context
 */
export function createEvaluationContext<
  TRow = unknown,
  TData = unknown
>(
  rlsCtx: RLSContext,
  options?: {
    row?: TRow;
    data?: TData;
  }
): PolicyEvaluationContext<unknown, TRow, TData> {
  const ctx: PolicyEvaluationContext<unknown, TRow, TData> = {
    auth: rlsCtx.auth,
  };

  if (options?.row !== undefined) {
    ctx.row = options.row;
  }

  if (options?.data !== undefined) {
    ctx.data = options.data;
  }

  if (rlsCtx.request !== undefined) {
    ctx.request = rlsCtx.request;
  }

  if (rlsCtx.meta !== undefined) {
    ctx.meta = rlsCtx.meta as Record<string, unknown>;
  }

  return ctx;
}

/**
 * Check if a condition function is async
 */
export function isAsyncFunction(fn: unknown): fn is (...args: unknown[]) => Promise<unknown> {
  return fn instanceof Function && fn.constructor.name === 'AsyncFunction';
}

/**
 * Safely evaluate a policy condition
 */
export async function safeEvaluate<T>(
  fn: () => T | Promise<T>,
  defaultValue: T
): Promise<T> {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return await result;
    }
    return result;
  } catch (error) {
    // Expected failure during policy evaluation - return default value
    // Logger not available in this utility function, error is handled gracefully
    return defaultValue;
  }
}

/**
 * Deep merge two objects
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = result[key];

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
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Create a simple hash for cache keys
 */
export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Normalize operations to array format
 */
export function normalizeOperations(
  operation: Operation | Operation[]
): Operation[] {
  if (Array.isArray(operation)) {
    if (operation.includes('all')) {
      return ['read', 'create', 'update', 'delete'];
    }
    return operation;
  }

  if (operation === 'all') {
    return ['read', 'create', 'update', 'delete'];
  }

  return [operation];
}
