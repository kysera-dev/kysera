import type { z } from 'zod';
import type { KyseraLogger } from '@kysera/core';
import { consoleLogger } from '@kysera/core';

/**
 * Validation utilities for repositories
 */

export interface ValidationOptions {
  /**
   * Validate database results in development
   */
  validateDbResults?: boolean;

  /**
   * Always validate inputs
   */
  validateInputs?: boolean;

  /**
   * Custom validation mode
   */
  mode?: 'development' | 'production' | 'always' | 'never';

  /**
   * Logger for validation errors
   * @default consoleLogger
   */
  logger?: KyseraLogger;
}

/**
 * Get validation mode from environment
 *
 * Supported environment variables (in order of precedence):
 * - `KYSERA_VALIDATION_MODE`: 'always' | 'never' | 'development' | 'production'
 * - `KYSERA_VALIDATE`: 'always' | 'never' (backward compatibility)
 * - `VALIDATE_DB_RESULTS`: 'always' | 'never' (legacy)
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
  // Check Kysera-specific environment variables first
  const kyseraMode = process.env['KYSERA_VALIDATION_MODE'];
  if (
    kyseraMode === 'always' ||
    kyseraMode === 'never' ||
    kyseraMode === 'development' ||
    kyseraMode === 'production'
  ) {
    return kyseraMode;
  }

  // Check alternative environment variables (backward compatibility)
  const kyseraValidate = process.env['KYSERA_VALIDATE'];
  if (kyseraValidate === 'always') return 'always';
  if (kyseraValidate === 'never') return 'never';

  const validateMode = process.env['VALIDATE_DB_RESULTS'];
  if (validateMode === 'always') return 'always';
  if (validateMode === 'never') return 'never';

  // Fallback to NODE_ENV
  const env = process.env['NODE_ENV'];
  return env === 'development' ? 'development' : 'production';
}

/**
 * Should validate based on options
 */
export function shouldValidate(options?: ValidationOptions): boolean {
  const mode = options?.mode || getValidationMode();

  switch (mode) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'development':
      return process.env['NODE_ENV'] === 'development';
    case 'production':
      return false;
    default:
      return false;
  }
}

/**
 * Safe parse with error logging
 */
export function safeParse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  options?: {
    throwOnError?: boolean;
    logErrors?: boolean;
    logger?: KyseraLogger;
  }
): T | null {
  const logger = options?.logger ?? consoleLogger;
  try {
    return schema.parse(data);
  } catch (error) {
    if (options?.logErrors) {
      logger.error('Validation error:', error);
    }
    if (options?.throwOnError) {
      throw error;
    }
    return null;
  }
}

/**
 * Create a validation wrapper
 */
export function createValidator<T>(
  schema: z.ZodType<T>,
  options?: ValidationOptions
): {
  validate: (data: unknown) => T;
  validateSafe: (data: unknown) => T | null;
  isValid: (data: unknown) => boolean;
  validateConditional: (data: unknown) => T;
} {
  return {
    validate(data: unknown): T {
      return schema.parse(data);
    },

    validateSafe(data: unknown): T | null {
      return safeParse(schema, data);
    },

    isValid(data: unknown): boolean {
      return schema.safeParse(data).success;
    },

    validateConditional(data: unknown): T {
      if (shouldValidate(options)) {
        return schema.parse(data);
      }
      return data as T;
    },
  };
}
