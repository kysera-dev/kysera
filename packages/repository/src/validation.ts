import type { z } from 'zod'

/**
 * Validation utilities for repositories
 */

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
}

/**
 * Get validation mode from environment
 */
export function getValidationMode(): ValidationOptions['mode'] {
  const env = process.env['NODE_ENV']
  const validateMode = process.env['VALIDATE_DB_RESULTS']

  if (validateMode === 'always') return 'always'
  if (validateMode === 'never') return 'never'

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
      return process.env['NODE_ENV'] === 'development'
    case 'production':
      return false
    default:
      return false
  }
}

/**
 * Safe parse with error logging
 */
export function safeParse<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  options?: {
    throwOnError?: boolean
    logErrors?: boolean
  }
): T | null {
  try {
    return schema.parse(data)
  } catch (error) {
    if (options?.logErrors) {
      console.error('Validation error:', error)
    }
    if (options?.throwOnError) {
      throw error
    }
    return null
  }
}

/**
 * Create a validation wrapper
 */
export function createValidator<T>(
  schema: z.ZodSchema<T>,
  options?: ValidationOptions
) {
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