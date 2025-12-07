import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CLIError, handleError, formatError } from '@/utils/errors';
import { prism } from '@xec-sh/kit';

describe('CLIError', () => {
  it('should create an error with message and code', () => {
    const error = new CLIError('Test error', 'TEST_ERROR');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CLIError);
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_ERROR');
  });

  it('should create an error with details', () => {
    const details = { field: 'value' };
    const error = new CLIError('Test error', 'TEST_ERROR', details);

    expect(error.details).toEqual(details);
  });

  it('should have a stack trace', () => {
    const error = new CLIError('Test error', 'TEST_ERROR');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('CLIError');
  });
});

describe('formatError', () => {
  it('should format a CLIError', () => {
    const error = new CLIError('Test error message', 'TEST_ERROR');
    const formatted = formatError(error);

    expect(formatted).toContain('Test error message');
    expect(formatted).toContain('TEST_ERROR');
  });

  it('should format a CLIError with details', () => {
    const error = new CLIError('Database connection failed', 'DB_CONNECTION_ERROR', { host: 'localhost', port: 5432 });
    const formatted = formatError(error);

    expect(formatted).toContain('Database connection failed');
    expect(formatted).toContain('DB_CONNECTION_ERROR');
    expect(formatted).toContain('localhost');
    expect(formatted).toContain('5432');
  });

  it('should format a regular Error', () => {
    const error = new Error('Regular error');
    const formatted = formatError(error);

    expect(formatted).toContain('Regular error');
  });

  it('should format unknown errors', () => {
    const formatted = formatError('String error');
    expect(formatted).toContain('String error');

    const formatted2 = formatError(123);
    expect(formatted2).toContain('123');

    const formatted3 = formatError(null);
    expect(formatted3).toContain('Unknown error');
  });
});

describe('handleError', () => {
  let exitSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    // Mock process.exit
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    // Mock console.error
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should handle CLIError and exit with code 1', () => {
    const error = new CLIError('Test error', 'TEST_ERROR');

    expect(() => handleError(error)).toThrow('process.exit called');
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle regular Error and exit with code 1', () => {
    const error = new Error('Regular error');

    expect(() => handleError(error)).toThrow('process.exit called');
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle string errors', () => {
    expect(() => handleError('String error')).toThrow('process.exit called');
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should show help suggestion for known error codes', () => {
    const error = new CLIError('Config not found', 'CONFIG_NOT_FOUND');

    expect(() => handleError(error)).toThrow('process.exit called');

    const errorOutput = consoleErrorSpy.mock.calls[0][0];
    expect(errorOutput).toContain('kysera help');
  });

  it('should show debug info in verbose mode', () => {
    process.env.VERBOSE = 'true';

    const error = new CLIError('Test error', 'TEST_ERROR', { detail: 'value' });

    expect(() => handleError(error)).toThrow('process.exit called');

    const errorCalls = consoleErrorSpy.mock.calls;
    expect(errorCalls.some((call: any[]) => call[0].includes('TEST_ERROR'))).toBe(true);

    process.env.VERBOSE = 'false';
  });
});
