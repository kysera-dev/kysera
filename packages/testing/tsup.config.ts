import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  external: [
    'kysely',
    '@kysera/core',
    '@kysera/executor',
    'better-sqlite3',
    // node builtins used by detection.ts (platform is neutral, so esbuild
    // needs them declared explicitly)
    'node:net',
    'node:fs',
    'node:os',
    'node:path'
  ],
  target: 'esnext',
  platform: 'neutral',
  tsconfig: './tsconfig.build.json'
})
