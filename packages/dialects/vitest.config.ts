import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'test/'],
      thresholds: {
        // Slightly lower thresholds for dialects package since it contains
        // database-dependent code that requires real database connections
        // for full integration testing (Postgres/MySQL error paths)
        lines: 85,
        functions: 90,
        branches: 75,
        statements: 85
      }
    }
  }
})
