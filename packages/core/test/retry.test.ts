import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isTransientError,
  withRetry,
  createRetryWrapper,
  CircuitBreaker,
} from '../src/retry.js';

describe('retry', () => {
  describe('isTransientError', () => {
    it('should return true for ECONNREFUSED error', () => {
      const error = { code: 'ECONNREFUSED' };
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for ETIMEDOUT error', () => {
      const error = { code: 'ETIMEDOUT' };
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for ECONNRESET error', () => {
      const error = { code: 'ECONNRESET' };
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for EPIPE error', () => {
      const error = { code: 'EPIPE' };
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for PostgreSQL 57P03 (cannot connect now)', () => {
      const error = { code: '57P03' };
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for PostgreSQL 40001 (serialization failure)', () => {
      const error = { code: '40001' };
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for PostgreSQL 40P01 (deadlock detected)', () => {
      const error = { code: '40P01' };
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for MySQL ER_LOCK_DEADLOCK', () => {
      const error = { code: 'ER_LOCK_DEADLOCK' };
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for MySQL ER_LOCK_WAIT_TIMEOUT', () => {
      const error = { code: 'ER_LOCK_WAIT_TIMEOUT' };
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for SQLite SQLITE_BUSY', () => {
      const error = { code: 'SQLITE_BUSY' };
      expect(isTransientError(error)).toBe(true);
    });

    it('should return true for SQLite SQLITE_LOCKED', () => {
      const error = { code: 'SQLITE_LOCKED' };
      expect(isTransientError(error)).toBe(true);
    });

    it('should return false for non-transient error codes', () => {
      const error = { code: 'UNKNOWN_ERROR' };
      expect(isTransientError(error)).toBe(false);
    });

    it('should return false for error without code', () => {
      const error = new Error('Some error');
      expect(isTransientError(error)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isTransientError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isTransientError(undefined)).toBe(false);
    });
  });

  describe('withRetry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return result on first successful attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      
      const result = await withRetry(fn);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after transient failures', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockRejectedValueOnce({ code: 'ETIMEDOUT' })
        .mockResolvedValueOnce('success');

      const promise = withRetry(fn, { maxAttempts: 3, delayMs: 100 });
      
      // Fast-forward through delays
      await vi.advanceTimersByTimeAsync(100); // First retry delay
      await vi.advanceTimersByTimeAsync(200); // Second retry delay (backoff)
      
      const result = await promise;
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max attempts exceeded', async () => {
      const transientError = new Error('Connection refused');
      (transientError as any).code = 'ECONNREFUSED';
      const fn = vi.fn().mockRejectedValue(transientError);

      // Start the promise and immediately set up the rejection handler
      let rejected = false;
      let rejectedError: Error | null = null;
      const promise = withRetry(fn, { maxAttempts: 3, delayMs: 100 }).catch((err) => {
        rejected = true;
        rejectedError = err;
      });

      // Fast-forward through all delays
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);
      await promise;

      expect(rejected).toBe(true);
      expect(rejectedError?.message).toBe('Connection refused');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw immediately for non-transient errors', async () => {
      const nonTransientError = { code: 'SYNTAX_ERROR', message: 'SQL syntax error' };
      const fn = vi.fn().mockRejectedValue(nonTransientError);

      await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toEqual(nonTransientError);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should use custom shouldRetry function', async () => {
      const customError = { type: 'CUSTOM_TRANSIENT' };
      const fn = vi.fn()
        .mockRejectedValueOnce(customError)
        .mockResolvedValueOnce('success');

      const shouldRetry = (error: unknown) => (error as any)?.type === 'CUSTOM_TRANSIENT';

      const promise = withRetry(fn, { 
        maxAttempts: 3, 
        delayMs: 100,
        shouldRetry 
      });
      
      await vi.advanceTimersByTimeAsync(100);
      
      const result = await promise;
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should call onRetry callback on each retry', async () => {
      const transientError = { code: 'ECONNREFUSED' };
      const fn = vi.fn()
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce('success');
      
      const onRetry = vi.fn();

      const promise = withRetry(fn, { 
        maxAttempts: 3, 
        delayMs: 100,
        onRetry 
      });
      
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);
      
      await promise;
      
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(1, transientError);
      expect(onRetry).toHaveBeenCalledWith(2, transientError);
    });

    it('should use fixed delay when backoff is disabled', async () => {
      const transientError = { code: 'ECONNREFUSED' };
      const fn = vi.fn()
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce('success');

      const promise = withRetry(fn, { 
        maxAttempts: 3, 
        delayMs: 100,
        backoff: false 
      });
      
      // With backoff disabled, each delay should be 100ms
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      
      const result = await promise;
      
      expect(result).toBe('success');
    });

    it('should use exponential backoff by default', async () => {
      const transientError = { code: 'ECONNREFUSED' };
      const fn = vi.fn()
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce('success');

      const delayMs = 100;
      const promise = withRetry(fn, { maxAttempts: 3, delayMs });
      
      // First retry: 100ms * 2^0 = 100ms
      await vi.advanceTimersByTimeAsync(100);
      // Second retry: 100ms * 2^1 = 200ms
      await vi.advanceTimersByTimeAsync(200);
      
      const result = await promise;
      
      expect(result).toBe('success');
    });

    it('should use default values when no options provided', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      
      const result = await withRetry(fn);
      
      expect(result).toBe('success');
    });
  });

  describe('createRetryWrapper', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should create a wrapped function that retries on failure', async () => {
      const originalFn = vi.fn()
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockResolvedValueOnce('success');

      const wrappedFn = createRetryWrapper(originalFn, { maxAttempts: 2, delayMs: 100 });
      
      const promise = wrappedFn('arg1', 'arg2');
      
      await vi.advanceTimersByTimeAsync(100);
      
      const result = await promise;
      
      expect(result).toBe('success');
      expect(originalFn).toHaveBeenCalledWith('arg1', 'arg2');
      expect(originalFn).toHaveBeenCalledTimes(2);
    });

    it('should pass arguments to the wrapped function', async () => {
      const originalFn = vi.fn().mockResolvedValue('result');
      const wrappedFn = createRetryWrapper(originalFn);

      await wrappedFn(1, 'two', { three: 3 });

      expect(originalFn).toHaveBeenCalledWith(1, 'two', { three: 3 });
    });

    it('should preserve function return type', async () => {
      const originalFn = async (n: number): Promise<number> => n * 2;
      const wrappedFn = createRetryWrapper(originalFn);

      const result = await wrappedFn(5);

      expect(result).toBe(10);
    });
  });

  describe('CircuitBreaker', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should start in closed state', () => {
      const breaker = new CircuitBreaker();
      
      expect(breaker.getState().state).toBe('closed');
      expect(breaker.getState().failures).toBe(0);
    });

    it('should execute function successfully when closed', async () => {
      const breaker = new CircuitBreaker();
      const fn = vi.fn().mockResolvedValue('success');

      const result = await breaker.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    it('should count failures when function throws', async () => {
      const breaker = new CircuitBreaker();
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      
      expect(breaker.getState().failures).toBe(1);
      expect(breaker.getState().state).toBe('closed');
    });

    it('should open circuit after reaching failure threshold', async () => {
      const breaker = new CircuitBreaker(3); // threshold = 3
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // First 3 failures
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow('failure');
      }

      expect(breaker.getState().state).toBe('open');
      expect(breaker.getState().failures).toBe(3);
    });

    it('should fail fast when circuit is open', async () => {
      const breaker = new CircuitBreaker(2);
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // Open the circuit
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      await expect(breaker.execute(fn)).rejects.toThrow('failure');

      expect(breaker.getState().state).toBe('open');

      // Should fail fast without calling fn
      const anotherFn = vi.fn().mockResolvedValue('success');
      await expect(breaker.execute(anotherFn)).rejects.toThrow('Circuit breaker is open');
      expect(anotherFn).not.toHaveBeenCalled();
    });

    it('should transition to half-open after reset time', async () => {
      const resetTimeMs = 1000;
      const breaker = new CircuitBreaker(2, resetTimeMs);
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // Open the circuit
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      expect(breaker.getState().state).toBe('open');

      // Advance time past reset period
      vi.advanceTimersByTime(resetTimeMs + 1);

      // Next execute should allow the call (half-open)
      const successFn = vi.fn().mockResolvedValue('success');
      const result = await breaker.execute(successFn);

      expect(result).toBe('success');
      expect(successFn).toHaveBeenCalled();
    });

    it('should close circuit on success in half-open state', async () => {
      const resetTimeMs = 1000;
      const breaker = new CircuitBreaker(2, resetTimeMs);
      const failFn = vi.fn().mockRejectedValue(new Error('failure'));

      // Open the circuit
      await expect(breaker.execute(failFn)).rejects.toThrow('failure');
      await expect(breaker.execute(failFn)).rejects.toThrow('failure');

      // Advance time to trigger half-open
      vi.advanceTimersByTime(resetTimeMs + 1);

      // Success in half-open should close circuit
      const successFn = vi.fn().mockResolvedValue('success');
      await breaker.execute(successFn);

      expect(breaker.getState().state).toBe('closed');
      expect(breaker.getState().failures).toBe(0);
    });

    it('should reopen circuit on failure in half-open state', async () => {
      const resetTimeMs = 1000;
      const breaker = new CircuitBreaker(2, resetTimeMs);
      const failFn = vi.fn().mockRejectedValue(new Error('failure'));

      // Open the circuit
      await expect(breaker.execute(failFn)).rejects.toThrow('failure');
      await expect(breaker.execute(failFn)).rejects.toThrow('failure');
      expect(breaker.getState().state).toBe('open');

      // Advance time to trigger half-open
      vi.advanceTimersByTime(resetTimeMs + 1);

      // Failure in half-open should reopen circuit
      await expect(breaker.execute(failFn)).rejects.toThrow('failure');
      
      // State should go back to open due to failure count >= threshold
      expect(breaker.getState().state).toBe('open');
    });

    it('should reset circuit manually', async () => {
      const breaker = new CircuitBreaker(2);
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // Open the circuit
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      expect(breaker.getState().state).toBe('open');

      // Manual reset
      breaker.reset();

      expect(breaker.getState().state).toBe('closed');
      expect(breaker.getState().failures).toBe(0);
      expect(breaker.getState().lastFailureTime).toBeUndefined();
    });

    it('should record lastFailureTime on failure', async () => {
      const breaker = new CircuitBreaker();
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      const beforeTime = Date.now();
      await expect(breaker.execute(fn)).rejects.toThrow('failure');

      const state = breaker.getState();
      expect(state.lastFailureTime).toBeDefined();
      expect(state.lastFailureTime).toBeGreaterThanOrEqual(beforeTime);
    });

    it('should use default threshold of 5', async () => {
      const breaker = new CircuitBreaker();
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // 4 failures should keep circuit closed
      for (let i = 0; i < 4; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow('failure');
      }
      expect(breaker.getState().state).toBe('closed');

      // 5th failure should open circuit
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      expect(breaker.getState().state).toBe('open');
    });

    it('should use default reset time of 60000ms', async () => {
      const breaker = new CircuitBreaker(1); // threshold = 1 for quick test
      const fn = vi.fn().mockRejectedValue(new Error('failure'));

      // Open the circuit
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      expect(breaker.getState().state).toBe('open');

      // Advance time less than default reset time
      vi.advanceTimersByTime(59999);

      // Should still be open
      await expect(breaker.execute(() => Promise.resolve('test'))).rejects.toThrow('Circuit breaker is open');

      // Advance past default reset time
      vi.advanceTimersByTime(2);

      // Should transition to half-open and allow call
      const successFn = vi.fn().mockResolvedValue('success');
      const result = await breaker.execute(successFn);
      expect(result).toBe('success');
    });
  });
});
