import { defineConfig } from 'tsup'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Read version from package.json
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'))
const version = packageJson.version

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'], // ESM only!
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  external: ['kysely'],
  target: 'esnext', // Latest JavaScript for Bun/Deno
  platform: 'neutral', // Platform-agnostic
  tsconfig: './tsconfig.build.json',
  // Replace __VERSION__ placeholder at build time
  define: {
    '__VERSION__': JSON.stringify(version)
  }
})
