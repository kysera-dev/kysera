import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/native/index.ts'],
  format: ['esm'],
  dts: {
    resolve: true,
    compilerOptions: {
      composite: false,
    },
  },
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: [
    'kysely',
    '@kysera/core',
    '@kysera/repository',
    'node:async_hooks',
  ],
});
