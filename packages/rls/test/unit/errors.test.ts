import { describe, it, expect } from 'vitest';
import {
  RLSError,
  RLSContextError,
  RLSContextValidationError,
  RLSPolicyViolation,
  RLSSchemaError,
  RLSErrorCodes,
  type RLSErrorCode,
} from '../../src/errors.js';

describe('RLSErrorCodes', () => {
  it('should have all expected error codes', () => {
    expect(RLSErrorCodes.RLS_CONTEXT_MISSING).toBe('RLS_CONTEXT_MISSING');
    expect(RLSErrorCodes.RLS_POLICY_VIOLATION).toBe('RLS_POLICY_VIOLATION');
    expect(RLSErrorCodes.RLS_POLICY_INVALID).toBe('RLS_POLICY_INVALID');
    expect(RLSErrorCodes.RLS_SCHEMA_INVALID).toBe('RLS_SCHEMA_INVALID');
    expect(RLSErrorCodes.RLS_CONTEXT_INVALID).toBe('RLS_CONTEXT_INVALID');
  });

  it('should have unique error codes', () => {
    const codes = Object.values(RLSErrorCodes);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });

  it('should have exactly 5 error codes', () => {
    const codeKeys = Object.keys(RLSErrorCodes);
    expect(codeKeys.length).toBe(5);
  });
});

describe('RLSError', () => {
  it('should extend Error', () => {
    const error = new RLSError('Test error', RLSErrorCodes.RLS_CONTEXT_MISSING);
    expect(error).toBeInstanceOf(Error);
  });

  it('should set correct error name', () => {
    const error = new RLSError('Test error', RLSErrorCodes.RLS_CONTEXT_MISSING);
    expect(error.name).toBe('RLSError');
  });

  it('should store error message', () => {
    const message = 'Test error message';
    const error = new RLSError(message, RLSErrorCodes.RLS_CONTEXT_MISSING);
    expect(error.message).toBe(message);
  });

  it('should store error code', () => {
    const error = new RLSError('Test error', RLSErrorCodes.RLS_POLICY_VIOLATION);
    expect(error.code).toBe(RLSErrorCodes.RLS_POLICY_VIOLATION);
  });

  it('should serialize to JSON', () => {
    const error = new RLSError('Test error', RLSErrorCodes.RLS_CONTEXT_MISSING);
    const json = error.toJSON();

    expect(json).toEqual({
      name: 'RLSError',
      message: 'Test error',
      code: RLSErrorCodes.RLS_CONTEXT_MISSING,
    });
  });

  it('should be throwable', () => {
    expect(() => {
      throw new RLSError('Test error', RLSErrorCodes.RLS_CONTEXT_MISSING);
    }).toThrow(RLSError);
  });

  it('should preserve error code type', () => {
    const error = new RLSError('Test error', RLSErrorCodes.RLS_CONTEXT_MISSING);
    const code: RLSErrorCode = error.code;
    expect(code).toBe('RLS_CONTEXT_MISSING');
  });
});

describe('RLSContextError', () => {
  it('should extend RLSError', () => {
    const error = new RLSContextError();
    expect(error).toBeInstanceOf(RLSError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should set correct error name', () => {
    const error = new RLSContextError();
    expect(error.name).toBe('RLSContextError');
  });

  it('should have correct error code', () => {
    const error = new RLSContextError();
    expect(error.code).toBe(RLSErrorCodes.RLS_CONTEXT_MISSING);
  });

  it('should use default message when none provided', () => {
    const error = new RLSContextError();
    expect(error.message).toBe('No RLS context found. Ensure code runs within withRLSContext()');
  });

  it('should accept custom message', () => {
    const customMessage = 'Custom context error';
    const error = new RLSContextError(customMessage);
    expect(error.message).toBe(customMessage);
  });

  it('should serialize to JSON', () => {
    const error = new RLSContextError('Custom message');
    const json = error.toJSON();

    expect(json).toEqual({
      name: 'RLSContextError',
      message: 'Custom message',
      code: RLSErrorCodes.RLS_CONTEXT_MISSING,
    });
  });

  it('should be throwable', () => {
    expect(() => {
      throw new RLSContextError();
    }).toThrow(RLSContextError);
  });
});

describe('RLSContextValidationError', () => {
  it('should extend RLSError', () => {
    const error = new RLSContextValidationError('Validation failed', 'userId');
    expect(error).toBeInstanceOf(RLSError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should set correct error name', () => {
    const error = new RLSContextValidationError('Validation failed', 'userId');
    expect(error.name).toBe('RLSContextValidationError');
  });

  it('should have correct error code', () => {
    const error = new RLSContextValidationError('Validation failed', 'userId');
    expect(error.code).toBe(RLSErrorCodes.RLS_CONTEXT_INVALID);
  });

  it('should store error message', () => {
    const message = 'userId is required';
    const error = new RLSContextValidationError(message, 'userId');
    expect(error.message).toBe(message);
  });

  it('should store field name', () => {
    const error = new RLSContextValidationError('Validation failed', 'userId');
    expect(error.field).toBe('userId');
  });

  it('should include field in JSON serialization', () => {
    const error = new RLSContextValidationError('userId is required', 'userId');
    const json = error.toJSON();

    expect(json).toEqual({
      name: 'RLSContextValidationError',
      message: 'userId is required',
      code: RLSErrorCodes.RLS_CONTEXT_INVALID,
      field: 'userId',
    });
  });

  it('should handle different field names', () => {
    const fields = ['userId', 'tenantId', 'roles', 'auth.userId'];

    fields.forEach(field => {
      const error = new RLSContextValidationError(`${field} validation failed`, field);
      expect(error.field).toBe(field);
      expect(error.toJSON().field).toBe(field);
    });
  });

  it('should be throwable', () => {
    expect(() => {
      throw new RLSContextValidationError('Validation failed', 'userId');
    }).toThrow(RLSContextValidationError);
  });
});

describe('RLSPolicyViolation', () => {
  it('should extend RLSError', () => {
    const error = new RLSPolicyViolation('read', 'posts', 'Access denied');
    expect(error).toBeInstanceOf(RLSError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should set correct error name', () => {
    const error = new RLSPolicyViolation('read', 'posts', 'Access denied');
    expect(error.name).toBe('RLSPolicyViolation');
  });

  it('should have correct error code', () => {
    const error = new RLSPolicyViolation('read', 'posts', 'Access denied');
    expect(error.code).toBe(RLSErrorCodes.RLS_POLICY_VIOLATION);
  });

  it('should store operation', () => {
    const error = new RLSPolicyViolation('update', 'posts', 'Access denied');
    expect(error.operation).toBe('update');
  });

  it('should store table name', () => {
    const error = new RLSPolicyViolation('read', 'users', 'Access denied');
    expect(error.table).toBe('users');
  });

  it('should store reason', () => {
    const reason = 'User does not own this resource';
    const error = new RLSPolicyViolation('update', 'posts', reason);
    expect(error.reason).toBe(reason);
  });

  it('should store optional policy name', () => {
    const error = new RLSPolicyViolation('delete', 'posts', 'Access denied', 'admin_only');
    expect(error.policyName).toBe('admin_only');
  });

  it('should not have policyName when not provided', () => {
    const error = new RLSPolicyViolation('delete', 'posts', 'Access denied');
    expect(error.policyName).toBeUndefined();
  });

  it('should format error message correctly', () => {
    const error = new RLSPolicyViolation('update', 'posts', 'User does not own this post');
    expect(error.message).toBe('RLS policy violation: update on posts - User does not own this post');
  });

  it('should format error message with different operations', () => {
    const operations = ['read', 'create', 'update', 'delete'];

    operations.forEach(op => {
      const error = new RLSPolicyViolation(op, 'posts', 'Access denied');
      expect(error.message).toContain(op);
    });
  });

  it('should serialize to JSON without policy name', () => {
    const error = new RLSPolicyViolation('read', 'posts', 'Access denied');
    const json = error.toJSON();

    expect(json).toEqual({
      name: 'RLSPolicyViolation',
      message: 'RLS policy violation: read on posts - Access denied',
      code: RLSErrorCodes.RLS_POLICY_VIOLATION,
      operation: 'read',
      table: 'posts',
      reason: 'Access denied',
    });
  });

  it('should serialize to JSON with policy name', () => {
    const error = new RLSPolicyViolation('update', 'posts', 'Not authorized', 'owner_only');
    const json = error.toJSON();

    expect(json).toEqual({
      name: 'RLSPolicyViolation',
      message: 'RLS policy violation: update on posts - Not authorized',
      code: RLSErrorCodes.RLS_POLICY_VIOLATION,
      operation: 'update',
      table: 'posts',
      reason: 'Not authorized',
      policyName: 'owner_only',
    });
  });

  it('should handle all CRUD operations', () => {
    const operations = [
      { op: 'read', table: 'posts' },
      { op: 'create', table: 'comments' },
      { op: 'update', table: 'users' },
      { op: 'delete', table: 'resources' },
    ];

    operations.forEach(({ op, table }) => {
      const error = new RLSPolicyViolation(op, table, 'Test reason');
      expect(error.operation).toBe(op);
      expect(error.table).toBe(table);
    });
  });

  it('should be throwable', () => {
    expect(() => {
      throw new RLSPolicyViolation('read', 'posts', 'Access denied');
    }).toThrow(RLSPolicyViolation);
  });
});

describe('RLSSchemaError', () => {
  it('should extend RLSError', () => {
    const error = new RLSSchemaError('Schema validation failed');
    expect(error).toBeInstanceOf(RLSError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should set correct error name', () => {
    const error = new RLSSchemaError('Schema validation failed');
    expect(error.name).toBe('RLSSchemaError');
  });

  it('should have correct error code', () => {
    const error = new RLSSchemaError('Schema validation failed');
    expect(error.code).toBe(RLSErrorCodes.RLS_SCHEMA_INVALID);
  });

  it('should store error message', () => {
    const message = 'Invalid policy type';
    const error = new RLSSchemaError(message);
    expect(error.message).toBe(message);
  });

  it('should store empty details by default', () => {
    const error = new RLSSchemaError('Schema validation failed');
    expect(error.details).toEqual({});
  });

  it('should store schema details in metadata', () => {
    const details = {
      table: 'posts',
      policy: 'invalid-policy',
      field: 'type',
    };
    const error = new RLSSchemaError('Invalid policy type', details);
    expect(error.details).toEqual(details);
  });

  it('should serialize to JSON with empty details', () => {
    const error = new RLSSchemaError('Schema validation failed');
    const json = error.toJSON();

    expect(json).toEqual({
      name: 'RLSSchemaError',
      message: 'Schema validation failed',
      code: RLSErrorCodes.RLS_SCHEMA_INVALID,
      details: {},
    });
  });

  it('should serialize to JSON with details', () => {
    const details = {
      table: 'users',
      invalidField: 'policies',
      reason: 'Missing condition function',
    };
    const error = new RLSSchemaError('Schema validation failed', details);
    const json = error.toJSON();

    expect(json).toEqual({
      name: 'RLSSchemaError',
      message: 'Schema validation failed',
      code: RLSErrorCodes.RLS_SCHEMA_INVALID,
      details,
    });
  });

  it('should handle complex detail objects', () => {
    const details = {
      table: 'posts',
      policy: {
        type: 'allow',
        operation: 'read',
        error: 'Missing condition',
      },
      suggestions: ['Add condition function', 'Use valid policy type'],
    };
    const error = new RLSSchemaError('Invalid policy definition', details);
    expect(error.details).toEqual(details);
    expect(error.toJSON().details).toEqual(details);
  });

  it('should preserve detail types', () => {
    const details = {
      stringField: 'value',
      numberField: 42,
      booleanField: true,
      arrayField: [1, 2, 3],
      objectField: { nested: 'value' },
      nullField: null,
    };
    const error = new RLSSchemaError('Test', details);
    expect(error.details).toEqual(details);
  });

  it('should be throwable', () => {
    expect(() => {
      throw new RLSSchemaError('Schema validation failed');
    }).toThrow(RLSSchemaError);
  });
});

describe('Error inheritance chain', () => {
  it('should maintain proper inheritance for all error types', () => {
    const errors = [
      new RLSError('Test', RLSErrorCodes.RLS_CONTEXT_MISSING),
      new RLSContextError(),
      new RLSContextValidationError('Test', 'field'),
      new RLSPolicyViolation('read', 'table', 'reason'),
      new RLSSchemaError('Test'),
    ];

    errors.forEach(error => {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RLSError);
    });
  });

  it('should allow instanceof checks for specific error types', () => {
    const contextError = new RLSContextError();
    const validationError = new RLSContextValidationError('Test', 'field');
    const violationError = new RLSPolicyViolation('read', 'table', 'reason');
    const schemaError = new RLSSchemaError('Test');

    expect(contextError).toBeInstanceOf(RLSContextError);
    expect(validationError).toBeInstanceOf(RLSContextValidationError);
    expect(violationError).toBeInstanceOf(RLSPolicyViolation);
    expect(schemaError).toBeInstanceOf(RLSSchemaError);

    // Should not be instances of other error types
    expect(contextError).not.toBeInstanceOf(RLSPolicyViolation);
    expect(violationError).not.toBeInstanceOf(RLSContextError);
  });

  it('should preserve stack traces', () => {
    const errors = [
      new RLSError('Test', RLSErrorCodes.RLS_CONTEXT_MISSING),
      new RLSContextError(),
      new RLSContextValidationError('Test', 'field'),
      new RLSPolicyViolation('read', 'table', 'reason'),
      new RLSSchemaError('Test'),
    ];

    errors.forEach(error => {
      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe('string');
      if (error.stack) {
        expect(error.stack.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('Error code type safety', () => {
  it('should enforce error code types at compile time', () => {
    // These should compile without issues
    const error1: RLSError = new RLSError('Test', RLSErrorCodes.RLS_CONTEXT_MISSING);
    const error2: RLSError = new RLSError('Test', RLSErrorCodes.RLS_POLICY_VIOLATION);
    const error3: RLSError = new RLSError('Test', RLSErrorCodes.RLS_SCHEMA_INVALID);

    expect(error1.code).toBe(RLSErrorCodes.RLS_CONTEXT_MISSING);
    expect(error2.code).toBe(RLSErrorCodes.RLS_POLICY_VIOLATION);
    expect(error3.code).toBe(RLSErrorCodes.RLS_SCHEMA_INVALID);
  });

  it('should have readonly error codes', () => {
    const error = new RLSError('Test', RLSErrorCodes.RLS_CONTEXT_MISSING);

    // TypeScript should prevent this at compile time
    // The @ts-expect-error comment verifies TypeScript catches reassignment attempts
    // At runtime, JavaScript doesn't enforce readonly, so we just verify the code property exists
    // @ts-expect-error - code is readonly
    error.code = RLSErrorCodes.RLS_POLICY_VIOLATION;

    // The above assignment may or may not throw depending on class implementation
    // What matters is that TypeScript catches it at compile time (via @ts-expect-error)
    // Verify the error still has a valid code property
    expect(error.code).toBeDefined();
  });
});
