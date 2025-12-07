import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LogLevel, LoggerOptions } from '@/utils/logger';

// Store original env and process properties
const originalEnv = { ...process.env };
const originalStdoutIsTTY = process.stdout.isTTY;

// Mock @xec-sh/kit
const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
};

vi.mock('@xec-sh/kit', () => ({
  log: mockLog,
  prism: {
    gray: (s: string) => `[gray]${s}[/gray]`,
    blue: (s: string) => `[blue]${s}[/blue]`,
    yellow: (s: string) => `[yellow]${s}[/yellow]`,
    red: (s: string) => `[red]${s}[/red]`,
    green: (s: string) => `[green]${s}[/green]`,
    bold: (s: string) => `[bold]${s}[/bold]`,
  },
  strip: (s: string) => s.replace(/\[.*?\]/g, ''),
}));

describe('Logger', () => {
  let consoleSpy: { log: any; warn: any; error: any };
  let createLogger: (options?: LoggerOptions) => any;
  let logger: any;

  beforeEach(async () => {
    // Reset mocks
    mockLog.info.mockClear();
    mockLog.warn.mockClear();
    mockLog.error.mockClear();
    mockLog.success.mockClear();

    // Reset env
    process.env = { ...originalEnv };
    delete process.env.LOG_LEVEL;
    delete process.env.FORCE_COLOR;
    delete process.env.LOG_TIMESTAMPS;
    delete process.env.LOG_FORMAT;
    delete process.env.NO_COLOR;

    // Mock TTY
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });

    // Spy on console methods
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };

    // Clear module cache and reimport
    vi.resetModules();
    const module = await import('@/utils/logger');
    createLogger = module.createLogger;
    logger = createLogger({ level: 'debug', colors: true });
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
    process.env = { ...originalEnv };
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalStdoutIsTTY,
      writable: true,
      configurable: true,
    });
  });

  describe('constructor', () => {
    it('should use default options', () => {
      const defaultLogger = createLogger();
      expect(defaultLogger.level).toBe('info');
      expect(defaultLogger.timestamps).toBe(false);
      expect(defaultLogger.json).toBe(false);
    });

    it('should accept custom log level', () => {
      const customLogger = createLogger({ level: 'error' });
      expect(customLogger.level).toBe('error');
    });

    it('should enable timestamps', () => {
      const customLogger = createLogger({ timestamps: true });
      expect(customLogger.timestamps).toBe(true);
    });

    it('should enable JSON output', () => {
      const customLogger = createLogger({ json: true });
      expect(customLogger.json).toBe(true);
    });

    it('should disable colors when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';
      const noColorLogger = createLogger({ colors: true });
      expect(noColorLogger.colors).toBe(false);
    });

    it('should disable colors when not in TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      const noTTYLogger = createLogger({ colors: true });
      expect(noTTYLogger.colors).toBe(false);
    });
  });

  describe('log level filtering', () => {
    it('should log debug when level is debug', () => {
      const debugLogger = createLogger({ level: 'debug' });
      debugLogger.debug('debug message');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should not log debug when level is info', () => {
      const infoLogger = createLogger({ level: 'info' });
      infoLogger.debug('debug message');
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('should log info when level is info', () => {
      const infoLogger = createLogger({ level: 'info' });
      infoLogger.info('info message');
      expect(mockLog.info).toHaveBeenCalled();
    });

    it('should not log info when level is warn', () => {
      const warnLogger = createLogger({ level: 'warn' });
      warnLogger.info('info message');
      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(mockLog.info).not.toHaveBeenCalled();
    });

    it('should log warn when level is warn', () => {
      const warnLogger = createLogger({ level: 'warn' });
      warnLogger.warn('warn message');
      expect(mockLog.warn).toHaveBeenCalled();
    });

    it('should not log warn when level is error', () => {
      const errorLogger = createLogger({ level: 'error' });
      errorLogger.warn('warn message');
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(mockLog.warn).not.toHaveBeenCalled();
    });

    it('should always log error when level is error', () => {
      const errorLogger = createLogger({ level: 'error' });
      errorLogger.error('error message');
      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  describe('debug method', () => {
    it('should log debug messages with gray color', () => {
      const debugLogger = createLogger({ level: 'debug', colors: true });
      debugLogger.debug('test debug');
      expect(consoleSpy.log).toHaveBeenCalled();
      const call = consoleSpy.log.mock.calls[0][0];
      expect(call).toContain('DEBUG');
      expect(call).toContain('test debug');
    });

    it('should format with arguments', () => {
      const debugLogger = createLogger({ level: 'debug' });
      debugLogger.debug('value is %s', 'test');
      expect(consoleSpy.log).toHaveBeenCalled();
      const call = consoleSpy.log.mock.calls[0][0];
      expect(call).toContain('value is test');
    });
  });

  describe('info method', () => {
    it('should log info messages', () => {
      const infoLogger = createLogger({ level: 'info' });
      infoLogger.info('test info');
      expect(mockLog.info).toHaveBeenCalledWith('test info');
    });

    it('should format with arguments', () => {
      const infoLogger = createLogger({ level: 'info' });
      infoLogger.info('count: %d', 42);
      expect(mockLog.info).toHaveBeenCalledWith('count: 42');
    });
  });

  describe('warn method', () => {
    it('should log warn messages', () => {
      const warnLogger = createLogger({ level: 'warn' });
      warnLogger.warn('test warning');
      expect(mockLog.warn).toHaveBeenCalledWith('test warning');
    });
  });

  describe('error method', () => {
    it('should log error messages', () => {
      const errorLogger = createLogger({ level: 'error' });
      errorLogger.error('test error');
      expect(mockLog.error).toHaveBeenCalledWith('test error');
    });

    it('should handle Error objects', () => {
      const errorLogger = createLogger({ level: 'error' });
      const error = new Error('Error object message');
      errorLogger.error(error);
      expect(mockLog.error).toHaveBeenCalledWith('Error object message');
    });

    it('should show stack trace in debug mode for Error objects', () => {
      const debugLogger = createLogger({ level: 'debug' });
      const error = new Error('Error with stack');
      debugLogger.error(error);
      // Stack should be printed via console.error
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe('success method', () => {
    it('should log success messages', () => {
      const infoLogger = createLogger({ level: 'info' });
      infoLogger.success('operation successful');
      expect(mockLog.success).toHaveBeenCalledWith('operation successful');
    });

    it('should not log success when level is warn', () => {
      mockLog.success.mockClear();
      const warnLogger = createLogger({ level: 'warn' });
      warnLogger.success('operation successful');
      expect(mockLog.success).not.toHaveBeenCalled();
    });
  });

  describe('JSON output mode', () => {
    it('should output JSON for debug messages', () => {
      const jsonLogger = createLogger({ level: 'debug', json: true });
      jsonLogger.debug('json debug');
      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('debug');
      expect(parsed.message).toContain('json debug');
      expect(parsed.timestamp).toBeDefined();
    });

    it('should output JSON for info messages', () => {
      const jsonLogger = createLogger({ level: 'info', json: true });
      jsonLogger.info('json info');
      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('info');
    });

    it('should output JSON for warn messages', () => {
      const jsonLogger = createLogger({ level: 'warn', json: true });
      jsonLogger.warn('json warn');
      expect(consoleSpy.warn).toHaveBeenCalled();
      const output = consoleSpy.warn.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('warn');
    });

    it('should output JSON for error messages', () => {
      const jsonLogger = createLogger({ level: 'error', json: true });
      jsonLogger.error('json error');
      expect(consoleSpy.error).toHaveBeenCalled();
      const output = consoleSpy.error.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('error');
    });

    it('should output JSON for success messages', () => {
      const jsonLogger = createLogger({ level: 'info', json: true });
      jsonLogger.success('json success');
      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('success');
    });

    it('should strip ANSI codes in JSON output', () => {
      const jsonLogger = createLogger({ level: 'debug', json: true });
      jsonLogger.debug('[colored] message');
      const output = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(output);
      // strip function removes color codes
      expect(parsed.message).not.toContain('[colored]');
    });
  });

  describe('timestamp mode', () => {
    it('should include timestamps when enabled', () => {
      const tsLogger = createLogger({ level: 'debug', timestamps: true });
      tsLogger.debug('message with timestamp');
      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls[0][0];
      // Should contain ISO timestamp format
      expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('color handling', () => {
    it('should use colored tags when colors enabled', () => {
      const colorLogger = createLogger({ level: 'debug', colors: true });
      colorLogger.debug('colored');
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('[gray]');
    });

    it('should use plain tags when colors disabled', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      const plainLogger = createLogger({ level: 'debug', colors: false, timestamps: true });
      plainLogger.debug('plain');
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('[DEBUG]');
    });
  });

  describe('utility methods', () => {
    describe('log', () => {
      it('should output raw message without prefix', () => {
        logger.log('raw message');
        expect(consoleSpy.log).toHaveBeenCalled();
        const output = consoleSpy.log.mock.calls[0][0];
        expect(output).toBe('raw message');
      });

      it('should format arguments', () => {
        logger.log('value: %d', 123);
        const output = consoleSpy.log.mock.calls[0][0];
        expect(output).toBe('value: 123');
      });
    });

    describe('newline', () => {
      it('should output empty line', () => {
        logger.newline();
        expect(consoleSpy.log).toHaveBeenCalledWith('');
      });
    });

    describe('clear', () => {
      let stdoutWriteSpy: any;

      beforeEach(() => {
        stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      });

      afterEach(() => {
        stdoutWriteSpy.mockRestore();
      });

      it('should clear screen when in TTY', () => {
        Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
        logger.clear();
        expect(stdoutWriteSpy).toHaveBeenCalledWith('\x1Bc');
      });

      it('should not clear screen when not in TTY', () => {
        Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
        logger.clear();
        expect(stdoutWriteSpy).not.toHaveBeenCalled();
      });
    });

    describe('group/groupEnd', () => {
      let groupSpy: any;
      let groupEndSpy: any;

      beforeEach(() => {
        groupSpy = vi.spyOn(console, 'group').mockImplementation(() => {});
        groupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
      });

      afterEach(() => {
        groupSpy.mockRestore();
        groupEndSpy.mockRestore();
      });

      it('should start console group with label', () => {
        logger.group('Group Label');
        expect(consoleSpy.log).toHaveBeenCalled();
        expect(groupSpy).toHaveBeenCalled();
      });

      it('should start console group without label', () => {
        logger.group();
        expect(groupSpy).toHaveBeenCalled();
      });

      it('should end console group', () => {
        logger.groupEnd();
        expect(groupEndSpy).toHaveBeenCalled();
      });
    });

    describe('table', () => {
      let tableSpy: any;

      beforeEach(() => {
        tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
      });

      afterEach(() => {
        tableSpy.mockRestore();
      });

      it('should output data as table', () => {
        const data = [{ a: 1, b: 2 }];
        logger.table(data);
        expect(tableSpy).toHaveBeenCalledWith(data, undefined);
      });

      it('should output table with specific columns', () => {
        const data = [{ a: 1, b: 2, c: 3 }];
        logger.table(data, ['a', 'b']);
        expect(tableSpy).toHaveBeenCalledWith(data, ['a', 'b']);
      });
    });
  });

  describe('setter methods', () => {
    it('should update log level', () => {
      logger.setLevel('error');
      expect(logger.level).toBe('error');
    });

    it('should update colors setting', () => {
      logger.setColors(false);
      expect(logger.colors).toBe(false);
    });

    it('should update timestamps setting', () => {
      logger.setTimestamps(true);
      expect(logger.timestamps).toBe(true);
    });

    it('should update JSON setting', () => {
      logger.setJson(true);
      expect(logger.json).toBe(true);
    });
  });
});

describe('default logger instance', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should use LOG_LEVEL environment variable', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { logger } = await import('@/utils/logger');
    expect(logger.level).toBe('debug');
  });

  it('should use LOG_TIMESTAMPS environment variable', async () => {
    process.env.LOG_TIMESTAMPS = 'true';
    const { logger } = await import('@/utils/logger');
    expect(logger.timestamps).toBe(true);
  });

  it('should use LOG_FORMAT environment variable for JSON', async () => {
    process.env.LOG_FORMAT = 'json';
    const { logger } = await import('@/utils/logger');
    expect(logger.json).toBe(true);
  });

  it('should respect FORCE_COLOR environment variable', async () => {
    process.env.FORCE_COLOR = '0';
    const { logger } = await import('@/utils/logger');
    expect(logger.colors).toBe(false);
  });
});
