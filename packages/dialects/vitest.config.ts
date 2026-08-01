import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
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
        // MSSQL adapter needs a real SQL Server (Azure SQL Edge in docker);
        // this package ships no in-process MSSQL driver, so its coverage is
        // excluded from the default run
        'src/adapters/mssql.ts'
      ],
      thresholds: {
        // Lower thresholds for dialects package since adapter error parsing
        // and information_schema queries require real database connections.
        // The real-database surface is covered by test/multi-db.integration.ts
        // (pnpm test:multi-db with docker compose containers running).
        lines: 60,
        functions: 75,
        branches: 55,
        statements: 60
      }
    }
  }
})
