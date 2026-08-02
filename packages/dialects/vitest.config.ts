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
        // Unit suite covers the full adapter surface via the fake-kysely
        // driver (test/helpers/fake-kysely.ts); the live-database behavior is
        // additionally verified by test/multi-db.integration.ts (pnpm
        // test:multi-db with docker compose containers running).
        // Current: 100/95.5/100/100 — floors keep a small buffer on branches.
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95
      }
    }
  }
})
