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
        // Audit plugin has complex event-driven architecture with many edge cases
        branches: 70,
        functions: 90,
        lines: 85,
        statements: 85
      }
    }
  }
})
