import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
        '*.config.ts',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/test/**',
        '**/index.ts'
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 85,
        statements: 95
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
