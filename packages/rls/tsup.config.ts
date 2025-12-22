import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

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
  tsconfig: './tsconfig.build.json',
  external: [
    'kysely',
    '@kysera/core',
    '@kysera/repository',
    'node:async_hooks',
  ],
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
});
