import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: [
      // Integration tests require real databases (TEST_POSTGRES, TEST_MYSQL env vars)
      // Run with: TEST_POSTGRES=true TEST_MYSQL=true pnpm test
      ...(process.env['TEST_POSTGRES'] || process.env['TEST_MYSQL']
        ? []
        : ['test/integration/postgres-rls.test.ts', 'test/integration/mysql-rls.test.ts', 'test/integration/postgres-new-features.test.ts'])
    ],
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
