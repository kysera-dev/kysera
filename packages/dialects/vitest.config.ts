import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: [
      // Integration tests require real PostgreSQL (TEST_POSTGRES env var)
      ...(process.env['TEST_POSTGRES'] ? [] : ['test/postgres-schema.integration.test.ts'])
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'test/',
        // MSSQL adapter requires Azure SQL Edge for full coverage
        // and is tested separately in multi-db integration tests
        'src/adapters/mssql.ts'
      ],
      thresholds: {
        // Lower thresholds for dialects package since adapter error parsing
        // requires real database connections for full coverage.
        // MSSQL adapter is excluded; postgres/mysql adapters have many
        // error-path branches that only trigger with actual DB errors.
        // Full coverage is achieved via multi-db integration tests (pnpm test:multi-db).
        lines: 60,
        functions: 75,
        branches: 55,
        statements: 60
      }
    }
  }
})
