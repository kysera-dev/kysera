import { describe, it, expect } from 'vitest'
import {
  signCursor,
  verifyCursor,
  encryptCursor,
  decryptCursor,
  type CursorSecurityOptions
} from '../src/cursor-crypto.js'
import { BadRequestError } from '../src/errors.js'

describe('Cursor Cryptography', () => {
  const testSecret = 'test-secret-key-at-least-16-chars'
  const testCursor = 'eyJpZCI6MTAwfQ=='

  describe('signCursor', () => {
    it('should sign a cursor with default algorithm (sha256)', () => {
      const signed = signCursor(testCursor, testSecret)

      expect(signed).toContain('.')
      const [cursor, signature] = signed.split('.')
      expect(cursor).toBe(testCursor)
      expect(signature).toBeTruthy()
      expect(signature?.length).toBeGreaterThan(0)
    })

    it('should sign a cursor with sha384', () => {
      const signed = signCursor(testCursor, testSecret, 'sha384')

      expect(signed).toContain('.')
      const [cursor, signature] = signed.split('.')
      expect(cursor).toBe(testCursor)
      expect(signature).toBeTruthy()
      // SHA-384 produces longer signatures than SHA-256
      expect(signature!.length).toBeGreaterThan(64)
    })

    it('should sign a cursor with sha512', () => {
      const signed = signCursor(testCursor, testSecret, 'sha512')

      expect(signed).toContain('.')
      const [cursor, signature] = signed.split('.')
      expect(cursor).toBe(testCursor)
      expect(signature).toBeTruthy()
      // SHA-512 produces even longer signatures
      expect(signature!.length).toBeGreaterThan(96)
    })

    it('should produce different signatures for different cursors', () => {
      const cursor1 = 'eyJpZCI6MTAwfQ=='
      const cursor2 = 'eyJpZCI6MjAwfQ=='

      const signed1 = signCursor(cursor1, testSecret)
      const signed2 = signCursor(cursor2, testSecret)

      expect(signed1).not.toBe(signed2)
    })

    it('should produce different signatures with different secrets', () => {
      const secret1 = 'test-secret-key-1-at-least-16-chars'
      const secret2 = 'test-secret-key-2-at-least-16-chars'

      const signed1 = signCursor(testCursor, secret1)
      const signed2 = signCursor(testCursor, secret2)

      expect(signed1).not.toBe(signed2)
    })

    it('should throw error for empty cursor', () => {
      expect(() => signCursor('', testSecret)).toThrow(BadRequestError)
      expect(() => signCursor('', testSecret)).toThrow('Cursor cannot be empty')
    })

    it('should throw error for short secret', () => {
      expect(() => signCursor(testCursor, 'short')).toThrow('Secret must be at least 16 characters')
    })
  })

  describe('verifyCursor', () => {
    it('should verify and extract a signed cursor', () => {
      const signed = signCursor(testCursor, testSecret)
      const verified = verifyCursor(signed, testSecret)

      expect(verified).toBe(testCursor)
    })

    it('should verify cursor signed with different algorithms', () => {
      const algorithms: Array<'sha256' | 'sha384' | 'sha512'> = ['sha256', 'sha384', 'sha512']

      for (const algorithm of algorithms) {
        const signed = signCursor(testCursor, testSecret, algorithm)
        const verified = verifyCursor(signed, testSecret, algorithm)
        expect(verified).toBe(testCursor)
      }
    })

    it('should throw error for tampered cursor', () => {
      const signed = signCursor(testCursor, testSecret)
      const tampered = signed.replace('eyJ', 'xyz')

      expect(() => verifyCursor(tampered, testSecret)).toThrow(BadRequestError)
      expect(() => verifyCursor(tampered, testSecret)).toThrow('cursor has been tampered with')
    })

    it('should throw error for tampered signature', () => {
      const signed = signCursor(testCursor, testSecret)
      const [cursor, signature] = signed.split('.')
      const tamperedSignature = signature!.replace('a', 'b')
      const tampered = `${cursor}.${tamperedSignature}`

      expect(() => verifyCursor(tampered, testSecret)).toThrow(BadRequestError)
      expect(() => verifyCursor(tampered, testSecret)).toThrow('cursor has been tampered with')
    })

    it('should throw error for wrong secret', () => {
      const signed = signCursor(testCursor, testSecret)
      const wrongSecret = 'wrong-secret-key-at-least-16-chars'

      expect(() => verifyCursor(signed, wrongSecret)).toThrow(BadRequestError)
      expect(() => verifyCursor(signed, wrongSecret)).toThrow('cursor has been tampered with')
    })

    it('should throw error for invalid format (no dot)', () => {
      expect(() => verifyCursor('invalidformat', testSecret)).toThrow(BadRequestError)
      expect(() => verifyCursor('invalidformat', testSecret)).toThrow('missing signature')
    })

    it('should throw error for empty cursor', () => {
      expect(() => verifyCursor('', testSecret)).toThrow(BadRequestError)
      expect(() => verifyCursor('', testSecret)).toThrow('Signed cursor cannot be empty')
    })

    it('should throw error for empty signature', () => {
      expect(() => verifyCursor('cursor.', testSecret)).toThrow(BadRequestError)
      expect(() => verifyCursor('cursor.', testSecret)).toThrow('empty cursor or signature')
    })

    it('should throw error for short secret', () => {
      const signed = signCursor(testCursor, testSecret)
      expect(() => verifyCursor(signed, 'short')).toThrow('Secret must be at least 16 characters')
    })

    it('should handle cursors with dots in the value', () => {
      const cursorWithDot = 'eyJ1cmwiOiJodHRwOi8vZXhhbXBsZS5jb20ifQ=='
      const signed = signCursor(cursorWithDot, testSecret)
      const verified = verifyCursor(signed, testSecret)

      expect(verified).toBe(cursorWithDot)
    })
  })

  describe('encryptCursor', () => {
    it('should encrypt a cursor', () => {
      const encrypted = encryptCursor(testCursor, testSecret)

      expect(encrypted).toBeTruthy()
      expect(encrypted).not.toBe(testCursor)
      // Format: iv.encrypted.authTag (3 parts)
      expect(encrypted.split('.').length).toBe(3)
    })

    it('should produce different encrypted values each time (random IV)', () => {
      const encrypted1 = encryptCursor(testCursor, testSecret)
      const encrypted2 = encryptCursor(testCursor, testSecret)

      // Should be different due to random IV
      expect(encrypted1).not.toBe(encrypted2)
    })

    it('should throw error for empty cursor', () => {
      expect(() => encryptCursor('', testSecret)).toThrow(BadRequestError)
      expect(() => encryptCursor('', testSecret)).toThrow('Cursor cannot be empty')
    })

    it('should throw error for short secret', () => {
      expect(() => encryptCursor(testCursor, 'short')).toThrow('Secret must be at least 16 characters')
    })
  })

  describe('decryptCursor', () => {
    it('should decrypt an encrypted cursor', () => {
      const encrypted = encryptCursor(testCursor, testSecret)
      const decrypted = decryptCursor(encrypted, testSecret)

      expect(decrypted).toBe(testCursor)
    })

    it('should decrypt multiple cursors with same secret', () => {
      const cursor1 = 'eyJpZCI6MTAwfQ=='
      const cursor2 = 'eyJpZCI6MjAwfQ=='

      const encrypted1 = encryptCursor(cursor1, testSecret)
      const encrypted2 = encryptCursor(cursor2, testSecret)

      expect(decryptCursor(encrypted1, testSecret)).toBe(cursor1)
      expect(decryptCursor(encrypted2, testSecret)).toBe(cursor2)
    })

    it('should throw error for wrong secret', () => {
      const encrypted = encryptCursor(testCursor, testSecret)
      const wrongSecret = 'wrong-secret-key-at-least-16-chars'

      expect(() => decryptCursor(encrypted, wrongSecret)).toThrow(BadRequestError)
      expect(() => decryptCursor(encrypted, wrongSecret)).toThrow('Failed to decrypt cursor')
    })

    it('should throw error for tampered encrypted cursor', () => {
      const encrypted = encryptCursor(testCursor, testSecret)
      const tampered = encrypted.replace('a', 'b')

      expect(() => decryptCursor(tampered, testSecret)).toThrow(BadRequestError)
      expect(() => decryptCursor(tampered, testSecret)).toThrow('Failed to decrypt cursor')
    })

    it('should throw error for invalid format (wrong number of parts)', () => {
      expect(() => decryptCursor('invalid', testSecret)).toThrow(BadRequestError)
      expect(() => decryptCursor('invalid', testSecret)).toThrow('expected iv.encrypted.authTag')
    })

    it('should throw error for invalid format (only 2 parts)', () => {
      expect(() => decryptCursor('part1.part2', testSecret)).toThrow(BadRequestError)
      expect(() => decryptCursor('part1.part2', testSecret)).toThrow('expected iv.encrypted.authTag')
    })

    it('should throw error for empty encrypted cursor', () => {
      expect(() => decryptCursor('', testSecret)).toThrow(BadRequestError)
      expect(() => decryptCursor('', testSecret)).toThrow('Encrypted cursor cannot be empty')
    })

    it('should throw error for short secret', () => {
      const encrypted = encryptCursor(testCursor, testSecret)
      expect(() => decryptCursor(encrypted, 'short')).toThrow('Secret must be at least 16 characters')
    })

    it('should handle Unicode characters', () => {
      const unicodeCursor = 'eyJ1c2VyIjoi5pel5pysIn0=' // Japanese characters
      const encrypted = encryptCursor(unicodeCursor, testSecret)
      const decrypted = decryptCursor(encrypted, testSecret)

      expect(decrypted).toBe(unicodeCursor)
    })
  })

  describe('Combined signing and encryption', () => {
    it('should encrypt then sign a cursor', () => {
      const encrypted = encryptCursor(testCursor, testSecret)
      const signed = signCursor(encrypted, testSecret)

      expect(signed).toContain('.')
      expect(signed).not.toBe(testCursor)
    })

    it('should verify then decrypt a cursor', () => {
      const encrypted = encryptCursor(testCursor, testSecret)
      const signed = signCursor(encrypted, testSecret)

      // Verify signature first
      const verified = verifyCursor(signed, testSecret)
      // Then decrypt
      const decrypted = decryptCursor(verified, testSecret)

      expect(decrypted).toBe(testCursor)
    })

    it('should reject tampered encrypted+signed cursor at signature verification', () => {
      const encrypted = encryptCursor(testCursor, testSecret)
      const signed = signCursor(encrypted, testSecret)
      const tampered = signed.replace('a', 'b')

      expect(() => verifyCursor(tampered, testSecret)).toThrow(BadRequestError)
      expect(() => verifyCursor(tampered, testSecret)).toThrow('cursor has been tampered with')
    })
  })

  describe('Security options interface', () => {
    it('should have correct type structure', () => {
      const options: CursorSecurityOptions = {
        secret: testSecret,
        encrypt: true,
        algorithm: 'sha256'
      }

      expect(options.secret).toBe(testSecret)
      expect(options.encrypt).toBe(true)
      expect(options.algorithm).toBe('sha256')
    })

    it('should allow optional fields', () => {
      const minimalOptions: CursorSecurityOptions = {
        secret: testSecret
      }

      expect(minimalOptions.secret).toBe(testSecret)
      expect(minimalOptions.encrypt).toBeUndefined()
      expect(minimalOptions.algorithm).toBeUndefined()
    })
  })
})
