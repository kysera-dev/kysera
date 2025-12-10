/**
 * Tests for shutdown utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  gracefulShutdown,
  shutdownDatabase,
  createShutdownController,
} from '../src/shutdown.js';

// Mock Kysely database
function createMockDb() {
  return {
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

describe('gracefulShutdown', () => {
  it('should destroy database connection', async () => {
    const db = createMockDb();

    await gracefulShutdown(db as any);

    expect(db.destroy).toHaveBeenCalledTimes(1);
  });

  it('should call onShutdown before destroying', async () => {
    const db = createMockDb();
    const onShutdown = vi.fn().mockResolvedValue(undefined);

    const callOrder: string[] = [];
    onShutdown.mockImplementation(() => {
      callOrder.push('onShutdown');
      return Promise.resolve();
    });
    db.destroy.mockImplementation(() => {
      callOrder.push('destroy');
      return Promise.resolve();
    });

    await gracefulShutdown(db as any, { onShutdown });

    expect(callOrder).toEqual(['onShutdown', 'destroy']);
  });

  it('should timeout if shutdown takes too long', async () => {
    const db = createMockDb();

    // Create a promise that never resolves
    db.destroy.mockImplementation(() => new Promise(() => {}));

    // Use real timers for this test
    vi.useRealTimers();

    // Test with a very short timeout
    await expect(
      gracefulShutdown(db as any, { timeout: 50 })
    ).rejects.toThrow('Shutdown timeout after 50ms');
  });

  it('should log error if destroy fails', async () => {
    const db = createMockDb();
    const error = new Error('Destroy failed');
    db.destroy.mockRejectedValue(error);

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await expect(gracefulShutdown(db as any, { logger })).rejects.toThrow('Destroy failed');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('shutdownDatabase', () => {
  it('should call db.destroy', async () => {
    const db = createMockDb();

    await shutdownDatabase(db as any);

    expect(db.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('createShutdownController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create controller with execute function', () => {
    const db = createMockDb();
    const controller = createShutdownController(db as any);

    expect(controller.execute).toBeInstanceOf(Function);
    expect(controller.registerSignals).toBeInstanceOf(Function);
    expect(controller.isShuttingDown).toBeInstanceOf(Function);
  });

  it('should track shutdown state', async () => {
    const db = createMockDb();
    const controller = createShutdownController(db as any);

    expect(controller.isShuttingDown()).toBe(false);

    const promise = controller.execute();
    await vi.runAllTimersAsync();
    await promise;

    expect(controller.isShuttingDown()).toBe(true);
  });

  it('should only execute once', async () => {
    const db = createMockDb();
    const controller = createShutdownController(db as any);

    const promise1 = controller.execute();
    const promise2 = controller.execute();
    await vi.runAllTimersAsync();
    await Promise.all([promise1, promise2]);

    expect(db.destroy).toHaveBeenCalledTimes(1);
  });
});
