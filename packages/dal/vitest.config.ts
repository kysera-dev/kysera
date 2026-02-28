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
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts']
    },
    testTimeout: 30000
  }
})
