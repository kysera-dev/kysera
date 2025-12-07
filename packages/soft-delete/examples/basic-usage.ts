/**
 * Basic usage example for @kysera/soft-delete
 *
 * This example demonstrates:
 * - Setting up soft delete plugin with ORM
 * - Soft deleting records (marks as deleted without removing)
 * - Restoring soft-deleted records
 * - Hard deleting records (permanent removal)
 * - Finding deleted records
 * - Batch soft delete operations
 */

import { Kysely, PostgresDialect, Generated } from 'kysely';
import { Pool } from 'pg';
import { z } from 'zod';
import { createORM, createRepositoryFactory } from '@kysera/repository';
import { softDeletePlugin } from '@kysera/soft-delete';

// ============================================================================
// 1. Define Database Schema
// ============================================================================

/**
 * Database table structure with deleted_at column for soft delete
 */
interface Database {
  users: {
    id: Generated<number>;
    email: string;
    name: string;
    created_at: Generated<Date>;
    deleted_at: Date | null; // Nullable for soft delete support
  };
}

/**
 * Domain entity type
 */
interface User {
  id: number;
  email: string;
  name: string;
  created_at: Date;
  deleted_at: Date | null;
}

// ============================================================================
// 2. Define Validation Schemas
// ============================================================================

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

const UpdateUserSchema = CreateUserSchema.partial();

// ============================================================================
// 3. Create Database Connection
// ============================================================================

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
// 4. Setup Soft Delete Plugin
// ============================================================================

/**
 * Create soft delete plugin
 *
 * Options:
 * - deletedAtColumn: Column name for soft delete timestamp (default: 'deleted_at')
 * - includeDeleted: Include deleted records by default (default: false)
 * - tables: List of tables to enable soft delete (if undefined, all tables)
 * - primaryKeyColumn: Primary key column name (default: 'id')
 */
const softDelete = softDeletePlugin({
  deletedAtColumn: 'deleted_at',
  includeDeleted: false, // Exclude deleted records by default
  tables: ['users'], // Only enable for users table
  primaryKeyColumn: 'id',
});

// ============================================================================
// 5. Create ORM with Plugin
// ============================================================================

async function setupORM() {
  // Create ORM with soft delete plugin
  const orm = await createORM(db, [softDelete]);

  // Create repository through ORM (this enables plugin features)
  const userRepo = orm.createRepository((executor) => {
    const factory = createRepositoryFactory(executor);
    return factory.create<'users', User>({
      tableName: 'users',
      mapRow: (row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        created_at: new Date(row.created_at),
        deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
      }),
      schemas: {
        create: CreateUserSchema,
        update: UpdateUserSchema,
      },
    });
  });

  return { orm, userRepo };
}

// ============================================================================
// 6. Soft Delete Examples
// ============================================================================

async function softDeleteExamples() {
  console.log('=== Soft Delete Operations ===\n');

  const { userRepo } = await setupORM();

  // Create a user
  console.log('1. Creating a user...');
  const user = await userRepo.create({
    email: 'alice@example.com',
    name: 'Alice Smith',
  });
  console.log('Created:', user);
  console.log();

  // Soft delete the user
  console.log('2. Soft deleting user...');
  const softDeleted = await userRepo.softDelete(user.id);
  console.log('Soft deleted:', softDeleted);
  console.log('deleted_at:', softDeleted.deleted_at); // Will have timestamp
  console.log();

  // Try to find the soft-deleted user (will return null)
  console.log('3. Finding soft-deleted user (excluded by default)...');
  const found = await userRepo.findById(user.id);
  console.log('Found:', found); // null - soft-deleted records are filtered out
  console.log();

  // Find all users (excludes soft-deleted)
  console.log('4. Finding all users (excludes soft-deleted)...');
  const allUsers = await userRepo.findAll();
  console.log(`Active users: ${allUsers.length}`);
  console.log();

  // Find including deleted users
  console.log('5. Finding all users including deleted...');
  const allWithDeleted = await userRepo.findAllWithDeleted();
  console.log(`All users (including deleted): ${allWithDeleted.length}`);
  console.log();

  // Find specific user including if deleted
  console.log('6. Finding specific user including if deleted...');
  const foundWithDeleted = await userRepo.findWithDeleted(user.id);
  console.log('Found with deleted:', foundWithDeleted);
  console.log();

  // Find only deleted users
  console.log('7. Finding only deleted users...');
  const deletedOnly = await userRepo.findDeleted();
  console.log(`Deleted users: ${deletedOnly.length}`);
  deletedOnly.forEach((u) => {
    console.log(`  - ${u.name} (deleted at: ${u.deleted_at})`);
  });
  console.log();
}

// ============================================================================
// 7. Restore Examples
// ============================================================================

async function restoreExamples() {
  console.log('=== Restore Operations ===\n');

  const { userRepo } = await setupORM();

  // Create and soft delete a user
  console.log('1. Creating and soft deleting a user...');
  const user = await userRepo.create({
    email: 'bob@example.com',
    name: 'Bob Johnson',
  });
  await userRepo.softDelete(user.id);
  console.log('User soft deleted');
  console.log();

  // Restore the user
  console.log('2. Restoring the user...');
  const restored = await userRepo.restore(user.id);
  console.log('Restored:', restored);
  console.log('deleted_at:', restored.deleted_at); // Will be null
  console.log();

  // User is now visible in queries again
  console.log('3. Finding restored user...');
  const found = await userRepo.findById(user.id);
  console.log('Found:', found); // User is back!
  console.log();
}

// ============================================================================
// 8. Hard Delete Examples
// ============================================================================

async function hardDeleteExamples() {
  console.log('=== Hard Delete Operations ===\n');

  const { userRepo } = await setupORM();

  // Create a user
  console.log('1. Creating a user...');
  const user = await userRepo.create({
    email: 'charlie@example.com',
    name: 'Charlie Brown',
  });
  console.log('Created:', user);
  console.log();

  // Hard delete (permanent removal)
  console.log('2. Hard deleting user (permanent)...');
  await userRepo.hardDelete(user.id);
  console.log('User permanently deleted');
  console.log();

  // User is gone forever
  console.log('3. Trying to find hard-deleted user...');
  const found = await userRepo.findWithDeleted(user.id);
  console.log('Found:', found); // null - user is gone from database
  console.log();

  // GDPR "Right to be Forgotten" example
  console.log('4. GDPR compliance - permanent deletion...');
  const gdprUser = await userRepo.create({
    email: 'gdpr@example.com',
    name: 'GDPR User',
  });
  console.log('Created GDPR user:', gdprUser.id);

  // User requests data deletion
  await userRepo.hardDelete(gdprUser.id);
  console.log('GDPR user permanently deleted - compliant with data deletion requests');
  console.log();
}

// ============================================================================
// 9. Batch Soft Delete Operations
// ============================================================================

async function batchSoftDeleteExamples() {
  console.log('=== Batch Soft Delete Operations ===\n');

  const { userRepo } = await setupORM();

  // Create multiple users
  console.log('1. Creating multiple users...');
  const users = await userRepo.bulkCreate([
    { email: 'user1@example.com', name: 'User One' },
    { email: 'user2@example.com', name: 'User Two' },
    { email: 'user3@example.com', name: 'User Three' },
    { email: 'user4@example.com', name: 'User Four' },
    { email: 'user5@example.com', name: 'User Five' },
  ]);
  console.log(`Created ${users.length} users`);
  console.log();

  // Soft delete multiple users at once (efficient single query)
  console.log('2. Soft deleting multiple users...');
  const idsToDelete = users.slice(0, 3).map((u) => u.id);
  const softDeletedUsers = await userRepo.softDeleteMany(idsToDelete);
  console.log(`Soft deleted ${softDeletedUsers.length} users`);
  console.log();

  // Check active vs deleted
  console.log('3. Checking active vs deleted users...');
  const active = await userRepo.findAll();
  const deleted = await userRepo.findDeleted();
  console.log(`Active users: ${active.length}`);
  console.log(`Deleted users: ${deleted.length}`);
  console.log();

  // Restore multiple users
  console.log('4. Restoring multiple users...');
  const restoredUsers = await userRepo.restoreMany(idsToDelete);
  console.log(`Restored ${restoredUsers.length} users`);
  console.log();

  // Hard delete multiple users
  console.log('5. Hard deleting multiple users...');
  await userRepo.hardDeleteMany(users.map((u) => u.id));
  console.log(`Hard deleted ${users.length} users`);
  console.log();
}

// ============================================================================
// 10. Transaction Support with Soft Delete
// ============================================================================

async function transactionExample() {
  console.log('=== Transaction Support ===\n');

  const { orm } = await setupORM();

  try {
    await db.transaction().execute(async (trx) => {
      // Create transaction-bound ORM
      const txOrm = await createORM(trx as unknown as Kysely<Database>, [softDelete]);

      const txUserRepo = txOrm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'users', User>({
          tableName: 'users',
          mapRow: (row) => row as User,
          schemas: { create: CreateUserSchema },
        });
      });

      // Create and soft delete in transaction
      const user = await txUserRepo.create({
        email: 'tx@example.com',
        name: 'Transaction User',
      });
      console.log('Created in transaction:', user);

      await txUserRepo.softDelete(user.id);
      console.log('Soft deleted in transaction');

      // Simulate error - both operations will rollback
      // throw new Error('Transaction rollback test');
    });

    console.log('Transaction committed successfully');
  } catch (error) {
    console.error('Transaction rolled back:', error);
  }
  console.log();
}

// ============================================================================
// 11. Cleanup Old Soft-Deleted Records
// ============================================================================

async function cleanupExample() {
  console.log('=== Cleanup Old Soft-Deleted Records ===\n');

  const { userRepo } = await setupORM();

  // Find soft-deleted records older than 30 days
  console.log('1. Finding old soft-deleted records...');
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const oldDeleted = await db
    .selectFrom('users')
    .selectAll()
    .where('deleted_at', 'is not', null)
    .where('deleted_at', '<', thirtyDaysAgo.toISOString())
    .execute();

  console.log(`Found ${oldDeleted.length} records older than 30 days`);
  console.log();

  // Hard delete old soft-deleted records
  if (oldDeleted.length > 0) {
    console.log('2. Permanently deleting old records...');
    for (const user of oldDeleted) {
      await userRepo.hardDelete(user.id);
    }
    console.log(`Cleaned up ${oldDeleted.length} old records`);
  } else {
    console.log('2. No old records to clean up');
  }
  console.log();
}

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  try {
    console.log('Kysera Soft Delete - Basic Usage Examples\n');
    console.log('==========================================\n');

    // Run examples
    await softDeleteExamples();
    await restoreExamples();
    await hardDeleteExamples();
    await batchSoftDeleteExamples();
    await transactionExample();
    await cleanupExample();

    console.log('==========================================');
    console.log('All examples completed successfully!');
  } catch (error) {
    console.error('Error running examples:', error);
  } finally {
    // Clean up
    await db.destroy();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { main, setupORM, db };
