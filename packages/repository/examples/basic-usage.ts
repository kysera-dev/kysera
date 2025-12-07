/**
 * Basic usage example for @kysera/repository
 *
 * This example demonstrates:
 * - Creating a database connection with Kysely
 * - Setting up a repository with Zod validation
 * - CRUD operations (Create, Read, Update, Delete)
 * - Batch operations
 * - Pagination
 * - Transaction support
 */

import { Kysely, PostgresDialect, Generated } from 'kysely';
import { Pool } from 'pg';
import { z } from 'zod';
import { createRepositoryFactory } from '@kysera/repository';

// ============================================================================
// 1. Define Database Schema
// ============================================================================

/**
 * Database table structure for TypeScript type checking
 */
interface Database {
  users: {
    id: Generated<number>;
    email: string;
    name: string;
    created_at: Generated<Date>;
  };
}

/**
 * Domain entity type (what your application works with)
 */
interface User {
  id: number;
  email: string;
  name: string;
  created_at: Date;
}

// ============================================================================
// 2. Define Validation Schemas
// ============================================================================

/**
 * Schema for creating new users
 */
const CreateUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
});

/**
 * Schema for updating users (all fields optional)
 */
const UpdateUserSchema = CreateUserSchema.partial();

// ============================================================================
// 3. Create Database Connection
// ============================================================================

/**
 * Create Kysely database instance with PostgreSQL
 */
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'myapp',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    }),
  }),
});

// ============================================================================
// 4. Create Repository Factory
// ============================================================================

/**
 * Factory for creating type-safe repositories
 */
const factory = createRepositoryFactory(db);

/**
 * Create user repository with validation and type safety
 */
const userRepo = factory.create<'users', User>({
  tableName: 'users',

  // Map database rows to domain entities
  mapRow: (row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: new Date(row.created_at),
  }),

  // Validation schemas
  schemas: {
    create: CreateUserSchema,
    update: UpdateUserSchema,
  },
});

// ============================================================================
// 5. CRUD Operations
// ============================================================================

async function crudExamples() {
  console.log('=== CRUD Operations ===\n');

  // CREATE
  console.log('1. Creating a new user...');
  const user = await userRepo.create({
    email: 'alice@example.com',
    name: 'Alice Smith',
  });
  console.log('Created:', user);
  console.log();

  // READ - Find by ID
  console.log('2. Finding user by ID...');
  const found = await userRepo.findById(user.id);
  console.log('Found:', found);
  console.log();

  // READ - Find all
  console.log('3. Finding all users...');
  const allUsers = await userRepo.findAll();
  console.log(`Found ${allUsers.length} users`);
  console.log();

  // UPDATE
  console.log('4. Updating user...');
  const updated = await userRepo.update(user.id, {
    name: 'Alice Johnson',
  });
  console.log('Updated:', updated);
  console.log();

  // DELETE
  console.log('5. Deleting user...');
  const deleted = await userRepo.delete(user.id);
  console.log('Deleted:', deleted);
  console.log();
}

// ============================================================================
// 6. Batch Operations
// ============================================================================

async function batchExamples() {
  console.log('=== Batch Operations ===\n');

  // BULK CREATE
  console.log('1. Creating multiple users...');
  const users = await userRepo.bulkCreate([
    { email: 'bob@example.com', name: 'Bob' },
    { email: 'charlie@example.com', name: 'Charlie' },
    { email: 'diana@example.com', name: 'Diana' },
  ]);
  console.log(`Created ${users.length} users`);
  console.log();

  // BULK UPDATE
  console.log('2. Updating multiple users...');
  const updates = users.map((user) => ({
    id: user.id,
    data: { name: `${user.name} Updated` },
  }));
  const updatedUsers = await userRepo.bulkUpdate(updates);
  console.log(`Updated ${updatedUsers.length} users`);
  console.log();

  // BULK DELETE
  console.log('3. Deleting multiple users...');
  const ids = users.map((u) => u.id);
  const deleteCount = await userRepo.bulkDelete(ids);
  console.log(`Deleted ${deleteCount} users`);
  console.log();
}

// ============================================================================
// 7. Query Operations
// ============================================================================

async function queryExamples() {
  console.log('=== Query Operations ===\n');

  // Create test data
  await userRepo.bulkCreate([
    { email: 'user1@example.com', name: 'User One' },
    { email: 'user2@example.com', name: 'User Two' },
    { email: 'user3@example.com', name: 'User Three' },
  ]);

  // COUNT
  console.log('1. Counting users...');
  const count = await userRepo.count();
  console.log(`Total users: ${count}`);
  console.log();

  // EXISTS
  console.log('2. Checking if users exist...');
  const exists = await userRepo.exists();
  console.log(`Users exist: ${exists}`);
  console.log();

  // FIND ONE
  console.log('3. Finding first user...');
  const firstUser = await userRepo.findOne();
  console.log('First user:', firstUser);
  console.log();
}

// ============================================================================
// 8. Pagination
// ============================================================================

async function paginationExamples() {
  console.log('=== Pagination ===\n');

  // Create test data
  const testUsers = Array.from({ length: 25 }, (_, i) => ({
    email: `user${i}@example.com`,
    name: `User ${i}`,
  }));
  await userRepo.bulkCreate(testUsers);

  // OFFSET-BASED PAGINATION
  console.log('1. Offset-based pagination (page 1)...');
  const page1 = await userRepo.paginate({
    limit: 10,
    offset: 0,
    orderBy: 'created_at',
    orderDirection: 'desc',
  });
  console.log(`Page 1: ${page1.items.length} items, Total: ${page1.total}`);
  console.log();

  // CURSOR-BASED PAGINATION
  console.log('2. Cursor-based pagination...');
  const cursorPage1 = await userRepo.paginateCursor({
    limit: 10,
  });
  console.log(`Cursor page 1: ${cursorPage1.items.length} items`);
  console.log(`Has more: ${cursorPage1.hasMore}`);

  if (cursorPage1.nextCursor) {
    const cursorPage2 = await userRepo.paginateCursor({
      limit: 10,
      cursor: cursorPage1.nextCursor,
    });
    console.log(`Cursor page 2: ${cursorPage2.items.length} items`);
  }
  console.log();
}

// ============================================================================
// 9. Transaction Support
// ============================================================================

async function transactionExample() {
  console.log('=== Transaction Support ===\n');

  try {
    await db.transaction().execute(async (trx) => {
      // Create repository with transaction executor
      const txUserRepo = userRepo.withTransaction(trx);

      // All operations are part of the transaction
      const user1 = await txUserRepo.create({
        email: 'tx1@example.com',
        name: 'Transaction User 1',
      });
      console.log('Created in transaction:', user1);

      const user2 = await txUserRepo.create({
        email: 'tx2@example.com',
        name: 'Transaction User 2',
      });
      console.log('Created in transaction:', user2);

      // Simulate error - both users will be rolled back
      // throw new Error('Transaction rollback test');
    });

    console.log('Transaction committed successfully');
  } catch (error) {
    console.error('Transaction rolled back:', error);
  }
  console.log();
}

// ============================================================================
// 10. Validation Examples
// ============================================================================

async function validationExamples() {
  console.log('=== Validation Examples ===\n');

  // Valid input
  try {
    console.log('1. Valid input...');
    const user = await userRepo.create({
      email: 'valid@example.com',
      name: 'Valid User',
    });
    console.log('Success:', user);
  } catch (error) {
    console.error('Validation error:', error);
  }
  console.log();

  // Invalid email
  try {
    console.log('2. Invalid email...');
    await userRepo.create({
      email: 'not-an-email',
      name: 'Invalid Email',
    });
  } catch (error) {
    console.error('Validation error:', error instanceof Error ? error.message : error);
  }
  console.log();

  // Empty name
  try {
    console.log('3. Empty name...');
    await userRepo.create({
      email: 'valid@example.com',
      name: '',
    });
  } catch (error) {
    console.error('Validation error:', error instanceof Error ? error.message : error);
  }
  console.log();
}

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  try {
    console.log('Kysera Repository - Basic Usage Examples\n');
    console.log('==========================================\n');

    // Run examples
    await crudExamples();
    await batchExamples();
    await queryExamples();
    await paginationExamples();
    await transactionExample();
    await validationExamples();

    console.log('==========================================');
    console.log('All examples completed successfully!');
  } catch (error) {
    console.error('Error running examples:', error);
  } finally {
    // Clean up database connection
    await db.destroy();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { main, userRepo, db };
