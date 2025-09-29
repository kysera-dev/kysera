import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],  // ESM only!
  dts: {
    tsconfig: './tsconfig.build.json'
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  external: ['kysely', 'zod', '@kysera/core'],
  target: 'esnext',  // Latest JavaScript for Bun/Deno
  platform: 'neutral',  // Platform-agnostic
  tsconfig: './tsconfig.build.json'
})