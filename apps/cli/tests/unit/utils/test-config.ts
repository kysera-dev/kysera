import { vi } from 'vitest';

// Mock the dependencies before they're imported
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    end: vi.fn(),
    query: vi.fn(),
  })),
}));

vi.mock('mysql2', () => ({
  createPool: vi.fn().mockImplementation(() => ({
    end: vi.fn(),
    promise: () => ({
      query: vi.fn(),
    }),
  })),
}));

vi.mock('better-sqlite3', () => ({
  default: vi.fn().mockImplementation(() => ({
    close: vi.fn(),
    pragma: vi.fn(),
  })),
}));
