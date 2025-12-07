import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase } from './setup/database.js';
import {
  parseDatabaseError,
  DatabaseError,
  UniqueConstraintError,
  ForeignKeyError,
  NotFoundError,
} from '../src/errors.js';
import { ErrorCodes } from '../src/error-codes.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/database.js';

describe('Database Error Handling', () => {
  let db: Kysely<TestDatabase>;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = createTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  describe('SQLite Error Parsing', () => {
    it('should handle unique constraint violations', async () => {
      // Insert first user
      await db.insertInto('users').values({ email: 'test@example.com', name: 'Test User' }).execute();

      // Try to insert duplicate email
      try {
        await db.insertInto('users').values({ email: 'test@example.com', name: 'Another User' }).execute();
        expect.fail('Should have thrown unique constraint error');
      } catch (error) {
        const parsed = parseDatabaseError(error, 'sqlite');
        expect(parsed).toBeInstanceOf(UniqueConstraintError);
        expect(parsed.message).toContain('UNIQUE');
      }
    });

    it('should handle foreign key constraint violations', async () => {
      // Try to insert post with non-existent user_id
      try {
        await db
          .insertInto('posts')
          .values({
            user_id: 9999,
            title: 'Invalid Post',
            content: 'This should fail',
            published: 0, // SQLite uses 0/1 for boolean
          })
          .execute();
        expect.fail('Should have thrown foreign key error');
      } catch (error) {
        const parsed = parseDatabaseError(error, 'sqlite');
        expect(parsed).toBeInstanceOf(ForeignKeyError);
        expect(parsed.message).toContain('FOREIGN KEY');
      }
    });

    it('should handle not null constraint violations', async () => {
      // Try to insert user without required fields
      try {
        await db
          .insertInto('users')
          .values({ email: null as any, name: 'Test' })
          .execute();
        expect.fail('Should have thrown not null error');
      } catch (error) {
        const parsed = parseDatabaseError(error, 'sqlite');
        expect(parsed).toBeInstanceOf(DatabaseError);
        expect(parsed.message).toContain('NOT NULL');
      }
    });

    it('should handle generic database errors', async () => {
      // Create an error that doesn't match specific patterns
      try {
        await db
          .selectFrom('non_existent_table' as any)
          .selectAll()
          .execute();
        expect.fail('Should have thrown error');
      } catch (error) {
        const parsed = parseDatabaseError(error, 'sqlite');
        expect(parsed).toBeInstanceOf(DatabaseError);
        expect(parsed.code).toBe(ErrorCodes.DB_UNKNOWN);
      }
    });
  });

  describe('Cross-Database Error Consistency', () => {
    it('should parse errors consistently across dialects', () => {
      // Simulate PostgreSQL error
      const pgError = {
        code: '23505',
        constraint: 'users_email_key',
        table: 'users',
        detail: 'Key (email)=(test@example.com) already exists.',
      };

      const pgParsed = parseDatabaseError(pgError, 'postgres');
      expect(pgParsed).toBeInstanceOf(UniqueConstraintError);
      expect(pgParsed.code).toBe(ErrorCodes.VALIDATION_UNIQUE_VIOLATION);

      // Simulate MySQL error
      const mysqlError = {
        code: 'ER_DUP_ENTRY',
        sqlMessage: "Duplicate entry 'test@example.com' for key 'email'",
      };

      const mysqlParsed = parseDatabaseError(mysqlError, 'mysql');
      expect(mysqlParsed).toBeInstanceOf(UniqueConstraintError);
      expect(mysqlParsed.code).toBe(ErrorCodes.VALIDATION_UNIQUE_VIOLATION);

      // SQLite error (from actual database)
      const sqliteError = new Error('UNIQUE constraint failed: users.email');
      const sqliteParsed = parseDatabaseError(sqliteError, 'sqlite');
      expect(sqliteParsed).toBeInstanceOf(UniqueConstraintError);
      expect(sqliteParsed.code).toBe(ErrorCodes.VALIDATION_UNIQUE_VIOLATION);
    });
  });

  describe('NotFoundError', () => {
    it('should be thrown when no results found', async () => {
      const result = await db.selectFrom('users').where('id', '=', 9999).selectAll().executeTakeFirst();

      if (!result) {
        const error = new NotFoundError('User', { id: 9999 });
        expect(error.message).toBe('User not found');
        expect(error.code).toBe(ErrorCodes.RESOURCE_NOT_FOUND);
        expect(error.detail).toBe('{"id":9999}');
      }
    });
  });

  describe('Error Serialization', () => {
    it('should serialize errors properly for logging', () => {
      const error = new UniqueConstraintError('email', 'users', ['email']);

      const serialized = JSON.stringify(error);
      const parsed = JSON.parse(serialized);

      expect(parsed.name).toBe('UniqueConstraintError');
      expect(parsed.message).toContain('UNIQUE constraint');
      expect(parsed.code).toBe(ErrorCodes.VALIDATION_UNIQUE_VIOLATION);
    });
  });
});
