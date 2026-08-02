/**
 * Logger tests.
 *
 * Output contract: stdout carries data only, so ALL leveled diagnostics
 * (debug/info/warn/error/success) are written via console.error (stderr).
 * `log()` and `table()` are data-rendering helpers and stay on stdout.
 * (The previous suite asserted the old split across console.log and
 * @xec-sh/kit's log helpers, which the output contract removed.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger, createLogger } from '@/utils/logger.js'

describe('Logger', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const firstLine = (): string => String(errorSpy.mock.calls[0]?.[0] ?? '')

  describe('log level filtering', () => {
    it('should log debug to stderr when level is debug', () => {
      const debugLogger = createLogger({ level: 'debug' })
      debugLogger.debug('debug message')
      expect(errorSpy).toHaveBeenCalled()
      expect(firstLine()).toContain('debug message')
    })

    it('should not log debug when level is info', () => {
      const infoLogger = createLogger({ level: 'info' })
      infoLogger.debug('debug message')
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('should log info to stderr when level is info', () => {
      const infoLogger = createLogger({ level: 'info' })
      infoLogger.info('info message')
      expect(errorSpy).toHaveBeenCalled()
      expect(firstLine()).toContain('info message')
    })

    it('should not log info when level is warn', () => {
      const warnLogger = createLogger({ level: 'warn' })
      warnLogger.info('info message')
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('should log warn to stderr when level is warn', () => {
      const warnLogger = createLogger({ level: 'warn' })
      warnLogger.warn('warn message')
      expect(errorSpy).toHaveBeenCalled()
      expect(firstLine()).toContain('warn message')
    })

    it('should not log warn when level is error', () => {
      const errorLogger = createLogger({ level: 'error' })
      errorLogger.warn('warn message')
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('should always log error when level is error', () => {
      const errorLogger = createLogger({ level: 'error' })
      errorLogger.error('error message')
      expect(errorSpy).toHaveBeenCalled()
      expect(firstLine()).toContain('error message')
    })
  })

  describe('message formatting', () => {
    it('should format messages with util.format arguments', () => {
      const testLogger = createLogger({ level: 'debug' })
      testLogger.debug('value is %s', 'test')
      expect(firstLine()).toContain('value is test')
    })

    it('should include level tags without colors', () => {
      const testLogger = createLogger({ level: 'debug', colors: false })
      testLogger.info('hello')
      expect(firstLine()).toContain('[INFO]')
      errorSpy.mockClear()
      testLogger.warn('hello')
      expect(firstLine()).toContain('[WARN]')
      errorSpy.mockClear()
      testLogger.error('hello')
      expect(firstLine()).toContain('[ERROR]')
      errorSpy.mockClear()
      testLogger.debug('hello')
      expect(firstLine()).toContain('[DEBUG]')
    })

    it('should handle Error instances in error()', () => {
      const testLogger = createLogger({ level: 'info' })
      testLogger.error(new Error('boom'))
      expect(firstLine()).toContain('boom')
    })

    it('should print the stack for Error instances at debug level', () => {
      const testLogger = createLogger({ level: 'debug' })
      testLogger.error(new Error('boom'))
      expect(firstLine()).toContain('boom')
      expect(errorSpy.mock.calls.length).toBeGreaterThan(1)
    })
  })

  describe('success method', () => {
    it('should log success to stderr at info level', () => {
      const testLogger = createLogger({ level: 'info', colors: false })
      testLogger.success('done')
      expect(firstLine()).toContain('[SUCCESS]')
      expect(firstLine()).toContain('done')
    })

    it('should not log success when level is warn', () => {
      const testLogger = createLogger({ level: 'warn' })
      testLogger.success('done')
      expect(errorSpy).not.toHaveBeenCalled()
    })
  })

  describe('json mode', () => {
    it('should emit structured JSON entries on stderr', () => {
      const testLogger = createLogger({ level: 'info', json: true })
      testLogger.info('structured message')
      const entry = JSON.parse(firstLine()) as { level: string; message: string; timestamp: string }
      expect(entry.level).toBe('info')
      expect(entry.message).toBe('structured message')
      expect(entry.timestamp).toBeDefined()
    })

    it('should emit JSON for success entries', () => {
      const testLogger = createLogger({ level: 'info', json: true })
      testLogger.success('ok')
      const entry = JSON.parse(firstLine()) as { level: string; message: string }
      expect(entry.level).toBe('success')
      expect(entry.message).toBe('ok')
    })
  })

  describe('timestamps', () => {
    it('should prefix messages with an ISO timestamp when enabled', () => {
      const testLogger = createLogger({ level: 'info', timestamps: true, colors: false })
      testLogger.info('with time')
      expect(firstLine()).toMatch(/\[\d{4}-\d{2}-\d{2}T/)
    })
  })

  describe('data helpers stay on stdout', () => {
    it('log() writes raw output to stdout', () => {
      logger.log('raw data %s', 'value')
      expect(logSpy).toHaveBeenCalledWith('raw data value')
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('newline() writes diagnostic spacing to stderr', () => {
      logger.newline()
      expect(errorSpy).toHaveBeenCalledWith('')
    })

    it('table() delegates to console.table', () => {
      const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {})
      logger.table([{ a: 1 }])
      expect(tableSpy).toHaveBeenCalled()
    })
  })

  describe('setters', () => {
    it('setLevel changes filtering', () => {
      const testLogger = createLogger({ level: 'error' })
      testLogger.info('hidden')
      expect(errorSpy).not.toHaveBeenCalled()
      testLogger.setLevel('info')
      testLogger.info('visible')
      expect(errorSpy).toHaveBeenCalled()
    })

    it('setJson toggles structured output', () => {
      const testLogger = createLogger({ level: 'info' })
      testLogger.setJson(true)
      testLogger.info('as json')
      expect(() => JSON.parse(firstLine())).not.toThrow()
    })

    it('setColors and setTimestamps update flags', () => {
      const testLogger = createLogger({ level: 'info' })
      testLogger.setColors(false)
      testLogger.setTimestamps(true)
      expect(testLogger.colors).toBe(false)
      expect(testLogger.timestamps).toBe(true)
    })
  })
})
