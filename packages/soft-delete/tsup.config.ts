import { defineConfig } from 'tsup'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  external: ['kysely', 'zod', '@kysera/repository'],
  target: 'esnext',
  platform: 'neutral',
  tsconfig: './tsconfig.build.json',
  define: {
    __VERSION__: JSON.stringify(pkg.version)
  }
})
