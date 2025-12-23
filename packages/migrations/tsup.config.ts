import { defineConfig } from 'tsup'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  entry: ['src/index.ts', 'src/schemas.ts'],
  format: ['esm'],
  dts: {
    compilerOptions: {
      composite: false
    }
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  external: ['kysely', 'zod', '@kysera/core'],
  target: 'esnext',
  platform: 'neutral',
  tsconfig: './tsconfig.build.json',
  define: {
    __VERSION__: JSON.stringify(pkg.version)
  }
})
