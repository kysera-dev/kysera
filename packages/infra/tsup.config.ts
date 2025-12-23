import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/health/index.ts',
    'src/resilience/index.ts',
    'src/pool/index.ts',
    'src/shutdown.ts'
  ],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  external: ['kysely', '@kysera/core'],
  target: 'esnext',
  platform: 'neutral',
  tsconfig: './tsconfig.build.json'
})
