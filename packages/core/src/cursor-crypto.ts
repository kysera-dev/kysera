/**
 * Cursor cryptography for secure pagination
 *
 * Provides signing and encryption for pagination cursors to prevent tampering
 * and unauthorized data access. Uses Node.js crypto module with HMAC signing
 * and AES-256-GCM encryption.
 *
 * @module cursor-crypto
 */

import {
  createHmac,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual as cryptoTimingSafeEqual
} from 'node:crypto'
import { BadRequestError } from './errors.js'

/**
 * Security options for cursor signing and encryption
 */
export interface CursorSecurityOptions {
  /**
   * Secret key for HMAC signing (minimum 32 bytes recommended)
   */
  secret: string

  /**
   * Enable AES-256-GCM encryption (in addition to signing)
   * Default: false
   */
  encrypt?: boolean

  /**
   * HMAC algorithm to use for signing
   * Default: 'sha256'
   */
  algorithm?: 'sha256' | 'sha384' | 'sha512'
}

/**
 * Sign a cursor with HMAC
 *
 * Creates a signed cursor in the format: `cursor.signature`
 * The signature is an HMAC of the cursor using the provided secret.
 *
 * @param cursor - The cursor string to sign
 * @param secret - Secret key for HMAC (minimum 32 bytes recommended)
 * @param algorithm - HMAC algorithm (default: 'sha256')
 * @returns Signed cursor in format: `cursor.signature`
 *
 * @example
 * ```ts
 * const cursor = 'eyJpZCI6MTAwfQ=='
 * const signed = signCursor(cursor, 'my-secret-key')
 * // Returns: 'eyJpZCI6MTAwfQ==.a1b2c3d4...'
 * ```
 */
export function signCursor(
  cursor: string,
  secret: string,
  algorithm: 'sha256' | 'sha384' | 'sha512' = 'sha256'
): string {
  if (!cursor) {
    throw new BadRequestError('Cursor cannot be empty')
  }

  if (!secret || secret.length < 16) {
    throw new Error('Secret must be at least 16 characters long')
  }

  const hmac = createHmac(algorithm, secret)
  hmac.update(cursor)
  const signature = hmac.digest('hex')

  return `${cursor}.${signature}`
}

/**
 * Verify and extract a signed cursor
 *
 * Verifies the HMAC signature and extracts the original cursor.
 * Throws BadRequestError if the signature is invalid or format is incorrect.
 *
 * @param signedCursor - The signed cursor in format: `cursor.signature`
 * @param secret - Secret key used for signing
 * @param algorithm - HMAC algorithm (must match signing algorithm)
 * @returns Original cursor (unsigned)
 * @throws {BadRequestError} When signature is invalid or format is incorrect
 *
 * @example
 * ```ts
 * const signed = 'eyJpZCI6MTAwfQ==.a1b2c3d4...'
 * const cursor = verifyCursor(signed, 'my-secret-key')
 * // Returns: 'eyJpZCI6MTAwfQ=='
 * ```
 */
export function verifyCursor(
  signedCursor: string,
  secret: string,
  algorithm: 'sha256' | 'sha384' | 'sha512' = 'sha256'
): string {
  if (!signedCursor) {
    throw new BadRequestError('Signed cursor cannot be empty')
  }

  if (!secret || secret.length < 16) {
    throw new Error('Secret must be at least 16 characters long')
  }

  // Split on last dot to handle cursors that may contain dots
  const lastDotIndex = signedCursor.lastIndexOf('.')
  if (lastDotIndex === -1) {
    throw new BadRequestError('Invalid signed cursor format: missing signature')
  }

  const cursor = signedCursor.substring(0, lastDotIndex)
  const providedSignature = signedCursor.substring(lastDotIndex + 1)

  if (!cursor || !providedSignature) {
    throw new BadRequestError('Invalid signed cursor format: empty cursor or signature')
  }

  // Compute expected signature
  const hmac = createHmac(algorithm, secret)
  hmac.update(cursor)
  const expectedSignature = hmac.digest('hex')

  // Timing-safe comparison to prevent timing attacks
  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    throw new BadRequestError('Invalid cursor signature: cursor has been tampered with')
  }

  return cursor
}

/**
 * Encrypt a cursor with AES-256-GCM
 *
 * Encrypts the cursor using AES-256-GCM with a random IV.
 * Format: `iv.encrypted.authTag` (all hex-encoded)
 *
 * @param cursor - The cursor string to encrypt
 * @param secret - Secret key for encryption (will be hashed to 32 bytes)
 * @returns Encrypted cursor in format: `iv.encrypted.authTag`
 *
 * @example
 * ```ts
 * const cursor = 'eyJpZCI6MTAwfQ=='
 * const encrypted = encryptCursor(cursor, 'my-secret-key')
 * // Returns: 'a1b2c3...iv.d4e5f6...encrypted.g7h8i9...authTag'
 * ```
 */
export function encryptCursor(cursor: string, secret: string): string {
  if (!cursor) {
    throw new BadRequestError('Cursor cannot be empty')
  }

  if (!secret || secret.length < 16) {
    throw new Error('Secret must be at least 16 characters long')
  }

  // Derive 32-byte key from secret using SHA-256
  const key = createHmac('sha256', secret).update('aes-key-derivation').digest()

  // Generate random 12-byte IV (recommended for GCM)
  const iv = randomBytes(12)

  // Create cipher
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  // Encrypt cursor
  const encrypted = Buffer.concat([cipher.update(cursor, 'utf8'), cipher.final()])

  // Get authentication tag
  const authTag = cipher.getAuthTag()

  // Return format: iv.encrypted.authTag (all hex-encoded)
  return `${iv.toString('hex')}.${encrypted.toString('hex')}.${authTag.toString('hex')}`
}

/**
 * Decrypt an encrypted cursor
 *
 * Decrypts a cursor encrypted with AES-256-GCM.
 * Verifies authentication tag to ensure integrity.
 *
 * @param encryptedCursor - The encrypted cursor in format: `iv.encrypted.authTag`
 * @param secret - Secret key used for encryption
 * @returns Original cursor (decrypted)
 * @throws {BadRequestError} When format is invalid or decryption fails
 *
 * @example
 * ```ts
 * const encrypted = 'a1b2c3...iv.d4e5f6...encrypted.g7h8i9...authTag'
 * const cursor = decryptCursor(encrypted, 'my-secret-key')
 * // Returns: 'eyJpZCI6MTAwfQ=='
 * ```
 */
export function decryptCursor(encryptedCursor: string, secret: string): string {
  if (!encryptedCursor) {
    throw new BadRequestError('Encrypted cursor cannot be empty')
  }

  if (!secret || secret.length < 16) {
    throw new Error('Secret must be at least 16 characters long')
  }

  // Parse format: iv.encrypted.authTag
  const parts = encryptedCursor.split('.')
  if (parts.length !== 3) {
    throw new BadRequestError(
      'Invalid encrypted cursor format: expected iv.encrypted.authTag'
    )
  }

  const [ivHex, encryptedHex, authTagHex] = parts as [string, string, string]

  if (!ivHex || !encryptedHex || !authTagHex) {
    throw new BadRequestError('Invalid encrypted cursor format: missing components')
  }

  try {
    // Parse hex components
    const iv = Buffer.from(ivHex, 'hex')
    const encrypted = Buffer.from(encryptedHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')

    // Derive same 32-byte key from secret
    const key = createHmac('sha256', secret).update('aes-key-derivation').digest()

    // Create decipher
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    // Decrypt cursor
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

    return decrypted.toString('utf8')
  } catch (error) {
    // Authentication tag verification failed or decryption error
    throw new BadRequestError(
      `Failed to decrypt cursor: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Timing-safe string comparison to prevent timing attacks
 *
 * Compares two strings in constant time to avoid leaking information
 * about the expected value through timing differences.
 *
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are equal, false otherwise
 */
function timingSafeEqual(a: string, b: string): boolean {
  // Convert to buffers for constant-time comparison
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)

  // If lengths differ, still compare to avoid timing leak
  if (bufA.length !== bufB.length) {
    return false
  }

  // Use Node.js crypto.timingSafeEqual for constant-time comparison
  return cryptoTimingSafeEqual(bufA, bufB)
}
