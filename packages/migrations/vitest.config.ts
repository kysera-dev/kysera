import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      // At the repo standard. The postgres/mysql advisory lock paths are
      // unit-covered via test/helpers/fake-kysely.ts (and verified live by
      // the docker multi-db suite). Current: 100/96/100/100.
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 85,
        statements: 95
      }
    }
  }
})
