import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getValidationMode, shouldValidate } from '../src/validation.js';

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
