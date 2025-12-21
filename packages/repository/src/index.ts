// Core repository exports
export * from './repository.js';
export * from './plugin.js';
export type * from './types.js';
export * from './validation.js';
export * from './validation-adapter.js';
export * from './base-repository.js';
export * from './table-operations.js';
export * from './helpers.js';
export * from './upsert.js';
export * from './context-aware.js';

// Re-export core types from @kysera/executor for convenience
export type { Plugin, QueryBuilderContext } from '@kysera/executor';
export { PluginValidationError, validatePlugins, resolvePluginOrder } from '@kysera/executor';
