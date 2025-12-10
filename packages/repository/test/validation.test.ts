import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import type { KyseraLogger } from '@kysera/core';
import {
  getValidationMode,
  shouldValidate,
  safeParse,
  createValidator,
} from '../src/validation.js';
import {
  zodAdapter,
  nativeAdapter,
  customAdapter,
} from '../src/validation-adapter.js';

describe('Validation Mode', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all validation-related environment variables
    delete process.env['KYSERA_VALIDATION_MODE'];
    delete process.env['KYSERA_VALIDATE'];
    delete process.env['VALIDATE_DB_RESULTS'];
    delete process.env['NODE_ENV'];
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe('getValidationMode', () => {
    describe('KYSERA_VALIDATION_MODE (highest priority)', () => {
      it('should return "always" when KYSERA_VALIDATION_MODE=always', () => {
        process.env['KYSERA_VALIDATION_MODE'] = 'always';
        expect(getValidationMode()).toBe('always');
      });

      it('should return "never" when KYSERA_VALIDATION_MODE=never', () => {
        process.env['KYSERA_VALIDATION_MODE'] = 'never';
        expect(getValidationMode()).toBe('never');
      });

      it('should return "development" when KYSERA_VALIDATION_MODE=development', () => {
        process.env['KYSERA_VALIDATION_MODE'] = 'development';
        expect(getValidationMode()).toBe('development');
      });

      it('should return "production" when KYSERA_VALIDATION_MODE=production', () => {
        process.env['KYSERA_VALIDATION_MODE'] = 'production';
        expect(getValidationMode()).toBe('production');
      });

      it('should override other environment variables', () => {
        process.env['KYSERA_VALIDATION_MODE'] = 'always';
        process.env['KYSERA_VALIDATE'] = 'never';
        process.env['VALIDATE_DB_RESULTS'] = 'never';
        process.env['NODE_ENV'] = 'production';

        expect(getValidationMode()).toBe('always');
      });

      it('should ignore invalid values and fallback to next priority', () => {
        process.env['KYSERA_VALIDATION_MODE'] = 'invalid' as any;
        process.env['KYSERA_VALIDATE'] = 'always';

        expect(getValidationMode()).toBe('always');
      });
    });

    describe('KYSERA_VALIDATE (second priority)', () => {
      it('should return "always" when KYSERA_VALIDATE=always', () => {
        process.env['KYSERA_VALIDATE'] = 'always';
        expect(getValidationMode()).toBe('always');
      });

      it('should return "never" when KYSERA_VALIDATE=never', () => {
        process.env['KYSERA_VALIDATE'] = 'never';
        expect(getValidationMode()).toBe('never');
      });

      it('should override VALIDATE_DB_RESULTS and NODE_ENV', () => {
        process.env['KYSERA_VALIDATE'] = 'always';
        process.env['VALIDATE_DB_RESULTS'] = 'never';
        process.env['NODE_ENV'] = 'production';

        expect(getValidationMode()).toBe('always');
      });
    });

    describe('VALIDATE_DB_RESULTS (third priority, legacy)', () => {
      it('should return "always" when VALIDATE_DB_RESULTS=always', () => {
        process.env['VALIDATE_DB_RESULTS'] = 'always';
        expect(getValidationMode()).toBe('always');
      });

      it('should return "never" when VALIDATE_DB_RESULTS=never', () => {
        process.env['VALIDATE_DB_RESULTS'] = 'never';
        expect(getValidationMode()).toBe('never');
      });

      it('should override NODE_ENV', () => {
        process.env['VALIDATE_DB_RESULTS'] = 'always';
        process.env['NODE_ENV'] = 'production';

        expect(getValidationMode()).toBe('always');
      });
    });

    describe('NODE_ENV (lowest priority, default)', () => {
      it('should return "development" when NODE_ENV=development', () => {
        process.env['NODE_ENV'] = 'development';
        expect(getValidationMode()).toBe('development');
      });

      it('should return "production" when NODE_ENV=production', () => {
        process.env['NODE_ENV'] = 'production';
        expect(getValidationMode()).toBe('production');
      });

      it('should return "production" when NODE_ENV is not set', () => {
        expect(getValidationMode()).toBe('production');
      });

      it('should return "production" for unknown NODE_ENV values', () => {
        process.env['NODE_ENV'] = 'test';
        expect(getValidationMode()).toBe('production');
      });
    });
  });

  describe('shouldValidate', () => {
    it('should return true when mode is "always"', () => {
      expect(shouldValidate({ mode: 'always' })).toBe(true);
    });

    it('should return false when mode is "never"', () => {
      expect(shouldValidate({ mode: 'never' })).toBe(false);
    });

    it('should return true when mode is "development" and NODE_ENV=development', () => {
      process.env['NODE_ENV'] = 'development';
      expect(shouldValidate({ mode: 'development' })).toBe(true);
    });

    it('should return false when mode is "development" and NODE_ENV=production', () => {
      process.env['NODE_ENV'] = 'production';
      expect(shouldValidate({ mode: 'development' })).toBe(false);
    });

    it('should return false when mode is "production"', () => {
      expect(shouldValidate({ mode: 'production' })).toBe(false);
    });

    it('should use environment mode when no explicit mode provided', () => {
      process.env['KYSERA_VALIDATION_MODE'] = 'always';
      expect(shouldValidate()).toBe(true);

      process.env['KYSERA_VALIDATION_MODE'] = 'never';
      expect(shouldValidate()).toBe(false);
    });
  });

  describe('Environment variable precedence', () => {
    it('should follow correct precedence order', () => {
      // Test 1: All set, should use KYSERA_VALIDATION_MODE
      process.env['KYSERA_VALIDATION_MODE'] = 'never';
      process.env['KYSERA_VALIDATE'] = 'always';
      process.env['VALIDATE_DB_RESULTS'] = 'always';
      process.env['NODE_ENV'] = 'development';
      expect(getValidationMode()).toBe('never');

      // Test 2: KYSERA_VALIDATION_MODE removed, should use KYSERA_VALIDATE
      delete process.env['KYSERA_VALIDATION_MODE'];
      expect(getValidationMode()).toBe('always');

      // Test 3: KYSERA_VALIDATE removed, should use VALIDATE_DB_RESULTS
      delete process.env['KYSERA_VALIDATE'];
      expect(getValidationMode()).toBe('always');

      // Test 4: VALIDATE_DB_RESULTS removed, should use NODE_ENV
      delete process.env['VALIDATE_DB_RESULTS'];
      expect(getValidationMode()).toBe('development');

      // Test 5: NODE_ENV removed, should default to production
      delete process.env['NODE_ENV'];
      expect(getValidationMode()).toBe('production');
    });
  });

  describe('Real-world scenarios', () => {
    it('should enable validation in development by default', () => {
      process.env['NODE_ENV'] = 'development';
      expect(shouldValidate()).toBe(true);
    });

    it('should disable validation in production by default', () => {
      process.env['NODE_ENV'] = 'production';
      expect(shouldValidate()).toBe(false);
    });

    it('should allow forcing validation on in production', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['KYSERA_VALIDATION_MODE'] = 'always';
      expect(shouldValidate()).toBe(true);
    });

    it('should allow forcing validation off in development', () => {
      process.env['NODE_ENV'] = 'development';
      process.env['KYSERA_VALIDATION_MODE'] = 'never';
      expect(shouldValidate()).toBe(false);
    });

    it('should support legacy VALIDATE_DB_RESULTS environment variable', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['VALIDATE_DB_RESULTS'] = 'always';
      expect(shouldValidate()).toBe(true);
    });
  });
});

describe('safeParse', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['NODE_ENV'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('Basic functionality', () => {
    const UserSchema = z.object({
      name: z.string().min(1),
      age: z.number().min(0),
      email: z.string().email().optional(),
    });
    const schema = zodAdapter(UserSchema);

    it('should return parsed data for valid input', () => {
      const validData = { name: 'John', age: 30 };
      const result = safeParse(schema, validData);

      expect(result).toEqual({ name: 'John', age: 30 });
    });

    it('should return parsed data with optional fields', () => {
      const validData = { name: 'John', age: 30, email: 'john@example.com' };
      const result = safeParse(schema, validData);

      expect(result).toEqual({ name: 'John', age: 30, email: 'john@example.com' });
    });

    it('should return null for invalid input by default', () => {
      const invalidData = { name: '', age: 30 }; // name is empty (min 1)
      const result = safeParse(schema, invalidData);

      expect(result).toBeNull();
    });

    it('should return null for missing required fields', () => {
      const invalidData = { name: 'John' }; // age is missing
      const result = safeParse(schema, invalidData);

      expect(result).toBeNull();
    });

    it('should return null for type mismatches', () => {
      const invalidData = { name: 'John', age: 'thirty' }; // age should be number
      const result = safeParse(schema, invalidData);

      expect(result).toBeNull();
    });

    it('should return null for constraint violations', () => {
      const invalidData1 = { name: 'John', age: -1 }; // age < 0
      const result1 = safeParse(schema, invalidData1);
      expect(result1).toBeNull();

      const invalidData2 = { name: 'John', age: 30, email: 'invalid-email' };
      const result2 = safeParse(schema, invalidData2);
      expect(result2).toBeNull();
    });
  });

  describe('throwOnError option', () => {
    const schema = zodAdapter(z.object({ name: z.string() }));

    it('should throw error when throwOnError is true and validation fails', () => {
      const invalidData = { name: 123 };

      expect(() => {
        safeParse(schema, invalidData, { throwOnError: true });
      }).toThrow();
    });

    it('should not throw when throwOnError is false and validation fails', () => {
      const invalidData = { name: 123 };

      expect(() => {
        const result = safeParse(schema, invalidData, { throwOnError: false });
        expect(result).toBeNull();
      }).not.toThrow();
    });

    it('should not throw by default when validation fails', () => {
      const invalidData = { name: 123 };

      expect(() => {
        const result = safeParse(schema, invalidData);
        expect(result).toBeNull();
      }).not.toThrow();
    });

    it('should return data when throwOnError is true and validation succeeds', () => {
      const validData = { name: 'John' };
      const result = safeParse(schema, validData, { throwOnError: true });

      expect(result).toEqual({ name: 'John' });
    });
  });

  describe('logErrors option', () => {
    const schema = zodAdapter(z.object({ name: z.string() }));

    it('should log errors when logErrors is true', () => {
      const mockLogger: KyseraLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const invalidData = { name: 123 };
      const result = safeParse(schema, invalidData, { logErrors: true, logger: mockLogger });

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith('Validation error:', expect.any(Object));
    });

    it('should not log errors when logErrors is false', () => {
      const mockLogger: KyseraLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const invalidData = { name: 123 };
      const result = safeParse(schema, invalidData, { logErrors: false, logger: mockLogger });

      expect(result).toBeNull();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should not log errors by default', () => {
      const mockLogger: KyseraLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const invalidData = { name: 123 };
      const result = safeParse(schema, invalidData, { logger: mockLogger });

      expect(result).toBeNull();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should use custom logger when provided', () => {
      const customLogger: KyseraLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const invalidData = { name: 123 };
      safeParse(schema, invalidData, { logErrors: true, logger: customLogger });

      expect(customLogger.error).toHaveBeenCalledTimes(1);
    });

    it('should not throw when both logErrors and throwOnError are true', () => {
      const mockLogger: KyseraLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const invalidData = { name: 123 };

      expect(() => {
        safeParse(schema, invalidData, { logErrors: true, throwOnError: true, logger: mockLogger });
      }).toThrow();

      // Should still log before throwing
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('Different validation libraries', () => {
    it('should work with zodAdapter', () => {
      const schema = zodAdapter(z.object({ value: z.number() }));

      expect(safeParse(schema, { value: 42 })).toEqual({ value: 42 });
      expect(safeParse(schema, { value: 'not a number' })).toBeNull();
    });

    it('should work with nativeAdapter (no validation)', () => {
      const schema = nativeAdapter<{ value: number }>();

      // Native adapter passes everything through
      expect(safeParse(schema, { value: 42 })).toEqual({ value: 42 });
      expect(safeParse(schema, { value: 'anything' })).toEqual({ value: 'anything' });
      expect(safeParse(schema, {})).toEqual({});
    });

    it('should work with customAdapter', () => {
      const schema = customAdapter<number>((data) => {
        if (typeof data !== 'number' || data <= 0) {
          throw new Error('Must be a positive number');
        }
        return data;
      });

      expect(safeParse(schema, 42)).toBe(42);
      expect(safeParse(schema, -1)).toBeNull();
      expect(safeParse(schema, 'string')).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle null data', () => {
      const schema = zodAdapter(z.object({ name: z.string() }));
      const result = safeParse(schema, null);

      expect(result).toBeNull();
    });

    it('should handle undefined data', () => {
      const schema = zodAdapter(z.object({ name: z.string() }));
      const result = safeParse(schema, undefined);

      expect(result).toBeNull();
    });

    it('should handle arrays', () => {
      const schema = zodAdapter(z.array(z.number()));

      expect(safeParse(schema, [1, 2, 3])).toEqual([1, 2, 3]);
      expect(safeParse(schema, [1, 'two', 3])).toBeNull();
    });

    it('should handle nested objects', () => {
      const schema = zodAdapter(
        z.object({
          user: z.object({
            profile: z.object({
              name: z.string(),
              age: z.number(),
            }),
          }),
        })
      );

      const validData = {
        user: { profile: { name: 'John', age: 30 } },
      };
      expect(safeParse(schema, validData)).toEqual(validData);

      const invalidData = {
        user: { profile: { name: 'John', age: 'thirty' } },
      };
      expect(safeParse(schema, invalidData)).toBeNull();
    });

    it('should handle schemas with transformations', () => {
      const schema = zodAdapter(
        z.object({
          timestamp: z.string().transform((str) => new Date(str)),
        })
      );

      const result = safeParse(schema, { timestamp: '2025-12-10T00:00:00.000Z' });
      expect(result).toHaveProperty('timestamp');
      expect(result?.timestamp).toBeInstanceOf(Date);
    });
  });
});

describe('createValidator', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['NODE_ENV'];
    delete process.env['KYSERA_VALIDATION_MODE'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('validate() method', () => {
    const UserSchema = z.object({
      name: z.string().min(1),
      age: z.number().min(0),
    });
    const schema = zodAdapter(UserSchema);
    const validator = createValidator(schema);

    it('should validate and return data for valid input', () => {
      const validData = { name: 'John', age: 30 };
      const result = validator.validate(validData);

      expect(result).toEqual({ name: 'John', age: 30 });
    });

    it('should throw error for invalid input', () => {
      const invalidData = { name: '', age: 30 };

      expect(() => validator.validate(invalidData)).toThrow();
    });

    it('should throw error for missing required fields', () => {
      const invalidData = { name: 'John' };

      expect(() => validator.validate(invalidData)).toThrow();
    });

    it('should throw error for type mismatches', () => {
      const invalidData = { name: 'John', age: 'thirty' };

      expect(() => validator.validate(invalidData)).toThrow();
    });

    it('should throw error for constraint violations', () => {
      const invalidData = { name: 'John', age: -1 };

      expect(() => validator.validate(invalidData)).toThrow();
    });
  });

  describe('validateSafe() method', () => {
    const UserSchema = z.object({
      name: z.string().min(1),
      age: z.number().min(0),
    });
    const schema = zodAdapter(UserSchema);
    const validator = createValidator(schema);

    it('should return data for valid input', () => {
      const validData = { name: 'John', age: 30 };
      const result = validator.validateSafe(validData);

      expect(result).toEqual({ name: 'John', age: 30 });
    });

    it('should return null for invalid input', () => {
      const invalidData = { name: '', age: 30 };
      const result = validator.validateSafe(invalidData);

      expect(result).toBeNull();
    });

    it('should not throw for invalid input', () => {
      const invalidData = { name: 'John', age: -1 };

      expect(() => validator.validateSafe(invalidData)).not.toThrow();
    });

    it('should return null for missing required fields', () => {
      const invalidData = { name: 'John' };
      const result = validator.validateSafe(invalidData);

      expect(result).toBeNull();
    });

    it('should return null for type mismatches', () => {
      const invalidData = { name: 123, age: 30 };
      const result = validator.validateSafe(invalidData);

      expect(result).toBeNull();
    });
  });

  describe('isValid() method', () => {
    const UserSchema = z.object({
      name: z.string().min(1),
      age: z.number().min(0),
    });
    const schema = zodAdapter(UserSchema);
    const validator = createValidator(schema);

    it('should return true for valid input', () => {
      const validData = { name: 'John', age: 30 };

      expect(validator.isValid(validData)).toBe(true);
    });

    it('should return false for invalid input', () => {
      const invalidData = { name: '', age: 30 };

      expect(validator.isValid(invalidData)).toBe(false);
    });

    it('should return false for missing required fields', () => {
      const invalidData = { name: 'John' };

      expect(validator.isValid(invalidData)).toBe(false);
    });

    it('should return false for type mismatches', () => {
      const invalidData = { name: 123, age: 30 };

      expect(validator.isValid(invalidData)).toBe(false);
    });

    it('should return false for constraint violations', () => {
      const invalidData = { name: 'John', age: -1 };

      expect(validator.isValid(invalidData)).toBe(false);
    });

    it('should not throw for invalid input', () => {
      const invalidData = { name: '', age: 30 };

      expect(() => validator.isValid(invalidData)).not.toThrow();
    });
  });

  describe('validateConditional() method', () => {
    const UserSchema = z.object({
      name: z.string().min(1),
      age: z.number().min(0),
    });
    const schema = zodAdapter(UserSchema);

    describe('mode: always', () => {
      it('should always validate regardless of NODE_ENV', () => {
        process.env['NODE_ENV'] = 'production';
        const validator = createValidator(schema, { mode: 'always' });
        const invalidData = { name: '', age: 30 };

        expect(() => validator.validateConditional(invalidData)).toThrow();
      });

      it('should validate valid data', () => {
        const validator = createValidator(schema, { mode: 'always' });
        const validData = { name: 'John', age: 30 };

        expect(validator.validateConditional(validData)).toEqual(validData);
      });
    });

    describe('mode: never', () => {
      it('should never validate regardless of NODE_ENV', () => {
        process.env['NODE_ENV'] = 'development';
        const validator = createValidator(schema, { mode: 'never' });
        const invalidData = { name: '', age: 30 };

        // Should pass through without validation
        expect(validator.validateConditional(invalidData)).toEqual(invalidData);
      });

      it('should pass through valid data without validation', () => {
        const validator = createValidator(schema, { mode: 'never' });
        const validData = { name: 'John', age: 30 };

        expect(validator.validateConditional(validData)).toEqual(validData);
      });

      it('should pass through completely invalid data', () => {
        const validator = createValidator(schema, { mode: 'never' });
        const invalidData = { completely: 'wrong' };

        expect(validator.validateConditional(invalidData)).toEqual(invalidData);
      });
    });

    describe('mode: development', () => {
      it('should validate when NODE_ENV=development', () => {
        process.env['NODE_ENV'] = 'development';
        const validator = createValidator(schema, { mode: 'development' });
        const invalidData = { name: '', age: 30 };

        expect(() => validator.validateConditional(invalidData)).toThrow();
      });

      it('should not validate when NODE_ENV=production', () => {
        process.env['NODE_ENV'] = 'production';
        const validator = createValidator(schema, { mode: 'development' });
        const invalidData = { name: '', age: 30 };

        // Should pass through without validation
        expect(validator.validateConditional(invalidData)).toEqual(invalidData);
      });

      it('should validate valid data in development', () => {
        process.env['NODE_ENV'] = 'development';
        const validator = createValidator(schema, { mode: 'development' });
        const validData = { name: 'John', age: 30 };

        expect(validator.validateConditional(validData)).toEqual(validData);
      });
    });

    describe('mode: production', () => {
      it('should not validate in any environment', () => {
        process.env['NODE_ENV'] = 'production';
        const validator = createValidator(schema, { mode: 'production' });
        const invalidData = { name: '', age: 30 };

        // Should pass through without validation
        expect(validator.validateConditional(invalidData)).toEqual(invalidData);
      });

      it('should not validate even in development', () => {
        process.env['NODE_ENV'] = 'development';
        const validator = createValidator(schema, { mode: 'production' });
        const invalidData = { name: '', age: 30 };

        // Should pass through without validation
        expect(validator.validateConditional(invalidData)).toEqual(invalidData);
      });
    });

    describe('no explicit mode (uses environment)', () => {
      it('should use environment mode when not specified', () => {
        process.env['KYSERA_VALIDATION_MODE'] = 'always';
        const validator = createValidator(schema);
        const invalidData = { name: '', age: 30 };

        expect(() => validator.validateConditional(invalidData)).toThrow();
      });

      it('should default to production mode when no environment vars set', () => {
        const validator = createValidator(schema);
        const invalidData = { name: '', age: 30 };

        // Should pass through without validation (production default)
        expect(validator.validateConditional(invalidData)).toEqual(invalidData);
      });

      it('should validate in development environment by default', () => {
        process.env['NODE_ENV'] = 'development';
        const validator = createValidator(schema);
        const invalidData = { name: '', age: 30 };

        // Should validate because NODE_ENV=development triggers validation by default
        expect(() => validator.validateConditional(invalidData)).toThrow();
      });
    });
  });

  describe('Different validation libraries', () => {
    it('should work with zodAdapter', () => {
      const schema = zodAdapter(z.object({ value: z.number() }));
      const validator = createValidator(schema);

      expect(validator.validate({ value: 42 })).toEqual({ value: 42 });
      expect(() => validator.validate({ value: 'not a number' })).toThrow();
      expect(validator.validateSafe({ value: 42 })).toEqual({ value: 42 });
      expect(validator.validateSafe({ value: 'not a number' })).toBeNull();
      expect(validator.isValid({ value: 42 })).toBe(true);
      expect(validator.isValid({ value: 'not a number' })).toBe(false);
    });

    it('should work with nativeAdapter', () => {
      const schema = nativeAdapter<{ value: number }>();
      const validator = createValidator(schema);

      // Native adapter passes everything through
      expect(validator.validate({ value: 42 })).toEqual({ value: 42 });
      expect(validator.validate({ value: 'anything' })).toEqual({ value: 'anything' });
      expect(validator.validateSafe({ value: 42 })).toEqual({ value: 42 });
      expect(validator.isValid({ value: 42 })).toBe(true);
      expect(validator.isValid({ invalid: 'data' })).toBe(true);
    });

    it('should work with customAdapter', () => {
      const schema = customAdapter<number>((data) => {
        if (typeof data !== 'number' || data <= 0) {
          throw new Error('Must be a positive number');
        }
        return data;
      });
      const validator = createValidator(schema);

      expect(validator.validate(42)).toBe(42);
      expect(() => validator.validate(-1)).toThrow();
      expect(validator.validateSafe(42)).toBe(42);
      expect(validator.validateSafe(-1)).toBeNull();
      expect(validator.isValid(42)).toBe(true);
      expect(validator.isValid(-1)).toBe(false);
    });
  });

  describe('Complex validation scenarios', () => {
    it('should handle nested object validation', () => {
      const schema = zodAdapter(
        z.object({
          user: z.object({
            profile: z.object({
              name: z.string(),
              age: z.number(),
            }),
          }),
        })
      );
      const validator = createValidator(schema);

      const validData = {
        user: { profile: { name: 'John', age: 30 } },
      };
      expect(validator.validate(validData)).toEqual(validData);
      expect(validator.validateSafe(validData)).toEqual(validData);
      expect(validator.isValid(validData)).toBe(true);

      const invalidData = {
        user: { profile: { name: 'John', age: 'thirty' } },
      };
      expect(() => validator.validate(invalidData)).toThrow();
      expect(validator.validateSafe(invalidData)).toBeNull();
      expect(validator.isValid(invalidData)).toBe(false);
    });

    it('should handle array validation', () => {
      const schema = zodAdapter(z.array(z.number()));
      const validator = createValidator(schema);

      expect(validator.validate([1, 2, 3])).toEqual([1, 2, 3]);
      expect(validator.validateSafe([1, 2, 3])).toEqual([1, 2, 3]);
      expect(validator.isValid([1, 2, 3])).toBe(true);

      expect(() => validator.validate([1, 'two', 3])).toThrow();
      expect(validator.validateSafe([1, 'two', 3])).toBeNull();
      expect(validator.isValid([1, 'two', 3])).toBe(false);
    });

    it('should handle optional fields', () => {
      const schema = zodAdapter(
        z.object({
          name: z.string(),
          email: z.string().email().optional(),
        })
      );
      const validator = createValidator(schema);

      expect(validator.validate({ name: 'John' })).toEqual({ name: 'John' });
      expect(validator.validate({ name: 'John', email: 'john@example.com' })).toEqual({
        name: 'John',
        email: 'john@example.com',
      });
      expect(validator.isValid({ name: 'John' })).toBe(true);
      expect(validator.isValid({ name: 'John', email: 'invalid' })).toBe(false);
    });

    it('should handle union types', () => {
      const schema = zodAdapter(
        z.union([
          z.object({ type: z.literal('text'), content: z.string() }),
          z.object({ type: z.literal('number'), value: z.number() }),
        ])
      );
      const validator = createValidator(schema);

      expect(validator.isValid({ type: 'text', content: 'hello' })).toBe(true);
      expect(validator.isValid({ type: 'number', value: 42 })).toBe(true);
      expect(validator.isValid({ type: 'other', data: 'something' })).toBe(false);
    });

    it('should handle transformations', () => {
      const schema = zodAdapter(
        z.object({
          timestamp: z.string().transform((str) => new Date(str)),
        })
      );
      const validator = createValidator(schema);

      const result = validator.validate({ timestamp: '2025-12-10T00:00:00.000Z' });
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Edge cases', () => {
    it('should handle null input', () => {
      const schema = zodAdapter(z.object({ name: z.string() }));
      const validator = createValidator(schema);

      expect(() => validator.validate(null)).toThrow();
      expect(validator.validateSafe(null)).toBeNull();
      expect(validator.isValid(null)).toBe(false);
    });

    it('should handle undefined input', () => {
      const schema = zodAdapter(z.object({ name: z.string() }));
      const validator = createValidator(schema);

      expect(() => validator.validate(undefined)).toThrow();
      expect(validator.validateSafe(undefined)).toBeNull();
      expect(validator.isValid(undefined)).toBe(false);
    });

    it('should handle empty objects', () => {
      const schema = zodAdapter(z.object({ name: z.string() }));
      const validator = createValidator(schema);

      expect(() => validator.validate({})).toThrow();
      expect(validator.validateSafe({})).toBeNull();
      expect(validator.isValid({})).toBe(false);
    });

    it('should handle arrays when expecting objects', () => {
      const schema = zodAdapter(z.object({ name: z.string() }));
      const validator = createValidator(schema);

      expect(() => validator.validate([])).toThrow();
      expect(validator.validateSafe([])).toBeNull();
      expect(validator.isValid([])).toBe(false);
    });

    it('should handle primitives when expecting objects', () => {
      const schema = zodAdapter(z.object({ name: z.string() }));
      const validator = createValidator(schema);

      expect(() => validator.validate('string')).toThrow();
      expect(validator.validateSafe(42)).toBeNull();
      expect(validator.isValid(true)).toBe(false);
    });
  });

  describe('All methods work together', () => {
    const schema = zodAdapter(
      z.object({
        id: z.number(),
        name: z.string().min(1),
        email: z.string().email(),
      })
    );
    const validator = createValidator(schema, { mode: 'always' });

    const validUser = { id: 1, name: 'John', email: 'john@example.com' };
    const invalidUser = { id: 1, name: '', email: 'invalid' };

    it('should consistently handle valid data across all methods', () => {
      expect(validator.validate(validUser)).toEqual(validUser);
      expect(validator.validateSafe(validUser)).toEqual(validUser);
      expect(validator.isValid(validUser)).toBe(true);
      expect(validator.validateConditional(validUser)).toEqual(validUser);
    });

    it('should consistently handle invalid data across all methods', () => {
      expect(() => validator.validate(invalidUser)).toThrow();
      expect(validator.validateSafe(invalidUser)).toBeNull();
      expect(validator.isValid(invalidUser)).toBe(false);
      expect(() => validator.validateConditional(invalidUser)).toThrow();
    });
  });

  describe('Integration with validation options', () => {
    const schema = zodAdapter(z.object({ name: z.string() }));

    it('should respect validateInputs option', () => {
      const validator = createValidator(schema, {
        validateInputs: true,
        mode: 'always',
      });

      expect(validator.isValid({ name: 'John' })).toBe(true);
    });

    it('should respect validateDbResults option', () => {
      const validator = createValidator(schema, {
        validateDbResults: true,
        mode: 'always',
      });

      expect(validator.isValid({ name: 'John' })).toBe(true);
    });

    it('should work with custom logger option', () => {
      const customLogger: KyseraLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const validator = createValidator(schema, {
        mode: 'always',
        logger: customLogger,
      });

      // Logger option is for future use, validator should still work
      expect(validator.isValid({ name: 'John' })).toBe(true);
    });
  });
});
