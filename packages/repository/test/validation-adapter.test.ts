/**
 * Tests for validation adapters
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  zodAdapter,
  valibotAdapter,
  typeboxAdapter,
  nativeAdapter,
  customAdapter,
  isValidationSchema,
  normalizeSchema
} from '../src/validation-adapter.js'

describe('ValidationSchema Interface', () => {
  describe('zodAdapter', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().min(0),
      email: z.string().email().optional()
    })
    const adapter = zodAdapter(schema)

    describe('parse', () => {
      it('should parse valid data', () => {
        const result = adapter.parse({ name: 'John', age: 30 })
        expect(result).toEqual({ name: 'John', age: 30 })
      })

      it('should parse data with optional fields', () => {
        const result = adapter.parse({ name: 'John', age: 30, email: 'john@example.com' })
        expect(result).toEqual({ name: 'John', age: 30, email: 'john@example.com' })
      })

      it('should throw on invalid data', () => {
        expect(() => adapter.parse({ name: 123, age: 30 })).toThrow()
      })

      it('should throw on missing required fields', () => {
        expect(() => adapter.parse({ name: 'John' })).toThrow()
      })

      it('should throw on constraint violations', () => {
        expect(() => adapter.parse({ name: 'John', age: -1 })).toThrow()
        expect(() => adapter.parse({ name: 'John', age: 30, email: 'invalid' })).toThrow()
      })
    })

    describe('safeParse', () => {
      it('should return success with data for valid input', () => {
        const result = adapter.safeParse({ name: 'John', age: 30 })
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data).toEqual({ name: 'John', age: 30 })
        }
      })

      it('should return failure with error for invalid input', () => {
        const result = adapter.safeParse({ name: 123, age: 30 })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.message).toBeDefined()
          expect(result.error.issues).toBeDefined()
          expect(Array.isArray(result.error.issues)).toBe(true)
        }
      })

      it('should include path information in errors', () => {
        const result = adapter.safeParse({ name: 123, age: 30 })
        expect(result.success).toBe(false)
        if (!result.success && result.error.issues) {
          const issue = result.error.issues[0]
          expect(issue).toBeDefined()
          expect(issue?.path).toContain('name')
        }
      })
    })

    describe('partial', () => {
      it('should create a partial schema', () => {
        expect(adapter.partial).toBeDefined()
        const partialAdapter = adapter.partial!()

        // All fields should be optional
        const result = partialAdapter.safeParse({ name: 'John' })
        expect(result.success).toBe(true)

        // Empty object should be valid
        const emptyResult = partialAdapter.safeParse({})
        expect(emptyResult.success).toBe(true)
      })
    })
  })

  describe('valibotAdapter', () => {
    // Mock Valibot module
    const mockValibotModule: any = {
      parse: (_schema: any, data: unknown): any => {
        const obj = data as { name?: string; age?: number }
        if (typeof obj.name !== 'string') throw new Error('name must be a string')
        if (typeof obj.age !== 'number') throw new Error('age must be a number')
        return obj as { name: string; age: number }
      },
      safeParse: (_schema: any, data: unknown): any => {
        try {
          const obj = data as { name?: string; age?: number }
          if (typeof obj.name !== 'string') throw new Error('name must be a string')
          if (typeof obj.age !== 'number') throw new Error('age must be a number')
          return { success: true, output: obj as { name: string; age: number } }
        } catch (err) {
          return {
            success: false,
            issues: [
              { type: 'custom', message: err instanceof Error ? err.message : 'Validation failed' }
            ]
          }
        }
      }
    }

    const mockSchema: any = {
      _types: { output: {} }
    }

    const adapter = valibotAdapter(mockSchema, mockValibotModule)

    it('should parse valid data', () => {
      const result = adapter.parse({ name: 'John', age: 30 })
      expect(result).toEqual({ name: 'John', age: 30 })
    })

    it('should throw on invalid data', () => {
      expect(() => adapter.parse({ name: 123, age: 30 })).toThrow()
    })

    it('should safeParse valid data', () => {
      const result = adapter.safeParse({ name: 'John', age: 30 })
      expect(result.success).toBe(true)
    })

    it('should safeParse invalid data with error', () => {
      const result = adapter.safeParse({ name: 123, age: 30 })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toBe('Validation failed')
      }
    })
  })

  describe('typeboxAdapter', () => {
    // Mock TypeBox Value module
    const mockValue = {
      Check: (_schema: unknown, data: unknown): boolean => {
        const obj = data as { name?: unknown; age?: unknown }
        return typeof obj.name === 'string' && typeof obj.age === 'number'
      },
      Parse: <T>(_schema: unknown, data: unknown): T => {
        return data as T
      },
      Errors: function* (_schema: unknown, data: unknown) {
        const obj = data as { name?: unknown; age?: unknown }
        if (typeof obj.name !== 'string') {
          yield { message: 'Expected string', path: '/name' }
        }
        if (typeof obj.age !== 'number') {
          yield { message: 'Expected number', path: '/age' }
        }
      }
    }

    const mockSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' }
      },
      required: ['name', 'age']
    }

    const adapter = typeboxAdapter<{ name: string; age: number }>(mockSchema, mockValue)

    it('should parse valid data', () => {
      const result = adapter.parse({ name: 'John', age: 30 })
      expect(result).toEqual({ name: 'John', age: 30 })
    })

    it('should throw on invalid data', () => {
      expect(() => adapter.parse({ name: 123, age: 30 })).toThrow('Expected string')
    })

    it('should safeParse valid data', () => {
      const result = adapter.safeParse({ name: 'John', age: 30 })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({ name: 'John', age: 30 })
      }
    })

    it('should safeParse invalid data with error', () => {
      const result = adapter.safeParse({ name: 123, age: 30 })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toBe('Expected string')
        expect(result.error.issues).toBeDefined()
        expect(result.error.issues?.[0]?.path).toContain('name')
      }
    })
  })

  describe('nativeAdapter', () => {
    interface User {
      name: string
      age: number
    }
    const adapter = nativeAdapter<User>()

    it('should pass through any data (no validation)', () => {
      const data = { name: 'John', age: 30 }
      const result = adapter.parse(data)
      expect(result).toEqual(data)
    })

    it('should pass through invalid data without throwing', () => {
      const data = { invalid: 'data' }
      // Type assertion is for testing purposes - in real code TypeScript would catch this
      const result = adapter.parse(data as unknown)
      expect(result).toEqual(data)
    })

    it('should always return success in safeParse', () => {
      const result = adapter.safeParse({ anything: 'goes' })
      expect(result.success).toBe(true)
    })

    it('should support partial', () => {
      if (adapter.partial) {
        const partialAdapter = adapter.partial()
        const result = partialAdapter.safeParse({})
        expect(result.success).toBe(true)
      }
    })
  })

  describe('customAdapter', () => {
    it('should create adapter from validate function', () => {
      const isPositive = customAdapter<number>(data => {
        if (typeof data !== 'number' || data <= 0) {
          throw new Error('Must be a positive number')
        }
        return data
      })

      expect(isPositive.parse(42)).toBe(42)
      expect(() => isPositive.parse(-1)).toThrow('Must be a positive number')
      expect(() => isPositive.parse('string')).toThrow('Must be a positive number')
    })

    it('should work with safeParse', () => {
      const isString = customAdapter<string>(data => {
        if (typeof data !== 'string') {
          throw new Error('Must be a string')
        }
        return data
      })

      const validResult = isString.safeParse('hello')
      expect(validResult.success).toBe(true)
      if (validResult.success) {
        expect(validResult.data).toBe('hello')
      }

      const invalidResult = isString.safeParse(123)
      expect(invalidResult.success).toBe(false)
      if (!invalidResult.success) {
        expect(invalidResult.error.message).toBe('Must be a string')
      }
    })

    it('should handle non-Error throws', () => {
      const throwsString = customAdapter<never>(() => {
        throw 'plain string error'
      })

      const result = throwsString.safeParse({})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toBe('plain string error')
      }
    })
  })
})

describe('isValidationSchema', () => {
  it('should return true for zodAdapter', () => {
    const adapter = zodAdapter(z.string())
    expect(isValidationSchema(adapter)).toBe(true)
  })

  it('should return true for nativeAdapter', () => {
    const adapter = nativeAdapter()
    expect(isValidationSchema(adapter)).toBe(true)
  })

  it('should return true for customAdapter', () => {
    const adapter = customAdapter(x => x)
    expect(isValidationSchema(adapter)).toBe(true)
  })

  it('should return false for plain objects', () => {
    expect(isValidationSchema({})).toBe(false)
    expect(isValidationSchema({ parse: 'not a function' })).toBe(false)
  })

  it('should return false for primitives', () => {
    expect(isValidationSchema(null)).toBe(false)
    expect(isValidationSchema(undefined)).toBe(false)
    expect(isValidationSchema(42)).toBe(false)
    expect(isValidationSchema('string')).toBe(false)
  })
})

describe('normalizeSchema', () => {
  it('should pass through ValidationSchema unchanged', () => {
    const adapter = nativeAdapter<{ name: string }>()
    const normalized = normalizeSchema(adapter)
    expect(normalized).toBe(adapter)
  })

  it('should wrap Zod-like schemas with zodAdapter', () => {
    const zodSchema = z.object({ name: z.string() })
    const normalized = normalizeSchema(zodSchema)

    expect(isValidationSchema(normalized)).toBe(true)
    expect(normalized.parse({ name: 'John' })).toEqual({ name: 'John' })
    expect(() => normalized.parse({ name: 123 })).toThrow()
  })
})

describe('Integration with Repository patterns', () => {
  describe('Entity validation', () => {
    interface User {
      id: number
      name: string
      email: string
      createdAt: Date
    }

    const UserSchema = z.object({
      id: z.number(),
      name: z.string().min(1),
      email: z.string().email(),
      createdAt: z.date()
    })

    const CreateUserSchema = z.object({
      name: z.string().min(1),
      email: z.string().email()
    })

    const UpdateUserSchema = z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional()
    })

    it('should validate entity with zodAdapter', () => {
      const entityValidator = zodAdapter(UserSchema)

      const validUser = {
        id: 1,
        name: 'John',
        email: 'john@example.com',
        createdAt: new Date()
      }

      expect(entityValidator.parse(validUser)).toEqual(validUser)
    })

    it('should validate create input with zodAdapter', () => {
      const createValidator = zodAdapter(CreateUserSchema)

      const result = createValidator.safeParse({ name: 'John', email: 'john@example.com' })
      expect(result.success).toBe(true)

      const invalidResult = createValidator.safeParse({ name: '', email: 'invalid' })
      expect(invalidResult.success).toBe(false)
    })

    it('should validate update input with partial schema', () => {
      const updateValidator = zodAdapter(UpdateUserSchema)

      // Only updating name
      expect(updateValidator.safeParse({ name: 'Jane' }).success).toBe(true)

      // Only updating email
      expect(updateValidator.safeParse({ email: 'jane@example.com' }).success).toBe(true)

      // Empty update (all optional)
      expect(updateValidator.safeParse({}).success).toBe(true)
    })

    it('should work with nativeAdapter for no-validation scenarios', () => {
      const entityValidator = nativeAdapter<User>()
      const createValidator = nativeAdapter<{ name: string; email: string }>()

      // No validation - any data passes
      const entity = entityValidator.parse({
        id: 1,
        name: 'John',
        email: 'john@example.com',
        createdAt: new Date()
      })
      expect(entity).toBeDefined()

      const createInput = createValidator.parse({ name: 'Jane', email: 'jane@example.com' })
      expect(createInput).toBeDefined()
    })
  })

  describe('Mixed validation strategies', () => {
    it('should allow different validators for different operations', () => {
      // Entity uses Zod for strict validation
      const entityValidator = zodAdapter(z.object({ id: z.number(), name: z.string() }))

      // Create uses native (no validation - trusted internal source)
      const createValidator = nativeAdapter<{ name: string }>()

      // Update uses custom validation
      const updateValidator = customAdapter<{ name?: string }>(data => {
        const obj = data as { name?: unknown }
        if (obj.name !== undefined && typeof obj.name !== 'string') {
          throw new Error('name must be a string if provided')
        }
        return obj as { name?: string }
      })

      // All validators conform to ValidationSchema interface
      expect(isValidationSchema(entityValidator)).toBe(true)
      expect(isValidationSchema(createValidator)).toBe(true)
      expect(isValidationSchema(updateValidator)).toBe(true)

      // Each works as expected
      expect(entityValidator.safeParse({ id: 1, name: 'John' }).success).toBe(true)
      expect(createValidator.safeParse({ name: 'Jane' }).success).toBe(true)
      expect(updateValidator.safeParse({ name: 'Updated' }).success).toBe(true)
    })
  })
})

describe('Error handling edge cases', () => {
  it('should handle deeply nested validation errors', () => {
    const schema = z.object({
      user: z.object({
        profile: z.object({
          address: z.object({
            street: z.string(),
            city: z.string()
          })
        })
      })
    })

    const adapter = zodAdapter(schema)
    const result = adapter.safeParse({
      user: {
        profile: {
          address: {
            street: 123, // Invalid
            city: 'NYC'
          }
        }
      }
    })

    expect(result.success).toBe(false)
    if (!result.success && result.error.issues) {
      const issue = result.error.issues[0]
      expect(issue?.path).toContain('user')
      expect(issue?.path).toContain('profile')
      expect(issue?.path).toContain('address')
      expect(issue?.path).toContain('street')
    }
  })

  it('should handle array validation errors', () => {
    const schema = z.object({
      items: z.array(z.object({ id: z.number(), name: z.string() }))
    })

    const adapter = zodAdapter(schema)
    const result = adapter.safeParse({
      items: [
        { id: 1, name: 'Valid' },
        { id: 'invalid', name: 'Item' } // Invalid id
      ]
    })

    expect(result.success).toBe(false)
  })

  it('should handle union type validation', () => {
    const schema = z.union([
      z.object({ type: z.literal('a'), value: z.string() }),
      z.object({ type: z.literal('b'), value: z.number() })
    ])

    const adapter = zodAdapter(schema)

    expect(adapter.safeParse({ type: 'a', value: 'string' }).success).toBe(true)
    expect(adapter.safeParse({ type: 'b', value: 42 }).success).toBe(true)
    expect(adapter.safeParse({ type: 'c', value: 'anything' }).success).toBe(false)
  })
})
