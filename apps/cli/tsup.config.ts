import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'], // ESM only as per spec
  dts: false, // Temporarily disabled due to tsup issue
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false, // Don't minify for CLI for better error messages
  treeshake: true,
  target: 'esnext',
  platform: 'node', // CLI runs on Node.js
  tsconfig: './tsconfig.json',
  shims: false,
  // Mark all dependencies as external except workspace packages
  external: [
    'commander',
    'chalk',
    'ora',
    'prompts',
    'cli-table3',
    'handlebars',
    'fs-extra',
    'kysely',
    'zod',
    'dotenv',
    'cosmiconfig',
    'cosmiconfig-typescript-loader',
    'execa',
    'figures',
    'strip-ansi',
    'wrap-ansi',
    'glob',
    'pg',
    'mysql2',
    'better-sqlite3',
  ],
  noExternal: [
    '@kysera/core',
    '@kysera/repository',
    '@kysera/migrations',
    '@kysera/audit',
    '@kysera/soft-delete',
    '@kysera/timestamps',
  ],
});
