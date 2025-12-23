/**
 * Validation Schema Adapter
 *
 * Provides a unified interface for validation libraries (Zod, Valibot, TypeBox, etc.)
 * This eliminates vendor lock-in and allows users to choose their preferred validation library.
 *
 * @module @kysera/repository/validation-adapter
 */

/**
 * Validation issue details
 */
export interface ValidationIssue {
  /** Error code (library-specific) */
  code: string
  /** Human-readable error message */
  message: string
  /** Path to the invalid field */
  path: (string | number)[]
}

/**
 * Validation error containing all issues
 */
export interface ValidationError {
  /** Primary error message */
  message: string
  /** Path to the first invalid field */
  path?: (string | number)[] | undefined
  /** All validation issues */
  issues?: ValidationIssue[] | undefined
}

/**
 * Result of safe validation (no throwing)
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: ValidationError }

/**
 * Unified validation schema interface.
 * Compatible with Zod, Valibot, TypeBox, io-ts, and native TS validation.
 *
 * @example Zod adapter
 * ```typescript
 * import { z } from 'zod';
 * import { zodAdapter } from '@kysera/repository';
 *
 * const UserSchema = z.object({ name: z.string(), age: z.number() });
 * const validator = zodAdapter(UserSchema);
 *
 * const user = validator.parse({ name: 'John', age: 30 });
 * ```
 *
 * @example Native adapter (no validation)
 * ```typescript
 * import { nativeAdapter } from '@kysera/repository';
 *
 * const validator = nativeAdapter<User>();
 * const user = validator.parse({ name: 'John', age: 30 }); // Just casts type
 * ```
 */
export interface ValidationSchema<T = unknown> {
  /**
   * Parse and validate data.
   * @throws ValidationError if validation fails
   */
  parse(data: unknown): T

  /**
   * Safe parse without throwing.
   * Returns success/failure result with data or error.
   */
  safeParse(data: unknown): ValidationResult<T>

  /**
   * Check if schema supports partial (for update schemas).
   * Returns a new schema that makes all fields optional.
   */
  partial?(): ValidationSchema<Partial<T>>
}

/**
 * Creates a Zod adapter for ValidationSchema interface.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { zodAdapter } from '@kysera/repository';
 *
 * const UserSchema = z.object({
 *   name: z.string(),
 *   email: z.string().email(),
 * });
 *
 * const validator = zodAdapter(UserSchema);
 * const user = validator.parse({ name: 'John', email: 'john@example.com' });
 * ```
 */
/**
 * Zod-compatible schema interface.
 * Uses PropertyKey to match Zod's actual types (includes symbol).
 * Note: partial() method typing is relaxed to accommodate Zod's behavior
 * where partial schemas have all fields as optional.
 */
interface ZodLikeSchema<T> {
  parse(data: unknown): T
  safeParse(data: unknown): {
    success: boolean
    data?: T
    error?: {
      message: string
      issues: readonly { code: string; message: string; path: PropertyKey[] }[]
    }
  }
  // Note: Zod's partial() returns schema with optional fields, we accept any schema
  partial?(): ZodLikeSchema<unknown>
}

/**
 * Filters out symbols from path array (Zod uses PropertyKey which includes symbol).
 * @internal
 */
function filterSymbolsFromPath(path: readonly PropertyKey[]): (string | number)[] {
  return path.filter((p): p is string | number => typeof p !== 'symbol')
}

export function zodAdapter<T>(schema: ZodLikeSchema<T>): ValidationSchema<T> {
  const adapter: ValidationSchema<T> = {
    parse(data: unknown): T {
      return schema.parse(data)
    },

    safeParse(data: unknown): ValidationResult<T> {
      const result = schema.safeParse(data)
      if (result.success) {
        return { success: true, data: result.data as T }
      }
      return {
        success: false,
        error: {
          message: result.error?.message ?? 'Validation failed',
          issues: result.error?.issues.map(i => ({
            code: i.code,
            message: i.message,
            path: filterSymbolsFromPath(i.path)
          }))
        }
      }
    }
  }

  // Add partial support if schema has it
  if (schema.partial) {
    adapter.partial = (): ValidationSchema<Partial<T>> => {
      // Cast is safe: Zod's partial() produces schema with same shape but optional fields
      return zodAdapter(schema.partial!()) as unknown as ValidationSchema<Partial<T>>
    }
  }

  return adapter
}

/**
 * Type for Valibot schema (structural typing for optional dependency)
 */
interface ValibotSchema<T> {
  _types?: { output: T }
}

/**
 * Type for Valibot parse result
 */
interface ValibotResult<T> {
  success: boolean
  output?: T
  issues?: {
    type: string
    message: string
    path?: { key: string | number }[]
  }[]
}

/**
 * Creates a Valibot adapter for ValidationSchema interface.
 *
 * @example
 * ```typescript
 * import * as v from 'valibot';
 * import { valibotAdapter } from '@kysera/repository';
 *
 * const UserSchema = v.object({
 *   name: v.string(),
 *   email: v.string([v.email()]),
 * });
 *
 * const validator = valibotAdapter(UserSchema);
 * const user = validator.parse({ name: 'John', email: 'john@example.com' });
 * ```
 *
 * @param schema - Valibot schema
 * @param valibot - Valibot module (v.parse, v.safeParse, v.partial)
 */
export function valibotAdapter<T>(
  schema: ValibotSchema<T>,
  valibot: {
    parse: (schema: ValibotSchema<T>, data: unknown) => T
    safeParse: (schema: ValibotSchema<T>, data: unknown) => ValibotResult<T>
    partial?: (schema: ValibotSchema<T>) => ValibotSchema<Partial<T>>
  }
): ValidationSchema<T> {
  const adapter: ValidationSchema<T> = {
    parse(data: unknown): T {
      return valibot.parse(schema, data)
    },

    safeParse(data: unknown): ValidationResult<T> {
      const result = valibot.safeParse(schema, data)
      if (result.success) {
        return { success: true, data: result.output as T }
      }
      return {
        success: false,
        error: {
          message: 'Validation failed',
          issues: result.issues?.map(i => ({
            code: i.type,
            message: i.message,
            path: i.path?.map(p => p.key) ?? []
          }))
        }
      }
    }
  }

  // Add partial support if valibot has it
  if (valibot.partial) {
    const partialFn = valibot.partial
    adapter.partial = (): ValidationSchema<Partial<T>> => {
      const partialSchema = partialFn(schema)
      // Cast is safe: Valibot's partial() produces schema with same shape but optional fields
      return valibotAdapter(
        partialSchema as unknown as ValibotSchema<Partial<T>>,
        valibot as unknown as {
          parse: (schema: ValibotSchema<Partial<T>>, data: unknown) => Partial<T>
          safeParse: (schema: ValibotSchema<Partial<T>>, data: unknown) => ValibotResult<Partial<T>>
          partial?: (schema: ValibotSchema<Partial<T>>) => ValibotSchema<Partial<Partial<T>>>
        }
      )
    }
  }

  return adapter
}

/**
 * Type for TypeBox schema (structural typing for optional dependency)
 */
interface TypeBoxSchema {
  type?: string
  properties?: Record<string, unknown>
}

/**
 * Creates a TypeBox adapter for ValidationSchema interface.
 *
 * @example
 * ```typescript
 * import { Type } from '@sinclair/typebox';
 * import { Value } from '@sinclair/typebox/value';
 * import { typeboxAdapter } from '@kysera/repository';
 *
 * const UserSchema = Type.Object({
 *   name: Type.String(),
 *   email: Type.String({ format: 'email' }),
 * });
 *
 * const validator = typeboxAdapter(UserSchema, Value);
 * const user = validator.parse({ name: 'John', email: 'john@example.com' });
 * ```
 *
 * @param schema - TypeBox schema (TSchema)
 * @param Value - TypeBox Value module
 */
export function typeboxAdapter<T>(
  schema: TypeBoxSchema,
  Value: {
    Check(schema: TypeBoxSchema, data: unknown): boolean
    Parse(schema: TypeBoxSchema, data: unknown): T
    Errors(schema: TypeBoxSchema, data: unknown): Iterable<{ message: string; path: string }>
  }
): ValidationSchema<T> {
  return {
    parse(data: unknown): T {
      if (!Value.Check(schema, data)) {
        const errors = [...Value.Errors(schema, data)]
        const firstError = errors[0]
        const error = new Error(firstError?.message ?? 'Validation failed') as Error & {
          issues?: ValidationIssue[]
        }
        error.issues = errors.map(e => ({
          code: 'type_error',
          message: e.message,
          path: e.path
            .split('/')
            .filter(Boolean)
            .map(p => (isNaN(Number(p)) ? p : Number(p)))
        }))
        throw error
      }
      return Value.Parse(schema, data)
    },

    safeParse(data: unknown): ValidationResult<T> {
      if (Value.Check(schema, data)) {
        return { success: true, data: Value.Parse(schema, data) }
      }
      const errors = [...Value.Errors(schema, data)]
      return {
        success: false,
        error: {
          message: errors[0]?.message ?? 'Validation failed',
          issues: errors.map(e => ({
            code: 'type_error',
            message: e.message,
            path: e.path
              .split('/')
              .filter(Boolean)
              .map(p => (isNaN(Number(p)) ? p : Number(p)))
          }))
        }
      }
    }
  }
}

/**
 * Creates a native (passthrough) adapter with no runtime validation.
 * Use this when you trust your data sources and want zero validation overhead.
 *
 * @example
 * ```typescript
 * import { nativeAdapter } from '@kysera/repository';
 *
 * interface User {
 *   name: string;
 *   email: string;
 * }
 *
 * const validator = nativeAdapter<User>();
 * const user = validator.parse({ name: 'John', email: 'john@example.com' });
 * // Type is User, but no runtime validation performed
 * ```
 */
export function nativeAdapter<T>(): ValidationSchema<T> {
  return {
    parse(data: unknown): T {
      return data as T
    },

    safeParse(data: unknown): ValidationResult<T> {
      return { success: true, data: data as T }
    },

    partial(): ValidationSchema<Partial<T>> {
      return nativeAdapter<Partial<T>>()
    }
  }
}

/**
 * Creates a custom validation adapter from a simple validate function.
 *
 * @example
 * ```typescript
 * import { customAdapter } from '@kysera/repository';
 *
 * const isPositiveNumber = customAdapter<number>((data) => {
 *   if (typeof data !== 'number' || data <= 0) {
 *     throw new Error('Must be a positive number');
 *   }
 *   return data;
 * });
 *
 * const num = isPositiveNumber.parse(42); // 42
 * isPositiveNumber.parse(-1); // throws Error
 * ```
 *
 * @param validateFn - Function that validates and returns data, or throws on error
 */
export function customAdapter<T>(validateFn: (data: unknown) => T): ValidationSchema<T> {
  return {
    parse(data: unknown): T {
      return validateFn(data)
    },

    safeParse(data: unknown): ValidationResult<T> {
      try {
        return { success: true, data: validateFn(data) }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        return {
          success: false,
          error: {
            message: error.message
          }
        }
      }
    }
  }
}

/**
 * Check if a value is a ValidationSchema.
 */
export function isValidationSchema(value: unknown): value is ValidationSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    'parse' in value &&
    typeof (value as ValidationSchema).parse === 'function' &&
    'safeParse' in value &&
    typeof (value as ValidationSchema).safeParse === 'function'
  )
}

/**
 * Normalize any schema-like object to ValidationSchema.
 * Automatically detects Zod schemas and wraps them.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { normalizeSchema } from '@kysera/repository';
 *
 * // Works with Zod schemas
 * const zodSchema = z.object({ name: z.string() });
 * const validator1 = normalizeSchema(zodSchema);
 *
 * // Works with ValidationSchema
 * const customValidator = nativeAdapter<{ name: string }>();
 * const validator2 = normalizeSchema(customValidator);
 * ```
 */
export function normalizeSchema<T>(
  schema: ValidationSchema<T> | ZodLikeSchema<T>
): ValidationSchema<T> {
  // Already a ValidationSchema with proper structure
  if (isValidationSchema(schema)) {
    return schema
  }

  // Looks like Zod or similar - wrap it
  return zodAdapter(schema)
}
