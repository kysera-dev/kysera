// Core repository exports
export * from './repository.js'
export * from './plugin.js'
// Types AND runtime helpers (normalizePrimaryKeyConfig, isCompositeKey, …).
// `export type *` compiled fine but erased the function exports at runtime —
// dist/index.d.ts still declared them, so imports were undefined when called.
export * from './types.js'
export * from './validation.js'
export * from './validation-adapter.js'
export * from './base-repository.js'
export * from './table-operations.js'
export * from './helpers.js'
export * from './upsert.js'
export * from './context-aware.js'
export * from './primary-key-utils.js'
export * from './column-validation.js'
export * from './operators.js'

// Re-export core types from @kysera/executor for convenience
export type { Plugin, QueryBuilderContext } from '@kysera/executor'
export { PluginValidationError, validatePlugins, resolvePluginOrder } from '@kysera/executor'
