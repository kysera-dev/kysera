import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '*.config.ts',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts'
      ],
      thresholds: {
        // Repository pattern has many edge cases and database-dependent paths
        // that are tested at integration level in other packages
        lines: 80,
        functions: 90,
        branches: 70,
        statements: 80
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Cross-package test utilities
      '../core/test': path.resolve(__dirname, '../core/test')
    }
  }
})
