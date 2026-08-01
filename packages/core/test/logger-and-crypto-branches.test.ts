/**
 * Small uncovered branches: silentLogger trace/fatal, cursor-crypto
 * length-mismatch and malformed-format paths.
 */
import { describe, it, expect } from 'vitest'
import { silentLogger, consoleLogger } from '../src/logger.js'
import { signCursor, verifyCursor, encryptCursor, decryptCursor } from '../src/cursor-crypto.js'

const SECRET = 'a'.repeat(32)

describe('silentLogger full surface', () => {
  it('every level is callable and returns undefined', () => {
    expect(silentLogger.trace('t')).toBeUndefined()
    expect(silentLogger.debug('d')).toBeUndefined()
    expect(silentLogger.info('i')).toBeUndefined()
    expect(silentLogger.warn('w')).toBeUndefined()
    expect(silentLogger.error('e')).toBeUndefined()
    expect(silentLogger.fatal('f')).toBeUndefined()
  })

  it('consoleLogger exposes the same level surface as silentLogger', () => {
    const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
    for (const level of levels) {
      expect(typeof silentLogger[level]).toBe('function')
      expect(typeof consoleLogger[level]).toBe('function')
    }
  })
})

describe('cursor-crypto edge branches', () => {
  it('verifyCursor rejects signatures of different length (timing-safe guard)', () => {
    const signed = signCursor('payload', SECRET)
    // Truncate the signature → different length than the expected HMAC hex
    const lastDot = signed.lastIndexOf('.')
    const truncated = `${signed.slice(0, lastDot)}.${signed.slice(lastDot + 1, lastDot + 11)}`
    expect(() => verifyCursor(truncated, SECRET)).toThrow(/tampered/)
  })

  it('decryptCursor rejects ciphertext with empty segments', () => {
    const encrypted = encryptCursor('data', SECRET)
    const parts = encrypted.split('.')
    expect(parts).toHaveLength(3)
    expect(() => decryptCursor(`.${parts[1]!}.${parts[2]!}`, SECRET)).toThrow(/missing components/)
    expect(() => decryptCursor(`${parts[0]!}..${parts[2]!}`, SECRET)).toThrow(/missing components/)
    expect(() => decryptCursor(`${parts[0]!}.${parts[1]!}.`, SECRET)).toThrow(/missing components/)
  })

  it('decryptCursor rejects wrong segment count', () => {
    expect(() => decryptCursor('only.two', SECRET)).toThrow(/expected iv\.encrypted\.authTag/)
    expect(() => decryptCursor('a.b.c.d', SECRET)).toThrow(/expected iv\.encrypted\.authTag/)
  })
})
