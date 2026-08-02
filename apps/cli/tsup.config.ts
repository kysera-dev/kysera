import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'], // ESM only as per spec
  dts: false, // Temporarily disabled due to tsup issue
  // Code splitting keeps startup fast: dynamic imports inside action
  // handlers (drivers, faker, generators) become separate chunks that
  // only load when the command actually runs.
  splitting: true,
  sourcemap: true,
  clean: true,
  minify: false, // Don't minify for CLI for better error messages
  // 'smallest' drops imports kept only for potential side effects
  // (e.g. an unused `import { sql } from 'kysely'` costs ~50ms startup)
  treeshake: 'smallest',
  target: 'esnext',
  platform: 'node', // CLI runs on Node.js
  tsconfig: './tsconfig.json',
  shims: false,
  // Real runtime dependencies stay external (resolved from node_modules)
  external: [
    'commander',
    '@xec-sh/kit',
    'kysely',
    'zod',
    'dotenv',
    'cosmiconfig',
    'cosmiconfig-typescript-loader',
    'execa',
    'glob',
    'js-yaml',
    'pg',
    'mysql2',
    'better-sqlite3',
    '@faker-js/faker'
  ],
  noExternal: [
    '@kysera/core',
    '@kysera/dialects',
    '@kysera/repository',
    '@kysera/migrations',
    '@kysera/audit',
    '@kysera/soft-delete',
    '@kysera/timestamps'
  ]
})
