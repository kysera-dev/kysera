import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],  // ESM only!
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  external: ['kysely'],
  target: 'esnext',  // Latest JavaScript for Bun/Deno
  platform: 'neutral',  // Platform-agnostic
  tsconfig: './tsconfig.build.json'
})