import { beforeAll, afterAll, beforeEach } from 'vitest'

// Set test environment
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'error' // Reduce noise during tests

beforeAll(async () => {
  // Setup before all tests
})

afterAll(async () => {
  // Cleanup after all tests
})

beforeEach(() => {
  // Reset before each test
})