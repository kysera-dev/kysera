import { describe, it, expect } from 'vitest';
import {
  parseDatabaseError,
  DatabaseError,
  UniqueConstraintError,
  ForeignKeyError,
  NotFoundError,
  BadRequestError,
  NotNullError,
  CheckConstraintError,
} from '../src/errors.js';
import { ErrorCodes } from '../src/error-codes.js';

describe('Extended Error Handling', () => {
  describe('PostgreSQL Error Parsing', () => {
    it('should parse PostgreSQL unique constraint violation', () => {
      const pgError = {
        code: '23505',
        constraint: 'users_email_key',
        table: 'users',
        columns: ['email'],
        message: 'duplicate key value violates unique constraint "users_email_key"',
      };

      const parsed = parseDatabaseError(pgError, 'postgres');

      expect(parsed).toBeInstanceOf(UniqueConstraintError);
      expect(parsed.code).toBe(ErrorCodes.VALIDATION_UNIQUE_VIOLATION);
      const uniqueError = parsed as UniqueConstraintError;
      expect(uniqueError.constraint).toBe('users_email_key');
      expect(uniqueError.table).toBe('users');
      expect(uniqueError.columns).toEqual(['email']);
    });

    it('should parse PostgreSQL foreign key violation', () => {
      const pgError = {
        code: '23503',
        constraint: 'posts_user_id_fkey',
        table: 'posts',
        detail: 'Key (user_id)=(999) is not present in table "users".',
        message: 'insert or update on table "posts" violates foreign key constraint',
      };

      const parsed = parseDatabaseError(pgError, 'postgres');

      expect(parsed).toBeInstanceOf(ForeignKeyError);
      expect(parsed.code).toBe(ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION);
      const fkError = parsed as ForeignKeyError;
      expect(fkError.constraint).toBe('posts_user_id_fkey');
      expect(fkError.table).toBe('posts');
      expect(fkError.referencedTable).toBe('users');
    });

    it('should parse PostgreSQL not null violation', () => {
      const pgError = {
        code: '23502',
        column: 'name',
        message: 'null value in column "name" violates not-null constraint',
      };

      const parsed = parseDatabaseError(pgError, 'postgres');

      expect(parsed).toBeInstanceOf(NotNullError);
      expect(parsed.code).toBe(ErrorCodes.VALIDATION_NOT_NULL_VIOLATION);
      expect(parsed.message).toContain('NOT NULL constraint violation');
      expect(parsed.detail).toBe('name');
    });

    it('should parse PostgreSQL check constraint violation', () => {
      const pgError = {
        code: '23514',
        constraint: 'age_check',
        table: 'users',
        message: 'new row for relation "users" violates check constraint "age_check"',
      };

      const parsed = parseDatabaseError(pgError, 'postgres');

      expect(parsed).toBeInstanceOf(CheckConstraintError);
      expect(parsed.code).toBe(ErrorCodes.VALIDATION_CHECK_VIOLATION);
      expect(parsed.message).toContain('CHECK constraint violation: age_check');
    });

    it('should handle unknown PostgreSQL error codes', () => {
      const pgError = {
        code: '99999',
        message: 'Some unknown error',
      };

      const parsed = parseDatabaseError(pgError, 'postgres');

      expect(parsed).toBeInstanceOf(DatabaseError);
      expect(parsed.code).toBe('99999');
      expect(parsed.message).toBe('Some unknown error');
    });

    it('should handle PostgreSQL errors with missing fields', () => {
      const pgError = {
        code: '23505',
        // Missing constraint, table, columns
      };

      const parsed = parseDatabaseError(pgError, 'postgres');

      expect(parsed).toBeInstanceOf(UniqueConstraintError);
      const uniqueError = parsed as UniqueConstraintError;
      expect(uniqueError.constraint).toBe('unique');
      expect(uniqueError.table).toBe('unknown');
      expect(uniqueError.columns).toEqual([]);
    });
  });

  describe('MySQL Error Parsing', () => {
    it('should parse MySQL duplicate entry error', () => {
      const mysqlError = {
        code: 'ER_DUP_ENTRY',
        sqlMessage: "Duplicate entry 'test@example.com' for key 'users.email_unique'",
      };

      const parsed = parseDatabaseError(mysqlError, 'mysql');

      expect(parsed).toBeInstanceOf(UniqueConstraintError);
      const uniqueError = parsed as UniqueConstraintError;
      expect(uniqueError.constraint).toBe('users.email_unique');
      expect(uniqueError.table).toBe('unknown'); // MySQL doesn't provide table easily
    });

    it('should parse MySQL ER_DUP_KEY error', () => {
      const mysqlError = {
        code: 'ER_DUP_KEY',
        sqlMessage: "Duplicate entry '123' for key 'PRIMARY'",
      };

      const parsed = parseDatabaseError(mysqlError, 'mysql');

      expect(parsed).toBeInstanceOf(UniqueConstraintError);
      const uniqueError = parsed as UniqueConstraintError;
      expect(uniqueError.constraint).toBe('PRIMARY');
    });

    it('should parse MySQL foreign key error (NO_REFERENCED_ROW)', () => {
      const mysqlError = {
        code: 'ER_NO_REFERENCED_ROW',
        message: 'Cannot add or update a child row: a foreign key constraint fails',
      };

      const parsed = parseDatabaseError(mysqlError, 'mysql');

      expect(parsed).toBeInstanceOf(ForeignKeyError);
      expect(parsed.code).toBe(ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION);
    });

    it('should parse MySQL foreign key error (NO_REFERENCED_ROW_2)', () => {
      const mysqlError = {
        code: 'ER_NO_REFERENCED_ROW_2',
        message: 'Cannot add or update a child row',
      };

      const parsed = parseDatabaseError(mysqlError, 'mysql');

      expect(parsed).toBeInstanceOf(ForeignKeyError);
    });

    it('should parse MySQL NOT NULL error', () => {
      const mysqlError = {
        code: 'ER_BAD_NULL_ERROR',
        sqlMessage: "Column 'name' cannot be null",
      };

      const parsed = parseDatabaseError(mysqlError, 'mysql');

      expect(parsed).toBeInstanceOf(NotNullError);
      expect(parsed.code).toBe(ErrorCodes.VALIDATION_NOT_NULL_VIOLATION);
      expect(parsed.message).toContain('NOT NULL constraint violation');
      expect((parsed as NotNullError).column).toBe('name');
    });

    it('should handle unknown MySQL error codes', () => {
      const mysqlError = {
        code: 'ER_UNKNOWN',
        sqlMessage: 'Something went wrong',
        message: 'Fallback message',
      };

      const parsed = parseDatabaseError(mysqlError, 'mysql');

      expect(parsed).toBeInstanceOf(DatabaseError);
      expect(parsed.code).toBe('ER_UNKNOWN');
      expect(parsed.message).toBe('Something went wrong');
    });

    it('should handle MySQL errors with only message field', () => {
      const mysqlError = {
        code: 'ER_UNKNOWN',
        message: 'Only message field',
      };

      const parsed = parseDatabaseError(mysqlError, 'mysql');

      expect(parsed.message).toBe('Only message field');
    });

    it('should handle MySQL errors without sqlMessage', () => {
      const mysqlError = {
        code: 'ER_BAD_NULL_ERROR',
        // No sqlMessage field - column will be 'unknown'
      };

      const parsed = parseDatabaseError(mysqlError, 'mysql');

      expect(parsed).toBeInstanceOf(NotNullError);
      expect((parsed as NotNullError).column).toBe('unknown');
    });
  });

  describe('SQLite Error Parsing', () => {
    it('should handle SQLite errors without UNIQUE keyword', () => {
      const sqliteError = {
        message: 'Some other database error',
      };

      const parsed = parseDatabaseError(sqliteError, 'sqlite');

      expect(parsed).toBeInstanceOf(DatabaseError);
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN);
      expect(parsed.message).toBe('Some other database error');
    });

    it('should handle SQLite errors with partial UNIQUE match', () => {
      const sqliteError = {
        message: 'UNIQUE constraint failed: users',
        // Missing column part
      };

      const parsed = parseDatabaseError(sqliteError, 'sqlite');

      expect(parsed).toBeInstanceOf(UniqueConstraintError);
      const uniqueError = parsed as UniqueConstraintError;
      expect(uniqueError.table).toBe('unknown'); // SQLite parser doesn't extract table from partial match
      expect(uniqueError.columns).toEqual([]);
    });
  });

  describe('Error Classes', () => {
    it('should create NotFoundError with filters', () => {
      const error = new NotFoundError('User', { id: 1, email: 'test@example.com' });

      expect(error.message).toBe('User not found');
      expect(error.code).toBe(ErrorCodes.RESOURCE_NOT_FOUND);
      expect(error.detail).toBe('{"id":1,"email":"test@example.com"}');
    });

    it('should create NotFoundError without filters', () => {
      const error = new NotFoundError('Post');

      expect(error.message).toBe('Post not found');
      expect(error.code).toBe(ErrorCodes.RESOURCE_NOT_FOUND);
      expect(error.detail).toBeUndefined();
    });

    it('should create BadRequestError', () => {
      const error = new BadRequestError('Invalid email format');

      expect(error.message).toBe('Invalid email format');
      expect(error.code).toBe(ErrorCodes.RESOURCE_BAD_REQUEST);
      expect(error.name).toBe('BadRequestError');
    });

    it('should serialize DatabaseError to JSON', () => {
      const error = new DatabaseError('Test error', 'TEST_CODE', 'Some detail');
      const json = error.toJSON();

      expect(json).toEqual({
        name: 'DatabaseError',
        message: 'Test error',
        code: 'TEST_CODE',
        detail: 'Some detail',
      });
    });

    it('should serialize UniqueConstraintError to JSON', () => {
      const error = new UniqueConstraintError('unique_key', 'users', ['email']);
      const json = error.toJSON();

      expect(json).toEqual({
        name: 'UniqueConstraintError',
        message: 'UNIQUE constraint violation on users',
        code: ErrorCodes.VALIDATION_UNIQUE_VIOLATION,
        detail: undefined,
        constraint: 'unique_key',
        table: 'users',
        columns: ['email'],
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-object errors', () => {
      const parsed = parseDatabaseError('string error');

      expect(parsed).toBeInstanceOf(DatabaseError);
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN);
      expect(parsed.message).toBe('Unknown database error');
    });

    it('should handle null errors', () => {
      const parsed = parseDatabaseError(null);

      expect(parsed).toBeInstanceOf(DatabaseError);
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN);
      expect(parsed.message).toBe('Unknown database error');
    });

    it('should handle undefined errors', () => {
      const parsed = parseDatabaseError(undefined);

      expect(parsed).toBeInstanceOf(DatabaseError);
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN);
    });

    it('should handle errors without code field', () => {
      const error = {
        message: 'Some error without code',
      };

      const parsed = parseDatabaseError(error, 'postgres');

      expect(parsed).toBeInstanceOf(DatabaseError);
      expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN);
      expect(parsed.message).toBe('Unknown database error');
    });

    it('should default to postgres dialect when not specified', () => {
      const pgError = {
        code: '23505',
        constraint: 'test_constraint',
        table: 'test_table',
        columns: [],
      };

      const parsed = parseDatabaseError(pgError);

      expect(parsed).toBeInstanceOf(UniqueConstraintError);
      const uniqueError = parsed as UniqueConstraintError;
      expect(uniqueError.constraint).toBe('test_constraint');
    });
  });
});
