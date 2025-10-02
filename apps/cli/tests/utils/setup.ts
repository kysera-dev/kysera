import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Clean up test artifacts before all tests
beforeAll(async () => {
  // Clean test databases directory
  const testDbDir = path.join(__dirname, '../.test-db')
  try {
    await fs.rm(testDbDir, { recursive: true, force: true })
  } catch {
    // Ignore if doesn't exist
  }

  // Clean test projects directory
  const testProjectsDir = path.join(__dirname, '../.test-projects')
  try {
    await fs.rm(testProjectsDir, { recursive: true, force: true })
  } catch {
    // Ignore if doesn't exist
  }

  // Set test environment
  process.env.NODE_ENV = 'test'
  process.env.KYSERA_TEST = 'true'
})

// Clean up after all tests
afterAll(async () => {
  // Final cleanup
  const testDbDir = path.join(__dirname, '../.test-db')
  try {
    await fs.rm(testDbDir, { recursive: true, force: true })
  } catch {
    // Ignore
  }

  const testProjectsDir = path.join(__dirname, '../.test-projects')
  try {
    await fs.rm(testProjectsDir, { recursive: true, force: true })
  } catch {
    // Ignore
  }
})

// Reset environment before each test
beforeEach(() => {
  // Store original env
  (global as any).__originalEnv = { ...process.env }
})

// Restore environment after each test
afterEach(() => {
  // Restore original env
  if ((global as any).__originalEnv) {
    process.env = (global as any).__originalEnv
    delete (global as any).__originalEnv
  }
})

// Mock console methods to reduce noise during tests
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug
}

export function mockConsole(): void {
  console.log = () => {}
  console.error = () => {}
  console.warn = () => {}
  console.info = () => {}
  console.debug = () => {}
}

export function restoreConsole(): void {
  console.log = originalConsole.log
  console.error = originalConsole.error
  console.warn = originalConsole.warn
  console.info = originalConsole.info
  console.debug = originalConsole.debug
}

// Suppress console output during tests by default
if (process.env.SHOW_LOGS !== 'true') {
  mockConsole()
}