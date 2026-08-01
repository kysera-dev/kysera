import { defineConfig } from 'vitest/config'

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
        'test/',
        '**/*.d.ts'
      ],
      thresholds: {
        branches: 85,
        functions: 95,
        lines: 95,
        statements: 95
      }
    }
  }
})
