import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      // Ratchet floors (current: ~85/74/86/86). The postgres/mysql advisory
      // lock paths only execute in the docker multi-db suite; raise toward the
      // repo standard (95/95/85/95) as those paths gain default-run coverage.
      thresholds: {
        lines: 84,
        functions: 84,
        branches: 72,
        statements: 84
      }
    }
  }
})
