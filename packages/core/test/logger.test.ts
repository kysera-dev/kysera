import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  consoleLogger,
  silentLogger,
  createPrefixedLogger,
  type KyseraLogger,
} from '../src/logger.js';

describe('logger', () => {
  describe('consoleLogger', () => {
    let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
    let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should implement KyseraLogger interface', () => {
      expect(consoleLogger.debug).toBeDefined();
      expect(consoleLogger.info).toBeDefined();
      expect(consoleLogger.warn).toBeDefined();
      expect(consoleLogger.error).toBeDefined();
    });

    it('should log debug message with prefix', () => {
      consoleLogger.debug('test message');

      expect(consoleDebugSpy).toHaveBeenCalledWith('[kysera:debug] test message');
    });

    it('should log info message with prefix', () => {
      consoleLogger.info('test message');

      expect(consoleInfoSpy).toHaveBeenCalledWith('[kysera:info] test message');
    });

    it('should log warn message with prefix', () => {
      consoleLogger.warn('test message');

      expect(consoleWarnSpy).toHaveBeenCalledWith('[kysera:warn] test message');
    });

    it('should log error message with prefix', () => {
      consoleLogger.error('test message');

      expect(consoleErrorSpy).toHaveBeenCalledWith('[kysera:error] test message');
    });

    it('should pass additional arguments to debug', () => {
      consoleLogger.debug('message', 'arg1', { key: 'value' });

      expect(consoleDebugSpy).toHaveBeenCalledWith('[kysera:debug] message', 'arg1', { key: 'value' });
    });

    it('should pass additional arguments to info', () => {
      consoleLogger.info('message', 1, 2, 3);

      expect(consoleInfoSpy).toHaveBeenCalledWith('[kysera:info] message', 1, 2, 3);
    });

    it('should pass additional arguments to warn', () => {
      const obj = { foo: 'bar' };
      consoleLogger.warn('message', obj);

      expect(consoleWarnSpy).toHaveBeenCalledWith('[kysera:warn] message', obj);
    });

    it('should pass additional arguments to error', () => {
      const error = new Error('test error');
      consoleLogger.error('message', error);

      expect(consoleErrorSpy).toHaveBeenCalledWith('[kysera:error] message', error);
    });
  });

  describe('silentLogger', () => {
    it('should implement KyseraLogger interface', () => {
      expect(silentLogger.debug).toBeDefined();
      expect(silentLogger.info).toBeDefined();
      expect(silentLogger.warn).toBeDefined();
      expect(silentLogger.error).toBeDefined();
    });

    it('should not throw when calling debug', () => {
      expect(() => silentLogger.debug('test')).not.toThrow();
    });

    it('should not throw when calling info', () => {
      expect(() => silentLogger.info('test')).not.toThrow();
    });

    it('should not throw when calling warn', () => {
      expect(() => silentLogger.warn('test')).not.toThrow();
    });

    it('should not throw when calling error', () => {
      expect(() => silentLogger.error('test')).not.toThrow();
    });

    it('should be no-op for debug', () => {
      const consoleSpy = vi.spyOn(console, 'debug');
      silentLogger.debug('test');
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should be no-op for info', () => {
      const consoleSpy = vi.spyOn(console, 'info');
      silentLogger.info('test');
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should be no-op for warn', () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      silentLogger.warn('test');
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should be no-op for error', () => {
      const consoleSpy = vi.spyOn(console, 'error');
      silentLogger.error('test');
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle additional arguments without error', () => {
      expect(() => silentLogger.debug('msg', 1, 2, 3)).not.toThrow();
      expect(() => silentLogger.info('msg', { a: 1 })).not.toThrow();
      expect(() => silentLogger.warn('msg', new Error())).not.toThrow();
      expect(() => silentLogger.error('msg', null, undefined)).not.toThrow();
    });
  });

  describe('createPrefixedLogger', () => {
    let mockLogger: KyseraLogger;

    beforeEach(() => {
      mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
    });

    it('should create logger with prefix for debug', () => {
      const prefixed = createPrefixedLogger('mymodule', mockLogger);
      
      prefixed.debug('test message');
      
      expect(mockLogger.debug).toHaveBeenCalledWith('[mymodule] test message');
    });

    it('should create logger with prefix for info', () => {
      const prefixed = createPrefixedLogger('mymodule', mockLogger);
      
      prefixed.info('test message');
      
      expect(mockLogger.info).toHaveBeenCalledWith('[mymodule] test message');
    });

    it('should create logger with prefix for warn', () => {
      const prefixed = createPrefixedLogger('mymodule', mockLogger);
      
      prefixed.warn('test message');
      
      expect(mockLogger.warn).toHaveBeenCalledWith('[mymodule] test message');
    });

    it('should create logger with prefix for error', () => {
      const prefixed = createPrefixedLogger('mymodule', mockLogger);
      
      prefixed.error('test message');
      
      expect(mockLogger.error).toHaveBeenCalledWith('[mymodule] test message');
    });

    it('should pass additional arguments through', () => {
      const prefixed = createPrefixedLogger('test', mockLogger);
      const extra = { key: 'value' };
      
      prefixed.debug('msg', extra, 123);
      
      expect(mockLogger.debug).toHaveBeenCalledWith('[test] msg', extra, 123);
    });

    it('should use consoleLogger as default base logger', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      
      const prefixed = createPrefixedLogger('default');
      prefixed.debug('test');
      
      expect(consoleSpy).toHaveBeenCalledWith('[kysera:debug] [default] test');
      consoleSpy.mockRestore();
    });

    it('should allow nested prefixes', () => {
      const level1 = createPrefixedLogger('level1', mockLogger);
      const level2 = createPrefixedLogger('level2', level1);
      
      level2.info('nested message');
      
      expect(mockLogger.info).toHaveBeenCalledWith('[level1] [level2] nested message');
    });

    it('should handle empty prefix', () => {
      const prefixed = createPrefixedLogger('', mockLogger);
      
      prefixed.debug('test');
      
      expect(mockLogger.debug).toHaveBeenCalledWith('[] test');
    });

    it('should handle special characters in prefix', () => {
      const prefixed = createPrefixedLogger('my-module:v1.0', mockLogger);
      
      prefixed.info('test');
      
      expect(mockLogger.info).toHaveBeenCalledWith('[my-module:v1.0] test');
    });

    it('should create independent loggers', () => {
      const logger1 = createPrefixedLogger('module1', mockLogger);
      const logger2 = createPrefixedLogger('module2', mockLogger);
      
      logger1.debug('from 1');
      logger2.debug('from 2');
      
      expect(mockLogger.debug).toHaveBeenCalledWith('[module1] from 1');
      expect(mockLogger.debug).toHaveBeenCalledWith('[module2] from 2');
    });

    it('should implement KyseraLogger interface', () => {
      const prefixed = createPrefixedLogger('test', mockLogger);
      
      expect(prefixed.debug).toBeDefined();
      expect(prefixed.info).toBeDefined();
      expect(prefixed.warn).toBeDefined();
      expect(prefixed.error).toBeDefined();
      expect(typeof prefixed.debug).toBe('function');
      expect(typeof prefixed.info).toBe('function');
      expect(typeof prefixed.warn).toBe('function');
      expect(typeof prefixed.error).toBe('function');
    });
  });
});
