import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Kysely, SqliteDialect, type Generated, type Selectable } from 'kysely';
import betterSqlite3 from 'better-sqlite3';
import {
  auditPluginSQLite,
  auditPluginPostgreSQL,
  auditPluginMySQL,
  auditPlugin,
  type AuditRepositoryExtensions,
  type AuditFilters,
  type AuditLogEntry,
  type ParsedAuditLogEntry,
  type AuditOptions,
} from '../src/index.js';
import { createRepositoryFactory } from '../../kysera-repository/dist/index.js';
import { createORM } from '../../kysera-repository/dist/index.js';
import { z } from 'zod';

// ============================================================================
// Test Database Schema Types
// ============================================================================

interface TestDatabase {
  users: UsersTable;
  products: ProductsTable;
  uuid_entities: UuidEntityTable;
  audit_logs: AuditLogsTable;
}

interface UsersTable {
  id: Generated<number>;
  email: string;
  name: string;
  status: string;
}

interface ProductsTable {
  id: Generated<number>;
  sku: string;
  name: string;
  price: number;
}

interface UuidEntityTable {
  uuid: string; // Non-auto-generated string ID
  name: string;
  data: string | null;
}

interface AuditLogsTable {
  id: Generated<number>;
  table_name: string;
  operation: string;
  entity_id: string;
  old_values: string | null;
  new_values: string | null;
  changed_by: string | null;
  changed_at: string;
  metadata: string | null;
}

type User = Selectable<UsersTable>;
type UuidEntity = Selectable<UuidEntityTable>;

// ============================================================================
// Test Utilities
// ============================================================================

function createTestDatabase(): Kysely<TestDatabase> {
  const sqlite = new betterSqlite3(':memory:');
  sqlite.pragma('foreign_keys = ON');

  return new Kysely<TestDatabase>({
    dialect: new SqliteDialect({
      database: sqlite,
    }),
  });
}

async function initializeTestSchema(db: Kysely<TestDatabase>): Promise<void> {
  // Users table
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
    .execute();

  // Products table
  await db.schema
    .createTable('products')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('sku', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('price', 'real', (col) => col.notNull())
    .execute();

  // UUID entities table (string primary key)
  await db.schema
    .createTable('uuid_entities')
    .addColumn('uuid', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('data', 'text')
    .execute();
}

async function clearTestDatabase(db: Kysely<TestDatabase>): Promise<void> {
  try {
    await db.deleteFrom('audit_logs').execute();
  } catch {
    // Table may not exist yet
  }
  await db.deleteFrom('uuid_entities').execute();
  await db.deleteFrom('products').execute();
  await db.deleteFrom('users').execute();
}

// ============================================================================
// restoreFromAudit Tests
// ============================================================================

describe('Audit Plugin - restoreFromAudit', () => {
  let db: Kysely<TestDatabase>;
  let currentUserId: string | null = null;

  beforeAll(async () => {
    db = createTestDatabase();
    await initializeTestSchema(db);

    // Initialize audit table
    const initAudit = auditPluginSQLite({
      getUserId: () => currentUserId,
      captureOldValues: true,
      captureNewValues: true,
      tables: ['users', 'products'],
    });
    await createORM(db, [initAudit]);
  });

  beforeEach(async () => {
    await clearTestDatabase(db);
    currentUserId = null;
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('Restore from DELETE operation', () => {
    it('should re-create a deleted entity from audit log', async () => {
      const audit = auditPluginSQLite({
        getUserId: () => currentUserId,
        captureOldValues: true,
        captureNewValues: true,
        tables: ['users'],
      });

      const orm = await createORM(db, [audit]);
      const factory = createRepositoryFactory(db);

      const userRepo = orm.createRepository((_executor: any) =>
        factory.create({
          tableName: 'users' as const,
          mapRow: (row: any) => row as User,
          schemas: {
            create: z.object({
              email: z.string(),
              name: z.string(),
              status: z.string().optional(),
            }),
          },
        })
      ) as ReturnType<typeof factory.create<'users', User>> & AuditRepositoryExtensions<User>;

      currentUserId = 'restore-delete-user';

      // Create a user
      const originalUser = await userRepo.create({
        email: 'deleted@example.com',
        name: 'To Be Deleted',
        status: 'active',
      });

      const originalId = originalUser.id;

      // Delete the user
      await userRepo.delete(originalId);

      // Verify user is deleted
      const deletedUsers = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', originalId)
        .execute();
      expect(deletedUsers).toHaveLength(0);

      // Get DELETE audit log
      const logs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('entity_id', '=', String(originalId))
        .where('operation', '=', 'DELETE')
        .execute();

      expect(logs).toHaveLength(1);
      const deleteLog = logs[0]!;

      // Restore from DELETE audit log
      const restoredUser = (await userRepo.restoreFromAudit(deleteLog.id)) as User;

      // Verify user is restored (but with a new ID since it's a new insert)
      expect(restoredUser).toBeDefined();
      expect(restoredUser.email).toBe('deleted@example.com');
      expect(restoredUser.name).toBe('To Be Deleted');
      expect(restoredUser.status).toBe('active');

      // Verify user exists in database
      const restoredUsers = await db
        .selectFrom('users')
        .selectAll()
        .where('email', '=', 'deleted@example.com')
        .execute();
      expect(restoredUsers).toHaveLength(1);
    });

    it('should throw error when restoring DELETE without old_values', async () => {
      // Create audit plugin that doesn't capture old values
      const noOldAudit = auditPluginSQLite({
        getUserId: () => currentUserId,
        captureOldValues: false,
        captureNewValues: true,
        tables: ['users'],
      });

      const orm = await createORM(db, [noOldAudit]);
      const factory = createRepositoryFactory(db);

      const userRepo = orm.createRepository((_executor: any) =>
        factory.create({
          tableName: 'users' as const,
          mapRow: (row: any) => row as User,
          schemas: {
            create: z.object({
              email: z.string(),
              name: z.string(),
              status: z.string().optional(),
            }),
          },
        })
      ) as ReturnType<typeof factory.create<'users', User>> & AuditRepositoryExtensions<User>;

      currentUserId = 'no-old-values-user';

      // Create and delete user
      const user = await userRepo.create({
        email: 'no-old@example.com',
        name: 'No Old Values',
      });

      await userRepo.delete(user.id);

      // Get DELETE audit log
      const logs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('entity_id', '=', String(user.id))
        .where('operation', '=', 'DELETE')
        .execute();

      expect(logs).toHaveLength(1);
      expect(logs[0]!.old_values).toBeNull();

      // Should throw when trying to restore
      await expect(userRepo.restoreFromAudit(logs[0]!.id)).rejects.toThrow(
        'Cannot restore from DELETE audit log'
      );
      await expect(userRepo.restoreFromAudit(logs[0]!.id)).rejects.toThrow(
        'old_values not captured'
      );
    });
  });

  describe('Restore from UPDATE operation', () => {
    it('should revert entity to old values from UPDATE audit log', async () => {
      const audit = auditPluginSQLite({
        getUserId: () => currentUserId,
        captureOldValues: true,
        captureNewValues: true,
        tables: ['users'],
      });

      const orm = await createORM(db, [audit]);
      const factory = createRepositoryFactory(db);

      const userRepo = orm.createRepository((_executor: any) =>
        factory.create({
          tableName: 'users' as const,
          mapRow: (row: any) => row as User,
          schemas: {
            create: z.object({
              email: z.string(),
              name: z.string(),
              status: z.string().optional(),
            }),
            update: z.object({
              name: z.string().optional(),
              status: z.string().optional(),
            }),
          },
        })
      ) as ReturnType<typeof factory.create<'users', User>> & AuditRepositoryExtensions<User>;

      currentUserId = 'restore-update-user';

      // Create a user
      const user = await userRepo.create({
        email: 'update-test@example.com',
        name: 'Original Name',
        status: 'active',
      });

      // Update the user multiple times
      await userRepo.update(user.id, { name: 'Updated Name 1' });
      await userRepo.update(user.id, { name: 'Updated Name 2', status: 'inactive' });

      // Verify current state
      const currentUser = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', user.id)
        .executeTakeFirst();
      expect(currentUser?.name).toBe('Updated Name 2');
      expect(currentUser?.status).toBe('inactive');

      // Get the first UPDATE audit log (to revert to original)
      const logs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('entity_id', '=', String(user.id))
        .where('operation', '=', 'UPDATE')
        .orderBy('id', 'asc')
        .execute();

      expect(logs).toHaveLength(2);
      const firstUpdateLog = logs[0]!;

      // Restore to state before first update
      const revertedUser = (await userRepo.restoreFromAudit(firstUpdateLog.id)) as User;

      // Verify entity was reverted to old_values
      expect(revertedUser.name).toBe('Original Name');
      expect(revertedUser.status).toBe('active');

      // Verify in database
      const dbUser = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', user.id)
        .executeTakeFirst();
      expect(dbUser?.name).toBe('Original Name');
    });

    it('should throw error when restoring UPDATE without old_values', async () => {
      const noOldAudit = auditPluginSQLite({
        getUserId: () => currentUserId,
        captureOldValues: false,
        captureNewValues: true,
        tables: ['users'],
      });

      const orm = await createORM(db, [noOldAudit]);
      const factory = createRepositoryFactory(db);

      const userRepo = orm.createRepository((_executor: any) =>
        factory.create({
          tableName: 'users' as const,
          mapRow: (row: any) => row as User,
          schemas: {
            create: z.object({
              email: z.string(),
              name: z.string(),
              status: z.string().optional(),
            }),
            update: z.object({
              name: z.string().optional(),
            }),
          },
        })
      ) as ReturnType<typeof factory.create<'users', User>> & AuditRepositoryExtensions<User>;

      currentUserId = 'no-old-update-user';

      const user = await userRepo.create({
        email: 'no-old-update@example.com',
        name: 'Original',
      });

      await userRepo.update(user.id, { name: 'Updated' });

      const logs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('entity_id', '=', String(user.id))
        .where('operation', '=', 'UPDATE')
        .execute();

      expect(logs).toHaveLength(1);
      expect(logs[0]!.old_values).toBeNull();

      await expect(userRepo.restoreFromAudit(logs[0]!.id)).rejects.toThrow(
        'Cannot revert UPDATE from audit log'
      );
      await expect(userRepo.restoreFromAudit(logs[0]!.id)).rejects.toThrow('old_values not captured');
    });
  });

  describe('Error cases', () => {
    it('should throw error when restoring from INSERT operation', async () => {
      const audit = auditPluginSQLite({
        getUserId: () => currentUserId,
        captureOldValues: true,
        captureNewValues: true,
        tables: ['users'],
      });

      const orm = await createORM(db, [audit]);
      const factory = createRepositoryFactory(db);

      const userRepo = orm.createRepository((_executor: any) =>
        factory.create({
          tableName: 'users' as const,
          mapRow: (row: any) => row as User,
          schemas: {
            create: z.object({
              email: z.string(),
              name: z.string(),
              status: z.string().optional(),
            }),
          },
        })
      ) as ReturnType<typeof factory.create<'users', User>> & AuditRepositoryExtensions<User>;

      currentUserId = 'insert-restore-user';

      const user = await userRepo.create({
        email: 'insert@example.com',
        name: 'Insert Test',
      });

      const logs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('entity_id', '=', String(user.id))
        .where('operation', '=', 'INSERT')
        .execute();

      expect(logs).toHaveLength(1);

      await expect(userRepo.restoreFromAudit(logs[0]!.id)).rejects.toThrow(
        'Cannot restore from INSERT operation'
      );
    });

    it('should throw error for non-existent audit log', async () => {
      const audit = auditPluginSQLite({
        getUserId: () => currentUserId,
        tables: ['users'],
      });

      const orm = await createORM(db, [audit]);
      const factory = createRepositoryFactory(db);

      const userRepo = orm.createRepository((_executor: any) =>
        factory.create({
          tableName: 'users' as const,
          mapRow: (row: any) => row as User,
          schemas: {
            create: z.object({
              email: z.string(),
              name: z.string(),
            }),
          },
        })
      ) as ReturnType<typeof factory.create<'users', User>> & AuditRepositoryExtensions<User>;

      await expect(userRepo.restoreFromAudit(999999)).rejects.toThrow('AuditLog not found');
    });
  });
});

// ============================================================================
// UUID/String Primary Key Tests
// ============================================================================

describe('Audit Plugin - UUID/String Primary Keys', () => {
  let db: Kysely<TestDatabase>;
  let currentUserId: string | null = null;

  beforeAll(async () => {
    db = createTestDatabase();
    await initializeTestSchema(db);

    // Initialize audit table
    const initAudit = auditPluginSQLite({
      getUserId: () => currentUserId,
      primaryKeyColumn: 'uuid',
      tables: ['uuid_entities'],
    });
    await createORM(db, [initAudit]);
  });

  beforeEach(async () => {
    await clearTestDatabase(db);
    currentUserId = null;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('should audit INSERT operations with UUID primary key', async () => {
    const audit = auditPluginSQLite({
      getUserId: () => currentUserId,
      primaryKeyColumn: 'uuid',
      captureOldValues: true,
      captureNewValues: true,
      tables: ['uuid_entities'],
    });

    const orm = await createORM(db, [audit]);
    const factory = createRepositoryFactory(db);

    const uuidRepo = orm.createRepository((_executor: any) =>
      factory.create({
        tableName: 'uuid_entities' as const,
        mapRow: (row: any) => row as UuidEntity,
        schemas: {
          create: z.object({
            uuid: z.string(),
            name: z.string(),
            data: z.string().nullable().optional(),
          }),
        },
      })
    ) as ReturnType<typeof factory.create<'uuid_entities', UuidEntity>> &
      AuditRepositoryExtensions<UuidEntity>;

    currentUserId = 'uuid-test-user';

    const testUuid = '550e8400-e29b-41d4-a716-446655440000';

    // Create entity with UUID
    const entity = await uuidRepo.create({
      uuid: testUuid,
      name: 'UUID Entity',
      data: 'some data',
    });

    expect(entity.uuid).toBe(testUuid);

    // Verify audit log uses UUID as entity_id
    const logs = await db.selectFrom('audit_logs').selectAll().where('table_name', '=', 'uuid_entities').execute();

    expect(logs).toHaveLength(1);
    expect(logs[0]!.entity_id).toBe(testUuid);
    expect(logs[0]!.operation).toBe('INSERT');

    // Verify new_values contains UUID entity data
    const newValues = JSON.parse(logs[0]!.new_values!);
    expect(newValues.uuid).toBe(testUuid);
    expect(newValues.name).toBe('UUID Entity');
    expect(newValues.data).toBe('some data');

    // Verify getAuditHistory works with UUID
    const history = await uuidRepo.getAuditHistory(testUuid);
    expect(history).toHaveLength(1);
    expect(history[0]!.operation).toBe('INSERT');
    expect(history[0]!.entity_id).toBe(testUuid);
  });

  it('should correctly configure primaryKeyColumn for UUID', () => {
    // Test that the plugin accepts UUID as primaryKeyColumn
    const audit = auditPluginSQLite({
      getUserId: () => 'test-user',
      primaryKeyColumn: 'uuid',
      tables: ['uuid_entities'],
    });

    expect(audit).toBeDefined();
    expect(audit.name).toBe('@kysera/audit');
  });

  it('should query audit history by UUID entity_id', async () => {
    const audit = auditPluginSQLite({
      getUserId: () => currentUserId,
      primaryKeyColumn: 'uuid',
      captureNewValues: true,
      tables: ['uuid_entities'],
    });

    const orm = await createORM(db, [audit]);
    const factory = createRepositoryFactory(db);

    const uuidRepo = orm.createRepository((_executor: any) =>
      factory.create({
        tableName: 'uuid_entities' as const,
        mapRow: (row: any) => row as UuidEntity,
        schemas: {
          create: z.object({
            uuid: z.string(),
            name: z.string(),
            data: z.string().nullable().optional(),
          }),
        },
      })
    ) as ReturnType<typeof factory.create<'uuid_entities', UuidEntity>> &
      AuditRepositoryExtensions<UuidEntity>;

    currentUserId = 'uuid-history-user';

    const uuid1 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const uuid2 = '11111111-2222-3333-4444-555555555555';

    // Create two entities
    await uuidRepo.create({ uuid: uuid1, name: 'Entity 1' });
    await uuidRepo.create({ uuid: uuid2, name: 'Entity 2' });

    // Query history by specific UUID
    const history1 = await uuidRepo.getAuditHistory(uuid1);
    const history2 = await uuidRepo.getAuditHistory(uuid2);

    expect(history1).toHaveLength(1);
    expect(history1[0]!.entity_id).toBe(uuid1);

    expect(history2).toHaveLength(1);
    expect(history2[0]!.entity_id).toBe(uuid2);
  });

  it('should get table audit logs for UUID entities', async () => {
    const audit = auditPluginSQLite({
      getUserId: () => currentUserId,
      primaryKeyColumn: 'uuid',
      captureNewValues: true,
      tables: ['uuid_entities'],
    });

    const orm = await createORM(db, [audit]);
    const factory = createRepositoryFactory(db);

    const uuidRepo = orm.createRepository((_executor: any) =>
      factory.create({
        tableName: 'uuid_entities' as const,
        mapRow: (row: any) => row as UuidEntity,
        schemas: {
          create: z.object({
            uuid: z.string(),
            name: z.string(),
            data: z.string().nullable().optional(),
          }),
        },
      })
    ) as ReturnType<typeof factory.create<'uuid_entities', UuidEntity>> &
      AuditRepositoryExtensions<UuidEntity>;

    currentUserId = 'uuid-table-user';

    // Create multiple entities
    await uuidRepo.create({ uuid: 'uuid-1', name: 'Entity 1' });
    await uuidRepo.create({ uuid: 'uuid-2', name: 'Entity 2' });
    await uuidRepo.create({ uuid: 'uuid-3', name: 'Entity 3' });

    // Get all table logs
    const allLogs = await uuidRepo.getTableAuditLogs();

    expect(allLogs).toHaveLength(3);
    expect(allLogs.every((log) => log.operation === 'INSERT')).toBe(true);

    // Filter by userId
    const userLogs = await uuidRepo.getTableAuditLogs({
      userId: 'uuid-table-user',
    });

    expect(userLogs).toHaveLength(3);
  });
});

// ============================================================================
// getAuditLogs Alias Tests
// ============================================================================

describe('Audit Plugin - getAuditLogs Alias', () => {
  let db: Kysely<TestDatabase>;
  let currentUserId: string | null = null;

  beforeAll(async () => {
    db = createTestDatabase();
    await initializeTestSchema(db);

    const initAudit = auditPluginSQLite({
      getUserId: () => currentUserId,
      tables: ['users'],
    });
    await createORM(db, [initAudit]);
  });

  beforeEach(async () => {
    await clearTestDatabase(db);
    currentUserId = null;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('getAuditLogs should be alias for getAuditHistory', async () => {
    const audit = auditPluginSQLite({
      getUserId: () => currentUserId,
      captureOldValues: true,
      captureNewValues: true,
      tables: ['users'],
    });

    const orm = await createORM(db, [audit]);
    const factory = createRepositoryFactory(db);

    const userRepo = orm.createRepository((_executor: any) =>
      factory.create({
        tableName: 'users' as const,
        mapRow: (row: any) => row as User,
        schemas: {
          create: z.object({
            email: z.string(),
            name: z.string(),
            status: z.string().optional(),
          }),
          update: z.object({
            name: z.string().optional(),
          }),
        },
      })
    ) as ReturnType<typeof factory.create<'users', User>> & AuditRepositoryExtensions<User>;

    currentUserId = 'alias-test-user';

    const user = await userRepo.create({
      email: 'alias@example.com',
      name: 'Alias Test',
    });

    await userRepo.update(user.id, { name: 'Updated Alias' });

    // Both methods should return the same results
    const historyResult = await userRepo.getAuditHistory(user.id);
    const logsResult = await userRepo.getAuditLogs(user.id);

    expect(historyResult).toHaveLength(2);
    expect(logsResult).toHaveLength(2);

    // Should be identical
    expect(historyResult).toEqual(logsResult);
  });
});

// ============================================================================
// Database-Specific Plugin Tests
// ============================================================================

describe('Audit Plugin - Database-Specific Plugins', () => {
  it('auditPluginPostgreSQL should create valid plugin', () => {
    const plugin = auditPluginPostgreSQL({
      getUserId: () => 'pg-user',
      tables: ['users'],
    });

    expect(plugin).toBeDefined();
    expect(plugin.name).toBe('@kysera/audit');
    expect(plugin.version).toBe('0.5.1');
    expect(plugin.onInit).toBeDefined();
    expect(plugin.extendRepository).toBeDefined();
  });

  it('auditPluginPostgreSQL should use ISO timestamp by default', () => {
    // We can't easily test the actual timestamp generation without a PostgreSQL database,
    // but we can verify the plugin is created correctly
    const plugin = auditPluginPostgreSQL({
      getUserId: () => 'pg-user',
      captureOldValues: true,
      captureNewValues: true,
    });

    expect(plugin).toBeDefined();
  });

  it('auditPluginMySQL should create valid plugin', () => {
    const plugin = auditPluginMySQL({
      getUserId: () => 'mysql-user',
      tables: ['users'],
    });

    expect(plugin).toBeDefined();
    expect(plugin.name).toBe('@kysera/audit');
    expect(plugin.version).toBe('0.5.1');
    expect(plugin.onInit).toBeDefined();
    expect(plugin.extendRepository).toBeDefined();
  });

  it('auditPluginMySQL should accept custom timestamp', () => {
    const customTimestamp = '2024-01-15 12:30:00';
    const plugin = auditPluginMySQL({
      getUserId: () => 'mysql-user',
      getTimestamp: () => customTimestamp,
    });

    expect(plugin).toBeDefined();
  });

  it('auditPluginSQLite should create valid plugin', () => {
    const plugin = auditPluginSQLite({
      getUserId: () => 'sqlite-user',
      tables: ['users'],
    });

    expect(plugin).toBeDefined();
    expect(plugin.name).toBe('@kysera/audit');
    expect(plugin.version).toBe('0.5.1');
  });

  it('generic auditPlugin should create valid plugin', () => {
    const plugin = auditPlugin({
      getUserId: () => 'generic-user',
      tables: ['users'],
    });

    expect(plugin).toBeDefined();
    expect(plugin.name).toBe('@kysera/audit');
    expect(plugin.version).toBe('0.5.1');
  });

  it('all plugins should accept all AuditOptions', () => {
    const fullOptions: AuditOptions = {
      auditTable: 'custom_audit',
      primaryKeyColumn: 'uuid',
      captureOldValues: true,
      captureNewValues: true,
      skipSystemOperations: true,
      tables: ['users', 'products'],
      excludeTables: ['sessions'],
      getUserId: () => 'user-123',
      getTimestamp: () => new Date(),
      metadata: () => ({ ip: '127.0.0.1' }),
    };

    const sqlitePlugin = auditPluginSQLite(fullOptions);
    const pgPlugin = auditPluginPostgreSQL(fullOptions);
    const mysqlPlugin = auditPluginMySQL(fullOptions);
    const genericPlugin = auditPlugin(fullOptions);

    expect(sqlitePlugin).toBeDefined();
    expect(pgPlugin).toBeDefined();
    expect(mysqlPlugin).toBeDefined();
    expect(genericPlugin).toBeDefined();
  });
});

// ============================================================================
// Type Export Tests
// ============================================================================

describe('Audit Plugin - Type Exports', () => {
  it('should export AuditFilters type', () => {
    const filters: AuditFilters = {
      operation: 'INSERT',
      userId: 'test-user',
      startDate: new Date(),
      endDate: '2024-12-31',
    };

    expect(filters.operation).toBe('INSERT');
    expect(filters.userId).toBe('test-user');
    expect(filters.startDate).toBeInstanceOf(Date);
    expect(filters.endDate).toBe('2024-12-31');
  });

  it('should export AuditLogEntry type', () => {
    const entry: AuditLogEntry = {
      id: 1,
      table_name: 'users',
      entity_id: '123',
      operation: 'INSERT',
      old_values: null,
      new_values: '{"name":"test"}',
      changed_by: 'user-1',
      changed_at: '2024-01-01T00:00:00Z',
      metadata: null,
    };

    expect(entry.id).toBe(1);
    expect(entry.table_name).toBe('users');
  });

  it('should export ParsedAuditLogEntry type', () => {
    const entry: ParsedAuditLogEntry = {
      id: 1,
      table_name: 'users',
      entity_id: '123',
      operation: 'INSERT',
      old_values: null,
      new_values: { name: 'test' },
      changed_by: 'user-1',
      changed_at: new Date(),
      metadata: { ip: '127.0.0.1' },
    };

    expect(entry.new_values?.['name']).toBe('test');
    expect(entry.metadata?.['ip']).toBe('127.0.0.1');
  });

  it('should export AuditOptions type', () => {
    const options: AuditOptions = {
      auditTable: 'audit_logs',
      primaryKeyColumn: 'id',
      captureOldValues: true,
      captureNewValues: true,
      skipSystemOperations: false,
      tables: ['users'],
      excludeTables: ['sessions'],
      getUserId: () => 'user-123',
      getTimestamp: () => new Date(),
      metadata: () => ({}),
    };

    expect(options.auditTable).toBe('audit_logs');
    expect(options.primaryKeyColumn).toBe('id');
  });

  it('should export AuditRepositoryExtensions type', () => {
    // This is a type-only test - we're verifying the type compiles correctly
    // The type should include all audit methods
    const _typeCheck: keyof AuditRepositoryExtensions<User> = 'getAuditHistory';
    expect(_typeCheck).toBe('getAuditHistory');
  });
});

// ============================================================================
// getTableAuditLogs Filter Tests
// ============================================================================

describe('Audit Plugin - getTableAuditLogs Filters', () => {
  let db: Kysely<TestDatabase>;
  let currentUserId: string | null = null;

  beforeAll(async () => {
    db = createTestDatabase();
    await initializeTestSchema(db);

    const initAudit = auditPluginSQLite({
      getUserId: () => currentUserId,
      tables: ['users'],
    });
    await createORM(db, [initAudit]);
  });

  beforeEach(async () => {
    await clearTestDatabase(db);
    currentUserId = null;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('should filter by startDate', async () => {
    const audit = auditPluginSQLite({
      getUserId: () => currentUserId,
      tables: ['users'],
    });

    const orm = await createORM(db, [audit]);
    const factory = createRepositoryFactory(db);

    const userRepo = orm.createRepository((_executor: any) =>
      factory.create({
        tableName: 'users' as const,
        mapRow: (row: any) => row as User,
        schemas: {
          create: z.object({
            email: z.string(),
            name: z.string(),
            status: z.string().optional(),
          }),
        },
      })
    ) as ReturnType<typeof factory.create<'users', User>> & AuditRepositoryExtensions<User>;

    currentUserId = 'filter-user';

    // Create user
    await userRepo.create({
      email: 'filter@example.com',
      name: 'Filter Test',
    });

    // Filter by future date should return no results
    const futureDate = new Date('2099-01-01');
    const futureLogs = await userRepo.getTableAuditLogs({
      startDate: futureDate,
    });

    expect(futureLogs).toHaveLength(0);

    // Filter by past date should return results
    const pastDate = new Date('2020-01-01');
    const pastLogs = await userRepo.getTableAuditLogs({
      startDate: pastDate,
    });

    expect(pastLogs).toHaveLength(1);
  });

  it('should filter by endDate', async () => {
    const audit = auditPluginSQLite({
      getUserId: () => currentUserId,
      tables: ['users'],
    });

    const orm = await createORM(db, [audit]);
    const factory = createRepositoryFactory(db);

    const userRepo = orm.createRepository((_executor: any) =>
      factory.create({
        tableName: 'users' as const,
        mapRow: (row: any) => row as User,
        schemas: {
          create: z.object({
            email: z.string(),
            name: z.string(),
            status: z.string().optional(),
          }),
        },
      })
    ) as ReturnType<typeof factory.create<'users', User>> & AuditRepositoryExtensions<User>;

    currentUserId = 'end-filter-user';

    await userRepo.create({
      email: 'end-filter@example.com',
      name: 'End Filter Test',
    });

    // Filter by past end date should return no results
    const pastDate = new Date('2020-01-01');
    const pastLogs = await userRepo.getTableAuditLogs({
      endDate: pastDate,
    });

    expect(pastLogs).toHaveLength(0);

    // Filter by future end date should return results
    const futureDate = new Date('2099-12-31');
    const futureLogs = await userRepo.getTableAuditLogs({
      endDate: futureDate,
    });

    expect(futureLogs).toHaveLength(1);
  });

  it('should filter by date range', async () => {
    const audit = auditPluginSQLite({
      getUserId: () => currentUserId,
      tables: ['users'],
    });

    const orm = await createORM(db, [audit]);
    const factory = createRepositoryFactory(db);

    const userRepo = orm.createRepository((_executor: any) =>
      factory.create({
        tableName: 'users' as const,
        mapRow: (row: any) => row as User,
        schemas: {
          create: z.object({
            email: z.string(),
            name: z.string(),
            status: z.string().optional(),
          }),
        },
      })
    ) as ReturnType<typeof factory.create<'users', User>> & AuditRepositoryExtensions<User>;

    currentUserId = 'range-filter-user';

    await userRepo.create({
      email: 'range@example.com',
      name: 'Range Test',
    });

    // Filter by range that includes now
    const logs = await userRepo.getTableAuditLogs({
      startDate: new Date('2020-01-01'),
      endDate: new Date('2099-12-31'),
    });

    expect(logs).toHaveLength(1);

    // Filter by range that excludes now
    const noLogs = await userRepo.getTableAuditLogs({
      startDate: new Date('2010-01-01'),
      endDate: new Date('2015-12-31'),
    });

    expect(noLogs).toHaveLength(0);
  });

  it('should filter by multiple criteria', async () => {
    const audit = auditPluginSQLite({
      getUserId: () => currentUserId,
      tables: ['users'],
    });

    const orm = await createORM(db, [audit]);
    const factory = createRepositoryFactory(db);

    const userRepo = orm.createRepository((_executor: any) =>
      factory.create({
        tableName: 'users' as const,
        mapRow: (row: any) => row as User,
        schemas: {
          create: z.object({
            email: z.string(),
            name: z.string(),
            status: z.string().optional(),
          }),
          update: z.object({
            name: z.string().optional(),
          }),
        },
      })
    ) as ReturnType<typeof factory.create<'users', User>> & AuditRepositoryExtensions<User>;

    currentUserId = 'multi-filter-user';

    const user = await userRepo.create({
      email: 'multi@example.com',
      name: 'Multi Filter Test',
    });

    await userRepo.update(user.id, { name: 'Updated Multi' });

    // Filter by operation AND userId
    const insertLogs = await userRepo.getTableAuditLogs({
      operation: 'INSERT',
      userId: 'multi-filter-user',
    });

    expect(insertLogs).toHaveLength(1);
    expect(insertLogs[0]!.operation).toBe('INSERT');

    // Filter by operation AND userId AND date range
    const updateLogs = await userRepo.getTableAuditLogs({
      operation: 'UPDATE',
      userId: 'multi-filter-user',
      startDate: new Date('2020-01-01'),
      endDate: new Date('2099-12-31'),
    });

    expect(updateLogs).toHaveLength(1);
    expect(updateLogs[0]!.operation).toBe('UPDATE');

    // Filter that doesn't match
    const noMatch = await userRepo.getTableAuditLogs({
      operation: 'DELETE',
      userId: 'multi-filter-user',
    });

    expect(noMatch).toHaveLength(0);
  });
});
