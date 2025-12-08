import { rlsStorage } from './storage.js';
import type { RLSContext, RLSAuthContext, RLSRequestContext } from './types.js';
import { RLSContextError, RLSContextValidationError } from '../errors.js';

/**
 * Options for creating RLS context
 */
export interface CreateRLSContextOptions<TUser = unknown, TMeta = unknown> {
  auth: RLSAuthContext<TUser>;
  request?: Partial<RLSRequestContext>;
  meta?: TMeta;
}

/**
 * Create a new RLS context
 */
export function createRLSContext<TUser = unknown, TMeta = unknown>(
  options: CreateRLSContextOptions<TUser, TMeta>
): RLSContext<TUser, TMeta> {
  validateAuthContext(options.auth);

  const context: RLSContext<TUser, TMeta> = {
    auth: {
      ...options.auth,
      isSystem: options.auth.isSystem ?? false, // Default to false if not provided
    },
    timestamp: new Date(),
  };

  if (options.request) {
    context.request = {
      ...options.request,
      timestamp: options.request.timestamp ?? new Date(),
    } as RLSRequestContext;
  }

  if (options.meta !== undefined) {
    context.meta = options.meta;
  }

  return context;
}

/**
 * Validate auth context
 */
function validateAuthContext(auth: RLSAuthContext): void {
  if (auth.userId === undefined || auth.userId === null) {
    throw new RLSContextValidationError('userId is required in auth context', 'userId');
  }

  if (!Array.isArray(auth.roles)) {
    throw new RLSContextValidationError('roles must be an array', 'roles');
  }
}

/**
 * RLS Context Manager
 * Manages RLS context using AsyncLocalStorage for automatic propagation
 */
class RLSContextManager {
  /**
   * Run a synchronous function within an RLS context
   */
  run<T>(context: RLSContext, fn: () => T): T {
    return rlsStorage.run(context, fn);
  }

  /**
   * Run an async function within an RLS context
   */
  async runAsync<T>(context: RLSContext, fn: () => Promise<T>): Promise<T> {
    return rlsStorage.run(context, fn);
  }

  /**
   * Get current RLS context
   * @throws RLSContextError if no context is set
   */
  getContext(): RLSContext {
    const ctx = rlsStorage.getStore();
    if (!ctx) {
      throw new RLSContextError();
    }
    return ctx;
  }

  /**
   * Get current RLS context or null if not set
   */
  getContextOrNull(): RLSContext | null {
    return rlsStorage.getStore() ?? null;
  }

  /**
   * Check if running within RLS context
   */
  hasContext(): boolean {
    return rlsStorage.getStore() !== undefined;
  }

  /**
   * Get current auth context
   * @throws RLSContextError if no context is set
   */
  getAuth(): RLSAuthContext {
    return this.getContext().auth;
  }

  /**
   * Get current user ID
   * @throws RLSContextError if no context is set
   */
  getUserId(): string | number {
    return this.getAuth().userId;
  }

  /**
   * Get current tenant ID
   * @throws RLSContextError if no context is set
   */
  getTenantId(): string | number | undefined {
    return this.getAuth().tenantId;
  }

  /**
   * Check if current user has a specific role
   */
  hasRole(role: string): boolean {
    const ctx = this.getContextOrNull();
    return ctx?.auth.roles.includes(role) ?? false;
  }

  /**
   * Check if current user has a specific permission
   */
  hasPermission(permission: string): boolean {
    const ctx = this.getContextOrNull();
    return ctx?.auth.permissions?.includes(permission) ?? false;
  }

  /**
   * Check if current context is a system context (bypasses RLS)
   */
  isSystem(): boolean {
    const ctx = this.getContextOrNull();
    return ctx?.auth.isSystem ?? false;
  }

  /**
   * Create a system context for operations that should bypass RLS
   */
  asSystem<T>(fn: () => T): T {
    const currentCtx = this.getContextOrNull();
    if (!currentCtx) {
      throw new RLSContextError('Cannot create system context without existing context');
    }

    const systemCtx: RLSContext = {
      ...currentCtx,
      auth: { ...currentCtx.auth, isSystem: true },
    };

    return this.run(systemCtx, fn);
  }

  /**
   * Create a system context for async operations
   */
  async asSystemAsync<T>(fn: () => Promise<T>): Promise<T> {
    const currentCtx = this.getContextOrNull();
    if (!currentCtx) {
      throw new RLSContextError('Cannot create system context without existing context');
    }

    const systemCtx: RLSContext = {
      ...currentCtx,
      auth: { ...currentCtx.auth, isSystem: true },
    };

    return this.runAsync(systemCtx, fn);
  }
}

// Export singleton instance
export const rlsContext = new RLSContextManager();

/**
 * Convenience function to run code within RLS context
 */
export function withRLSContext<T>(context: RLSContext, fn: () => T): T {
  return rlsContext.run(context, fn);
}

/**
 * Convenience function to run async code within RLS context
 */
export async function withRLSContextAsync<T>(
  context: RLSContext,
  fn: () => Promise<T>
): Promise<T> {
  return rlsContext.runAsync(context, fn);
}
