/**
 * ESLint Configuration for Vertical Slice Architecture
 *
 * This configuration enforces module boundaries in a Vertical Slice Architecture.
 * Use this to prevent cross-module imports and maintain clean boundaries between features.
 *
 * @example Install eslint-plugin-boundaries
 * ```bash
 * npm install -D eslint-plugin-boundaries
 * # or
 * pnpm add -D eslint-plugin-boundaries
 * ```
 *
 * @example Usage in your eslint.config.js
 * ```javascript
 * import { createVerticalSliceConfig } from '@kysera/core/eslint';
 *
 * export default [
 *   // Your other configs...
 *   createVerticalSliceConfig({
 *     sharedPath: 'src/shared',
 *     modulesPath: 'src/modules',
 *     appPath: 'src/app',
 *   }),
 * ];
 * ```
 *
 * @module @kysera/core/eslint
 */

/**
 * Creates an ESLint boundaries configuration for Vertical Slice Architecture.
 *
 * @param {Object} options - Configuration options
 * @param {string} [options.sharedPath='src/shared'] - Path to shared/infrastructure code
 * @param {string} [options.modulesPath='src/modules'] - Path to business modules
 * @param {string} [options.appPath='src/app'] - Path to application layer
 * @param {boolean} [options.allowApiToApi=false] - Allow module-api to import from other module-api
 * @returns {Object} ESLint flat config object
 *
 * @example Project structure
 * ```
 * src/
 * ├── shared/           # Infrastructure layer (can be imported by all)
 * │   ├── db/           # Database connection, types
 * │   └── lib/          # Shared utilities
 * │
 * ├── modules/          # Business modules (Vertical Slices)
 * │   ├── users/
 * │   │   ├── api/      # PUBLIC INTERFACE - exported to other modules
 * │   │   │   ├── index.ts
 * │   │   │   └── types.ts
 * │   │   ├── internal/ # PRIVATE IMPLEMENTATION - never import from outside
 * │   │   │   ├── queries/
 * │   │   │   ├── domain/
 * │   │   │   └── use-cases/
 * │   │   └── index.ts  # Re-exports from api/
 * │   │
 * │   └── billing/
 * │       ├── api/
 * │       ├── internal/
 * │       └── index.ts
 * │
 * └── app/              # Application layer (routes, server)
 *     ├── server.ts
 *     └── routes.ts
 * ```
 */
export function createVerticalSliceConfig(options = {}) {
  const {
    sharedPath = 'src/shared',
    modulesPath = 'src/modules',
    appPath = 'src/app',
    allowApiToApi = false,
  } = options;

  return {
    plugins: {
      // Note: User must install eslint-plugin-boundaries
      // boundaries: require('eslint-plugin-boundaries'),
    },
    settings: {
      'boundaries/elements': [
        // Shared infrastructure - can be imported by everything
        {
          type: 'shared',
          pattern: `${sharedPath}/**`,
          capture: ['category'],
        },
        // Module public API - exported interface
        {
          type: 'module-api',
          pattern: `${modulesPath}/*/api/**`,
          capture: ['module'],
        },
        // Module internal implementation - private
        {
          type: 'module-internal',
          pattern: `${modulesPath}/*/internal/**`,
          capture: ['module'],
        },
        // Module barrel export
        {
          type: 'module-barrel',
          pattern: `${modulesPath}/*/index.ts`,
          capture: ['module'],
        },
        // Application layer
        {
          type: 'app',
          pattern: `${appPath}/**`,
        },
      ],
      'boundaries/ignore': [
        // Ignore test files
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/test/**',
        '**/__tests__/**',
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // shared can import only from shared
            {
              from: 'shared',
              allow: ['shared'],
            },

            // module-internal can import from shared and its own module-api
            {
              from: 'module-internal',
              allow: [
                'shared',
                // Allow importing from same module's api
                { type: 'module-api', module: '${module}' },
              ],
            },

            // module-api can import from shared only
            {
              from: 'module-api',
              allow: allowApiToApi ? ['shared', 'module-api'] : ['shared'],
            },

            // module-barrel re-exports from api
            {
              from: 'module-barrel',
              allow: [
                { type: 'module-api', module: '${module}' },
              ],
            },

            // app can import from shared and module-api (NOT module-internal!)
            {
              from: 'app',
              allow: ['shared', 'module-api', 'module-barrel'],
            },
          ],
        },
      ],

      // Prevent importing from internal of other modules
      'boundaries/no-private': [
        'error',
        {
          allowUncles: false,
        },
      ],

      // Prevent unknown imports
      'boundaries/no-unknown': ['error'],
    },
  };
}

/**
 * Default Vertical Slice configuration.
 * Uses standard paths: src/shared, src/modules, src/app
 */
export const defaultVerticalSliceConfig = createVerticalSliceConfig();

/**
 * Strict Vertical Slice configuration.
 * Does not allow module-api to import from other module-api.
 * Forces all cross-module communication through shared layer.
 */
export const strictVerticalSliceConfig = createVerticalSliceConfig({
  allowApiToApi: false,
});

/**
 * Relaxed Vertical Slice configuration.
 * Allows module-api to import from other module-api.
 * Useful when modules need to compose each other's types.
 */
export const relaxedVerticalSliceConfig = createVerticalSliceConfig({
  allowApiToApi: true,
});
