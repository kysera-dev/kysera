import { AsyncLocalStorage } from 'node:async_hooks';
import type { RLSContext } from './types.js';

/**
 * AsyncLocalStorage instance for RLS context
 * Provides automatic context propagation across async boundaries
 */
export const rlsStorage = new AsyncLocalStorage<RLSContext>();
