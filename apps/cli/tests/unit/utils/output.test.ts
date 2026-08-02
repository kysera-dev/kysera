/**
 * Output contract tests: stdout carries data only, stderr carries
 * diagnostics, JSON mode always wins, credentials are redacted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  configureOutput,
  resetOutput,
  isJsonMode,
  isQuietMode,
  isVerboseMode,
  output,
  diag,
  diagVerbose,
  outputError,
  redactConnectionString,
  redactConnection,
  toIsoDate,
  toDate
} from '@/utils/output.js'

describe('output contract', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetOutput()
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetOutput()
  })

  const stdoutText = (): string => stdoutSpy.mock.calls.map(c => String(c[0])).join('')
  const stderrText = (): string => stderrSpy.mock.calls.map(c => String(c[0])).join('')

  describe('mode state', () => {
    it('starts with all modes off and merges configuration', () => {
      expect(isJsonMode()).toBe(false)
      expect(isQuietMode()).toBe(false)
      expect(isVerboseMode()).toBe(false)

      configureOutput({ json: true })
      configureOutput({ verbose: true })
      expect(isJsonMode()).toBe(true)
      expect(isVerboseMode()).toBe(true)
      // json setting survived the second call
      expect(isQuietMode()).toBe(false)
    })
  })

  describe('output()', () => {
    it('writes JSON to stdout in JSON mode', () => {
      configureOutput({ json: true })
      output({ value: 42 }, { text: 'human text' })
      expect(JSON.parse(stdoutText())).toEqual({ value: 42 })
      expect(stderrText()).toBe('')
    })

    it('writes JSON when format is forced', () => {
      output({ value: 1 }, { format: 'json' })
      expect(JSON.parse(stdoutText())).toEqual({ value: 1 })
    })

    it('writes text rendering when not in JSON mode', () => {
      output({ value: 42 }, { text: data => `value is ${(data as { value: number }).value}` })
      expect(stdoutText()).toBe('value is 42\n')
    })

    it('writes plain strings directly', () => {
      output('plain result')
      expect(stdoutText()).toBe('plain result\n')
    })

    it('falls back to JSON rendering for objects without text', () => {
      output({ a: 1 })
      expect(JSON.parse(stdoutText())).toEqual({ a: 1 })
    })
  })

  describe('diagnostics', () => {
    it('diag() writes to stderr', () => {
      diag('working...')
      expect(stderrText()).toContain('working...')
      expect(stdoutText()).toBe('')
    })

    it('diag() is suppressed in quiet mode', () => {
      configureOutput({ quiet: true })
      diag('working...')
      expect(stderrText()).toBe('')
    })

    it('diagVerbose() only writes in verbose mode', () => {
      diagVerbose('detail')
      expect(stderrText()).toBe('')
      configureOutput({ verbose: true })
      diagVerbose('detail')
      expect(stderrText()).toContain('detail')
    })
  })

  describe('outputError()', () => {
    it('writes a JSON error document to stderr in JSON mode', () => {
      configureOutput({ json: true })
      outputError({ message: 'failed', code: 'X' })
      const parsed = JSON.parse(stderrText()) as { error: { message: string; code: string } }
      expect(parsed.error.message).toBe('failed')
      expect(parsed.error.code).toBe('X')
      expect(stdoutText()).toBe('')
    })

    it('uses the fallback renderer outside JSON mode', () => {
      const fallback = vi.fn()
      outputError({ message: 'failed' }, fallback)
      expect(fallback).toHaveBeenCalled()
    })
  })

  describe('credential redaction', () => {
    it('redacts passwords in connection URLs', () => {
      expect(redactConnectionString('postgres://admin:s3cr3t@db.example.com:5432/prod')).toBe(
        'postgres://admin:***@db.example.com:5432/prod'
      )
      expect(redactConnectionString('mysql://root:hunter2@localhost/app')).toBe(
        'mysql://root:***@localhost/app'
      )
    })

    it('leaves credential-free URLs unchanged', () => {
      expect(redactConnectionString('sqlite://./test.db')).toBe('sqlite://./test.db')
      expect(redactConnectionString('postgres://localhost/db')).toBe('postgres://localhost/db')
    })

    it('redacts password properties on connection objects', () => {
      expect(redactConnection({ host: 'h', user: 'u', password: 'secret' })).toEqual({
        host: 'h',
        user: 'u',
        password: '***'
      })
    })

    it('passes through other values', () => {
      expect(redactConnection(undefined)).toBeUndefined()
      expect(redactConnection('postgres://u:p@h/db')).toBe('postgres://u:***@h/db')
    })
  })

  describe('date guards', () => {
    it('converts Date instances to ISO strings', () => {
      const date = new Date('2024-01-15T10:30:00Z')
      expect(toIsoDate(date)).toBe('2024-01-15T10:30:00.000Z')
    })

    it('converts SQLite string dates to ISO strings', () => {
      expect(toIsoDate('2024-01-15 10:30:00')).toContain('2024-01-15')
    })

    it('returns null for absent values', () => {
      expect(toIsoDate(null)).toBeNull()
      expect(toIsoDate(undefined)).toBeNull()
    })

    it('never throws on unparseable strings', () => {
      expect(toIsoDate('not-a-date')).toBe('not-a-date')
    })

    it('toDate() coerces values or returns null', () => {
      expect(toDate(new Date('2024-01-15T10:30:00Z'))?.getUTCFullYear()).toBe(2024)
      expect(toDate('2024-01-15T10:30:00Z')?.getUTCFullYear()).toBe(2024)
      expect(toDate('garbage')).toBeNull()
      expect(toDate(null)).toBeNull()
    })
  })
})
