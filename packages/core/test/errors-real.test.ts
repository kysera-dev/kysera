import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { parseDatabaseError, UniqueConstraintError, ForeignKeyError, DatabaseError, NotNullError } from '../src/errors.js';
import { ErrorCodes } from '../src/error-codes.js';
import { createTestDatabase, initializeTestSchema, clearTestDatabase, testFactories } from './setup/test-database.js';
import type { Kysely } from 'kysely';
import type { TestDatabase } from './setup/test-database.js';

describe('Error Handling with Real SQLite Database', () => {
  let db: Kysely<TestDatabase>;

  beforeAll(async () => {
    db = createTestDatabase();
    await initializeTestSchema(db);
  });

  afterEach(async () => {
    await clearTestDatabase(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('Unique Constraint Violations', () => {
    it('should parse SQLite unique constraint error correctly', async () => {
      // Insert first user
      await db
        .insertInto('users')
        .values(testFactories.user({ email: 'test@example.com' }))
        .execute();

      // Try to insert duplicate email
      try {
        await db
          .insertInto('users')
          .values(testFactories.user({ email: 'test@example.com' }))
          .execute();

        expect.fail('Should have thrown unique constraint error');
      } catch (error) {
        const parsed = parseDatabaseError(error, 'sqlite');

        expect(parsed).toBeInstanceOf(UniqueConstraintError);
        expect(parsed.code).toBe(ErrorCodes.VALIDATION_UNIQUE_VIOLATION);

        const uniqueError = parsed as UniqueConstraintError;
        expect(uniqueError.table).toBe('users');
        expect(uniqueError.columns).toContain('email');
      }
    });

    it('should handle unique constraint on multiple attempts', async () => {
      const email = 'unique@example.com';

      // First insert should succeed
      await db.insertInto('users').values(testFactories.user({ email })).execute();

      // Multiple attempts should all fail with same error
      for (let i = 0; i < 3; i++) {
        try {
          await db
            .insertInto('users')
            .values(testFactories.user({ email, name: `User ${i}` }))
            .execute();

          expect.fail('Should have thrown unique constraint error');
        } catch (error) {
          const parsed = parseDatabaseError(error, 'sqlite');
          expect(parsed).toBeInstanceOf(UniqueConstraintError);
        }
      }
    });
  });

  describe('Foreign Key Violations', () => {
    it('should parse SQLite foreign key constraint error correctly', async () => {
      // Try to insert post with non-existent user_id
      try {
        await db.insertInto('posts').values(testFactories.post(999)).execute();

        expect.fail('Should have thrown foreign key error');
      } catch (error) {
        const parsed = parseDatabaseError(error, 'sqlite');

        expect(parsed).toBeInstanceOf(ForeignKeyError);
        expect(parsed.code).toBe(ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION);
      }
    });

    it('should handle cascading deletes properly', async () => {
      // Create user with posts and comments
      const user = await db.insertInto('users').values(testFactories.user()).returningAll().executeTakeFirstOrThrow();

      const post = await db
        .insertInto('posts')
        .values(testFactories.post(user.id))
        .returningAll()
        .executeTakeFirstOrThrow();

      await db.insertInto('comments').values(testFactories.comment(post.id, user.id)).execute();

      // Delete user should cascade to posts and comments
      await db.deleteFrom('users').where('id', '=', user.id).execute();

      // Verify cascading deletes
      const posts = await db.selectFrom('posts').selectAll().where('user_id', '=', user.id).execute();

      const comments = await db.selectFrom('comments').selectAll().where('user_id', '=', user.id).execute();

      expect(posts).toHaveLength(0);
      expect(comments).toHaveLength(0);
    });
  });

  describe('NOT NULL Violations', () => {
    it('should parse SQLite NOT NULL constraint error correctly', async () => {
      try {
        await db
          .insertInto('users')
          .values({ email: 'test@example.com' } as any) // Missing required 'name' field
          .execute();

        expect.fail('Should have thrown NOT NULL error');
      } catch (error) {
        const parsed = parseDatabaseError(error, 'sqlite');

        expect(parsed).toBeInstanceOf(NotNullError);
        expect(parsed.message).toContain('NOT NULL');
        expect((parsed as NotNullError).column).toBe('name');
      }
    });
  });

  describe('Transaction Rollback', () => {
    it('should properly rollback on error within transaction', async () => {
      try {
        await db.transaction().execute(async (trx) => {
          // Insert valid user
          await trx
            .insertInto('users')
            .values(testFactories.user({ email: 'transaction@example.com' }))
            .execute();

          // This should fail due to duplicate email
          await trx
            .insertInto('users')
            .values(testFactories.user({ email: 'transaction@example.com' }))
            .execute();
        });

        expect.fail('Transaction should have failed');
      } catch (error) {
        // Transaction rolled back
      }

      // Verify no user was inserted
      const users = await db.selectFrom('users').selectAll().where('email', '=', 'transaction@example.com').execute();

      expect(users).toHaveLength(0);
    });
  });

  describe('Complex Error Scenarios', () => {
    it('should handle multiple constraint violations in sequence', async () => {
      const user = await db.insertInto('users').values(testFactories.user()).returningAll().executeTakeFirstOrThrow();

      // Test various constraint violations
      const violations = [
        {
          name: 'Unique email',
          query: () =>
            db
              .insertInto('users')
              .values(testFactories.user({ email: user.email }))
              .execute(),
          errorType: UniqueConstraintError,
        },
        {
          name: 'Invalid foreign key',
          query: () => db.insertInto('posts').values(testFactories.post(999)).execute(),
          errorType: ForeignKeyError,
        },
        {
          name: 'NOT NULL violation',
          query: () =>
            db
              .insertInto('users')
              .values({ email: 'test2@example.com' } as any)
              .execute(),
          errorType: DatabaseError,
        },
      ];

      for (const violation of violations) {
        try {
          await violation.query();
          expect.fail(`${violation.name} should have thrown error`);
        } catch (error) {
          const parsed = parseDatabaseError(error, 'sqlite');
          expect(parsed).toBeInstanceOf(violation.errorType);
        }
      }
    });

    it('should handle error in transactions with multiple operations', async () => {
      try {
        await db.transaction().execute(async (trx) => {
          // Insert first user successfully
          await trx
            .insertInto('users')
            .values(testFactories.user({ email: 'first@example.com' }))
            .execute();

          // Insert second user successfully
          await trx
            .insertInto('users')
            .values(testFactories.user({ email: 'second@example.com' }))
            .execute();

          // This should fail due to duplicate
          await trx
            .insertInto('users')
            .values(testFactories.user({ email: 'second@example.com' }))
            .execute();
        });

        expect.fail('Should have thrown error');
      } catch (error) {
        const parsed = parseDatabaseError(error, 'sqlite');
        expect(parsed).toBeInstanceOf(UniqueConstraintError);
      }

      // Verify complete rollback - no users should exist
      const users = await db.selectFrom('users').selectAll().execute();
      expect(users).toHaveLength(0);
    });
  });

  describe('Error Recovery', () => {
    it('should continue working after constraint violation', async () => {
      // First operation fails
      try {
        await db.insertInto('posts').values(testFactories.post(999)).execute();
      } catch (error) {
        // Expected to fail
      }

      // Database should still work
      const user = await db.insertInto('users').values(testFactories.user()).returningAll().executeTakeFirstOrThrow();

      expect(user.id).toBeDefined();
      expect(user.email).toBeDefined();
    });
  });
});
