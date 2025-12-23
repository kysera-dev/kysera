import type { KyseraLogger } from '@kysera/core'
import { consoleLogger } from '@kysera/core'
import type { ValidationSchema } from './validation-adapter.js'

/**
 * Validation utilities for repositories
 */

/**
 * Cross-runtime environment variable access
 * Works in Node.js, Deno, and browsers (with polyfill)
 */
export function getEnv(key: string): string | undefined {
  // Node.js / Bun
  if (globalThis.process?.env) {
    return globalThis.process.env[key]
  }
  // Deno
  if (
    typeof (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno !==
    'undefined'
  ) {
    try {
      return (
        globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }
      ).Deno?.env?.get(key)
    } catch {
      return undefined
    }
  }
  // Browser / other - no env vars
  return undefined
}

export interface ValidationOptions {
  /**
   * Validate database results in development
   */
  validateDbResults?: boolean

  /**
   * Always validate inputs
   */
  validateInputs?: boolean

  /**
   * Custom validation mode
   */
  mode?: 'development' | 'production' | 'always' | 'never'

  /**
   * Logger for validation errors
   * @default consoleLogger
   */
  logger?: KyseraLogger
}

/**
 * Get validation mode from environment
 *
 * Supported environment variables (in order of precedence):
 * - `KYSERA_VALIDATION_MODE`: 'always' | 'never' | 'development' | 'production'
 * - `NODE_ENV`: 'development' (enables validation) | 'production' (disables validation)
 *
 * @example
 * ```typescript
 * // Enable validation always
 * KYSERA_VALIDATION_MODE=always
 *
 * // Disable validation in development
 * KYSERA_VALIDATION_MODE=never
 *
 * // Use NODE_ENV (default behavior)
 * NODE_ENV=development  // validation enabled
 * NODE_ENV=production   // validation disabled
 * ```
 */
export function getValidationMode(): ValidationOptions['mode'] {
  const kyseraMode = getEnv('KYSERA_VALIDATION_MODE')
  if (
    kyseraMode === 'always' ||
    kyseraMode === 'never' ||
    kyseraMode === 'development' ||
    kyseraMode === 'production'
  ) {
    return kyseraMode
  }

  // Fallback to NODE_ENV
  const env = getEnv('NODE_ENV')
  return env === 'development' ? 'development' : 'production'
}

/**
 * Should validate based on options
 */
export function shouldValidate(options?: ValidationOptions): boolean {
  const mode = options?.mode || getValidationMode()

  switch (mode) {
    case 'always':
      return true
    case 'never':
      return false
    case 'development':
      return getEnv('NODE_ENV') === 'development'
    case 'production':
      return false
    default:
      return false
  }
}

/**
 * Safe parse with error logging.
 * Works with any ValidationSchema-compatible validator.
 */
export function safeParse<T>(
  schema: ValidationSchema<T>,
  data: unknown,
  options?: {
    throwOnError?: boolean
    logErrors?: boolean
    logger?: KyseraLogger
  }
): T | null {
  const logger = options?.logger ?? consoleLogger
  const result = schema.safeParse(data)

  if (result.success) {
    return result.data
  }

  if (options?.logErrors) {
    logger.error('Validation error:', result.error)
  }

  if (options?.throwOnError) {
    throw new Error(result.error.message)
  }

  return null
}

/**
 * Create a validation wrapper.
 * Works with any ValidationSchema-compatible validator.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { zodAdapter, createValidator } from '@kysera/repository';
 *
 * const UserSchema = z.object({ name: z.string(), age: z.number() });
 * const validator = createValidator(zodAdapter(UserSchema));
 *
 * // Various validation methods
 * const user = validator.validate({ name: 'John', age: 30 }); // throws on error
 * const userOrNull = validator.validateSafe({ name: 'John', age: 30 }); // returns null on error
 * const isValid = validator.isValid({ name: 'John', age: 30 }); // returns boolean
 * const userConditional = validator.validateConditional({ name: 'John', age: 30 }); // validates based on options/env
 * ```
 */
export function createValidator<T>(
  schema: ValidationSchema<T>,
  options?: ValidationOptions
): {
  validate: (data: unknown) => T
  validateSafe: (data: unknown) => T | null
  isValid: (data: unknown) => boolean
  validateConditional: (data: unknown) => T
} {
  return {
    validate(data: unknown): T {
      return schema.parse(data)
    },

    validateSafe(data: unknown): T | null {
      return safeParse(schema, data)
    },

    isValid(data: unknown): boolean {
      return schema.safeParse(data).success
    },

    validateConditional(data: unknown): T {
      if (shouldValidate(options)) {
        return schema.parse(data)
      }
      return data as T
    }
  }
}
