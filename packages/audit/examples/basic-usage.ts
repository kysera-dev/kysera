/**
 * Basic usage example for @kysera/audit
 *
 * This example demonstrates:
 * - Setting up audit plugin with user tracking
 * - Automatic audit logging for all CRUD operations
 * - Querying audit history
 * - Restoring from audit logs
 * - Bulk operation auditing
 * - Transaction-aware audit logging
 */

import { Kysely, PostgresDialect, Generated } from 'kysely';
import { Pool } from 'pg';
import { z } from 'zod';
import { createORM, createRepositoryFactory } from '@kysera/repository';
import { auditPlugin } from '@kysera/audit';

// ============================================================================
// 1. Define Database Schema
// ============================================================================

/**
 * Database table structure
 */
interface Database {
  users: {
    id: Generated<number>;
    email: string;
    name: string;
    role: string;
    created_at: Generated<Date>;
  };
}

/**
 * Domain entity type
 */
interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  created_at: Date;
}

// ============================================================================
// 2. Define Validation Schemas
// ============================================================================

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user', 'guest']),
});

const UpdateUserSchema = CreateUserSchema.partial();

// ============================================================================
// 3. Setup User Context (for audit tracking)
// ============================================================================

/**
 * Simulated user context - in real app, this would come from auth middleware
 */
let currentUserId: string | null = 'admin-user';
let currentUserIp: string = '192.168.1.1';
let currentUserAgent: string = 'Mozilla/5.0 (Example)';

function setCurrentUser(userId: string, ip: string = '192.168.1.1', userAgent: string = 'Mozilla/5.0') {
  currentUserId = userId;
  currentUserIp = ip;
  currentUserAgent = userAgent;
}

// ============================================================================
// 4. Create Database Connection
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
// 5. Setup Audit Plugin
// ============================================================================

/**
 * Create audit plugin with user tracking and metadata
 *
 * Options:
 * - auditTable: Table name for storing audit logs (default: 'audit_logs')
 * - primaryKeyColumn: Primary key column name (default: 'id')
 * - captureOldValues: Capture state before changes (default: true)
 * - captureNewValues: Capture state after changes (default: true)
 * - getUserId: Function to get current user ID
 * - metadata: Function to add custom context to audit logs
 * - tables: Whitelist of tables to audit (optional)
 */
const audit = auditPlugin({
  auditTable: 'audit_logs',
  primaryKeyColumn: 'id',
  captureOldValues: true,
  captureNewValues: true,

  // Track who made changes
  getUserId: () => currentUserId,

  // Add custom metadata to audit logs
  metadata: () => ({
    ip: currentUserIp,
    userAgent: currentUserAgent,
    timestamp: new Date().toISOString(),
  }),

  // Only audit specific tables (optional)
  tables: ['users'],
});

// ============================================================================
// 6. Create ORM with Audit Plugin
// ============================================================================

async function setupORM() {
  // Create ORM with audit plugin
  const orm = await createORM(db, [audit]);

  // Create repository through ORM (this enables audit logging)
  const userRepo = orm.createRepository((executor) => {
    const factory = createRepositoryFactory(executor);
    return factory.create<'users', User>({
      tableName: 'users',
      mapRow: (row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        created_at: new Date(row.created_at),
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
// 7. Automatic Audit Logging
// ============================================================================

async function automaticAuditingExample() {
  console.log('=== Automatic Audit Logging ===\n');

  const { userRepo } = await setupORM();

  // Set current user for audit tracking
  setCurrentUser('admin-user', '192.168.1.100', 'Mozilla/5.0 (Admin Dashboard)');

  // CREATE - Automatically audited
  console.log('1. Creating a user (automatically audited)...');
  const user = await userRepo.create({
    email: 'alice@example.com',
    name: 'Alice Smith',
    role: 'user',
  });
  console.log('Created:', user);
  console.log('✓ Audit log created: INSERT operation');
  console.log();

  // UPDATE - Automatically audited with old/new values
  console.log('2. Updating user (automatically audited)...');
  const updated = await userRepo.update(user.id, {
    name: 'Alice Johnson',
    role: 'admin',
  });
  console.log('Updated:', updated);
  console.log('✓ Audit log created: UPDATE operation with old and new values');
  console.log();

  // DELETE - Automatically audited with old values
  console.log('3. Deleting user (automatically audited)...');
  await userRepo.delete(user.id);
  console.log('✓ Audit log created: DELETE operation with old values');
  console.log();
}

// ============================================================================
// 8. Querying Audit History
// ============================================================================

async function queryAuditHistoryExample() {
  console.log('=== Querying Audit History ===\n');

  const { userRepo } = await setupORM();

  setCurrentUser('admin-user');

  // Create a user and make some changes
  console.log('1. Creating user and making changes...');
  const user = await userRepo.create({
    email: 'bob@example.com',
    name: 'Bob Wilson',
    role: 'user',
  });

  await userRepo.update(user.id, { name: 'Bob Wilson Jr.' });
  await userRepo.update(user.id, { role: 'admin' });
  console.log('Created user and made 2 updates');
  console.log();

  // Get complete audit history for the user
  console.log('2. Getting audit history for user...');
  const history = await userRepo.getAuditHistory(user.id);
  console.log(`Found ${history.length} audit log entries:`);

  history.forEach((entry, index) => {
    console.log(`\n  Entry ${index + 1}:`);
    console.log(`    Operation: ${entry.operation}`);
    console.log(`    Changed by: ${entry.changed_by}`);
    console.log(`    Changed at: ${entry.changed_at}`);

    if (entry.old_values) {
      console.log(`    Old values:`, entry.old_values);
    }
    if (entry.new_values) {
      console.log(`    New values:`, entry.new_values);
    }
    if (entry.metadata) {
      console.log(`    Metadata:`, entry.metadata);
    }
  });
  console.log();

  // Get table-wide audit logs with filters
  console.log('3. Getting all UPDATE operations...');
  const updates = await userRepo.getTableAuditLogs({
    operation: 'UPDATE',
  });
  console.log(`Found ${updates.length} UPDATE operations`);
  console.log();

  // Get changes by specific user
  console.log('4. Getting changes by admin-user...');
  const adminChanges = await userRepo.getUserChanges('admin-user');
  console.log(`Admin made ${adminChanges.length} changes`);
  console.log();
}

// ============================================================================
// 9. Restoring from Audit Logs
// ============================================================================

async function restoreFromAuditExample() {
  console.log('=== Restoring from Audit Logs ===\n');

  const { userRepo } = await setupORM();

  setCurrentUser('admin-user');

  // Create and delete a user
  console.log('1. Creating and deleting a user...');
  const user = await userRepo.create({
    email: 'charlie@example.com',
    name: 'Charlie Brown',
    role: 'user',
  });
  console.log('Created:', user);

  await userRepo.delete(user.id);
  console.log('Deleted user');
  console.log();

  // Find the DELETE audit log
  console.log('2. Finding DELETE audit log...');
  const deleteLogs = await userRepo.getTableAuditLogs({
    operation: 'DELETE',
  });

  if (deleteLogs.length > 0) {
    const deleteLog = deleteLogs[0];
    console.log('Found DELETE log:', deleteLog.id);
    console.log('Old values:', deleteLog.old_values);
    console.log();

    // Restore the deleted user
    console.log('3. Restoring user from audit log...');
    const restored = await userRepo.restoreFromAudit(deleteLog.id);
    console.log('Restored:', restored);
    console.log('✓ User re-created from audit log old_values');
  }
  console.log();

  // Revert an update
  console.log('4. Reverting an update...');
  const user2 = await userRepo.create({
    email: 'diana@example.com',
    name: 'Diana Prince',
    role: 'user',
  });

  await userRepo.update(user2.id, {
    name: 'Diana Prince-Wayne',
    role: 'admin',
  });
  console.log('Updated user');

  const updateLogs = await userRepo.getAuditHistory(user2.id);
  const updateLog = updateLogs.find((log) => log.operation === 'UPDATE');

  if (updateLog) {
    console.log('Reverting update...');
    const reverted = await userRepo.restoreFromAudit(updateLog.id);
    console.log('Reverted to:', reverted);
    console.log('✓ User reverted to old_values before update');
  }
  console.log();
}

// ============================================================================
// 10. Bulk Operations Auditing
// ============================================================================

async function bulkOperationsExample() {
  console.log('=== Bulk Operations Auditing ===\n');

  const { userRepo } = await setupORM();

  setCurrentUser('admin-user');

  // Bulk create
  console.log('1. Bulk creating users (all audited)...');
  const users = await userRepo.bulkCreate([
    { email: 'user1@example.com', name: 'User One', role: 'user' },
    { email: 'user2@example.com', name: 'User Two', role: 'user' },
    { email: 'user3@example.com', name: 'User Three', role: 'user' },
  ]);
  console.log(`Created ${users.length} users`);
  console.log('✓ 3 INSERT audit logs created');
  console.log();

  // Bulk update
  console.log('2. Bulk updating users (all audited with old/new values)...');
  const updates = users.map((user) => ({
    id: user.id,
    data: { role: 'admin' },
  }));
  await userRepo.bulkUpdate(updates);
  console.log(`Updated ${users.length} users`);
  console.log('✓ 3 UPDATE audit logs created with old and new values');
  console.log();

  // Bulk delete
  console.log('3. Bulk deleting users (all audited with old values)...');
  await userRepo.bulkDelete(users.map((u) => u.id));
  console.log(`Deleted ${users.length} users`);
  console.log('✓ 3 DELETE audit logs created with old values');
  console.log();
}

// ============================================================================
// 11. Transaction-Aware Auditing
// ============================================================================

async function transactionExample() {
  console.log('=== Transaction-Aware Auditing ===\n');

  setCurrentUser('admin-user');

  // Successful transaction - audit logs commit
  console.log('1. Successful transaction...');
  try {
    await db.transaction().execute(async (trx) => {
      // Create transaction-bound ORM with audit plugin
      const txOrm = await createORM(trx as unknown as Kysely<Database>, [audit]);

      const txUserRepo = txOrm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'users', User>({
          tableName: 'users',
          mapRow: (row) => row as User,
          schemas: { create: CreateUserSchema },
        });
      });

      const user1 = await txUserRepo.create({
        email: 'tx1@example.com',
        name: 'Transaction User 1',
        role: 'user',
      });
      console.log('  Created user 1:', user1.id);

      const user2 = await txUserRepo.create({
        email: 'tx2@example.com',
        name: 'Transaction User 2',
        role: 'user',
      });
      console.log('  Created user 2:', user2.id);
    });

    console.log('✓ Transaction committed - both users and audit logs persisted');
  } catch (error) {
    console.error('Transaction failed:', error);
  }
  console.log();

  // Failed transaction - audit logs rollback
  console.log('2. Failed transaction (rollback)...');
  try {
    await db.transaction().execute(async (trx) => {
      const txOrm = await createORM(trx as unknown as Kysely<Database>, [audit]);

      const txUserRepo = txOrm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'users', User>({
          tableName: 'users',
          mapRow: (row) => row as User,
          schemas: { create: CreateUserSchema },
        });
      });

      const user = await txUserRepo.create({
        email: 'rollback@example.com',
        name: 'Rollback User',
        role: 'user',
      });
      console.log('  Created user:', user.id);

      // Simulate error
      throw new Error('Simulated transaction error');
    });
  } catch (error) {
    console.log('✓ Transaction rolled back - user and audit log both rolled back');
  }
  console.log();
}

// ============================================================================
// 12. User Attribution Example
// ============================================================================

async function userAttributionExample() {
  console.log('=== User Attribution ===\n');

  const { userRepo } = await setupORM();

  // Simulate different users making changes
  console.log('1. Admin user creates a user...');
  setCurrentUser('admin-123', '192.168.1.100', 'Admin Dashboard');
  const user = await userRepo.create({
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
  });
  console.log('Created by admin-123');
  console.log();

  console.log('2. Regular user updates the user...');
  setCurrentUser('user-456', '192.168.1.200', 'Web App');
  await userRepo.update(user.id, { name: 'Updated User' });
  console.log('Updated by user-456');
  console.log();

  console.log('3. System deletes the user...');
  setCurrentUser('system', '127.0.0.1', 'Automated Cleanup');
  await userRepo.delete(user.id);
  console.log('Deleted by system');
  console.log();

  // Query audit history to see different users
  console.log('4. Audit history showing different users:');
  const history = await userRepo.getAuditHistory(user.id);
  history.forEach((entry) => {
    console.log(`  ${entry.operation} by ${entry.changed_by}`);
    if (entry.metadata) {
      const meta = entry.metadata;
      console.log(`    From IP: ${meta.ip}, User-Agent: ${meta.userAgent}`);
    }
  });
  console.log();
}

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  try {
    console.log('Kysera Audit - Basic Usage Examples\n');
    console.log('==========================================\n');

    // Run examples
    await automaticAuditingExample();
    await queryAuditHistoryExample();
    await restoreFromAuditExample();
    await bulkOperationsExample();
    await transactionExample();
    await userAttributionExample();

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

export { main, setupORM, db, setCurrentUser };
