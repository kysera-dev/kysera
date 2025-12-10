/**
 * Tests for resilience utilities (retry, circuit breaker).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isTransientError,
  withRetry,
  createRetryWrapper,
  CircuitBreaker,
} from '../src/resilience/index.js';

describe('isTransientError', () => {
  it('should return true for transient error codes', () => {
    const transientCodes = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ECONNRESET',
      'EPIPE',
      '57P03',
      '08006',
      '40001',
      '40P01',
      'ER_LOCK_DEADLOCK',
      'ER_LOCK_WAIT_TIMEOUT',
      'SQLITE_BUSY',
      'SQLITE_LOCKED',
    ];

    for (const code of transientCodes) {
      expect(isTransientError({ code })).toBe(true);
    }
  });

  it('should return false for non-transient error codes', () => {
    expect(isTransientError({ code: 'UNKNOWN_ERROR' })).toBe(false);
    expect(isTransientError({ code: '23505' })).toBe(false); // unique violation
    expect(isTransientError({ code: '23503' })).toBe(false); // foreign key
  });

  it('should return false for errors without code', () => {
    expect(isTransientError(new Error('some error'))).toBe(false);
    expect(isTransientError({})).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const promise = withRetry(fn);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on transient error', async () => {
    const transientError = Object.assign(new Error('Connection refused'), {
      code: 'ECONNREFUSED',
    });

    const fn = vi
      .fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValue('success');

    const promise = withRetry(fn, { delayMs: 100 });

    // First call fails
    await vi.advanceTimersByTimeAsync(0);

    // Wait for retry delay
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw after max attempts', async () => {
    vi.useRealTimers(); // Use real timers for this test

    const transientError = Object.assign(new Error('Connection refused'), {
      code: 'ECONNREFUSED',
    });

    const fn = vi.fn().mockRejectedValue(transientError);

    // Use very short delays for testing
    await expect(
      withRetry(fn, { maxAttempts: 3, delayMs: 10, backoff: false })
    ).rejects.toThrow('Connection refused');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should not retry non-transient errors', async () => {
    const nonTransientError = Object.assign(new Error('Unique violation'), {
      code: '23505',
    });

    const fn = vi.fn().mockRejectedValue(nonTransientError);

    // Non-transient errors should fail immediately without retries
    await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toThrow('Unique violation');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should call onRetry callback', async () => {
    const transientError = Object.assign(new Error('Timeout'), {
      code: 'ETIMEDOUT',
    });

    const fn = vi
      .fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValue('success');

    const onRetry = vi.fn();

    const promise = withRetry(fn, { delayMs: 100, onRetry });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, transientError);
  });

  it('should use exponential backoff when enabled', async () => {
    const transientError = Object.assign(new Error('Timeout'), {
      code: 'ETIMEDOUT',
    });

    const fn = vi
      .fn()
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValue('success');

    const promise = withRetry(fn, { delayMs: 100, backoff: true });

    await vi.advanceTimersByTimeAsync(0); // First call
    await vi.advanceTimersByTimeAsync(100); // First retry (100ms)
    await vi.advanceTimersByTimeAsync(200); // Second retry (200ms with backoff)

    await promise;
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('createRetryWrapper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should create a wrapped function with retry', async () => {
    const transientError = Object.assign(new Error('Busy'), {
      code: 'SQLITE_BUSY',
    });

    const fn = vi
      .fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValue('result');

    const wrappedFn = createRetryWrapper(fn, { delayMs: 50 });

    const promise = wrappedFn('arg1', 'arg2');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);

    const result = await promise;

    expect(result).toBe('result');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
  });
});

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should pass through on success (closed state)', async () => {
    const breaker = new CircuitBreaker(3, 60000);
    const fn = vi.fn().mockResolvedValue('result');

    const result = await breaker.execute(fn);

    expect(result).toBe('result');
    expect(breaker.getState().state).toBe('closed');
    expect(breaker.isClosed()).toBe(true);
  });

  it('should track failures', async () => {
    const breaker = new CircuitBreaker(3, 60000);
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    try {
      await breaker.execute(fn);
    } catch {
      // Expected
    }

    expect(breaker.getState().failures).toBe(1);
    expect(breaker.getState().state).toBe('closed');
  });

  it('should open after threshold failures', async () => {
    const breaker = new CircuitBreaker(3, 60000);
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(fn);
      } catch {
        // Expected
      }
    }

    expect(breaker.getState().state).toBe('open');
    expect(breaker.isOpen()).toBe(true);
  });

  it('should fail fast when open', async () => {
    const breaker = new CircuitBreaker(1, 60000);
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    // Open the circuit
    try {
      await breaker.execute(fn);
    } catch {
      // Expected
    }

    // Should fail fast without calling fn
    fn.mockClear();
    await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker is open');
    expect(fn).not.toHaveBeenCalled();
  });

  it('should transition to half-open after reset time', async () => {
    const breaker = new CircuitBreaker(1, 1000);
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    // Open the circuit
    try {
      await breaker.execute(fn);
    } catch {
      // Expected
    }

    expect(breaker.getState().state).toBe('open');

    // Advance time past reset
    vi.advanceTimersByTime(1001);

    // Next call should transition to half-open and attempt
    fn.mockResolvedValue('success');
    const result = await breaker.execute(fn);

    expect(result).toBe('success');
    expect(breaker.getState().state).toBe('closed');
  });

  it('should reset on manual reset()', async () => {
    const breaker = new CircuitBreaker(1, 60000);
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    // Open the circuit
    try {
      await breaker.execute(fn);
    } catch {
      // Expected
    }

    expect(breaker.getState().state).toBe('open');

    breaker.reset();

    expect(breaker.getState().state).toBe('closed');
    expect(breaker.getState().failures).toBe(0);
  });

  it('should call onStateChange callback', async () => {
    const onStateChange = vi.fn();
    const breaker = new CircuitBreaker({
      threshold: 1,
      resetTimeMs: 60000,
      onStateChange,
    });

    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    try {
      await breaker.execute(fn);
    } catch {
      // Expected
    }

    expect(onStateChange).toHaveBeenCalledWith('open', 'closed');
  });

  it('should forceOpen the circuit', () => {
    const breaker = new CircuitBreaker(5, 60000);

    expect(breaker.isClosed()).toBe(true);

    breaker.forceOpen();

    expect(breaker.isOpen()).toBe(true);
    expect(breaker.getState().failures).toBe(5);
  });
});
