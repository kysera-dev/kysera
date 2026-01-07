/**
 * Context Resolvers Module
 *
 * Provides infrastructure for pre-resolving async data before RLS policy evaluation.
 *
 * @module @kysera/rls/resolvers
 */

// Types
export type {
  ResolvedData,
  EnhancedRLSAuthContext,
  EnhancedRLSContext,
  BaseResolverContext,
  ContextResolver,
  CompositeResolvedData,
  ResolverCacheProvider,
  ResolverManagerOptions,
  OrganizationResolvedData,
  TenantResolvedData,
  HierarchyResolvedData,
  CommonResolvedData
} from './types.js'

// Classes
export { InMemoryCacheProvider } from './types.js'
export { ResolverManager } from './manager.js'

// Factory functions
export { createResolverManager, createResolver } from './manager.js'
