import { beforeAll, afterAll, vi } from 'vitest';

// Set test environment
process.env['NODE_ENV'] = 'test';

// Global test setup
beforeAll(() => {
  // Suppress console output during tests unless VERBOSE is set
  if (!process.env['VERBOSE']) {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Keep error output for debugging
    // vi.spyOn(console, 'error').mockImplementation(() => {});
  }
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Global error handling for unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
