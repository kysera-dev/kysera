import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Real-database integration files gate themselves: TEST_POSTGRES/TEST_MYSQL
    // force them on/off, otherwise a TCP probe of the rls docker stack decides
    // (see test/integration/*.test.ts and @kysera/testing detection.ts) — so
    // skipped dialects show up in the report with the reason instead of being
    // silently excluded here.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts']
    },
    testTimeout: 30000, // Increased for integration tests
    // Run test files sequentially (important for integration tests sharing a database)
    fileParallelism: false,
    // Run tests within a file sequentially
    sequence: {
      concurrent: false
    }
  }
})
