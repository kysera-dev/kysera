import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Kysely, SqliteDialect, type Generated, type Selectable } from 'kysely';
import betterSqlite3 from 'better-sqlite3';
import { auditPluginSQLite, type AuditRepositoryExtensions } from '../src/index.js';
import { createRepositoryFactory } from '../../kysera-repository/dist/index.js';
import { createORM } from '../../kysera-repository/dist/index.js';
import { z } from 'zod';

// Test database schema with standard 'id' column
interface TestDatabase {
  users: UsersTable;
  audit_logs: AuditLogsTable;
}

interface UsersTable {
  id: Generated<number>;
  email: string;
  name: string;
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
  // Create users table with standard 'id' column
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .execute();
}

async function clearTestDatabase(db: Kysely<TestDatabase>): Promise<void> {
  try {
    await db.deleteFrom('audit_logs').execute();
  } catch {
    // Audit table may not exist yet
  }
  await db.deleteFrom('users').execute();
}

describe('Audit Plugin - Primary Key Configuration', () => {
  let db: Kysely<TestDatabase>;
  let currentUserId: string | null = null;

  beforeAll(async () => {
    db = createTestDatabase();
    await initializeTestSchema(db);

    // Initialize audit plugin to create audit_logs table
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

  describe('Configuration Options', () => {
    it('should accept primaryKeyColumn in plugin options', async () => {
      const audit = auditPluginSQLite({
        getUserId: () => currentUserId,
        primaryKeyColumn: 'id', // Explicit configuration
        tables: ['users'],
      });

      expect(audit).toBeDefined();
      expect(audit.name).toBe('@kysera/audit');
      expect(audit.version).toBe('0.5.1');
    });

    it('should default to "id" when primaryKeyColumn not specified', async () => {
      const audit = auditPluginSQLite({
        getUserId: () => currentUserId,
        // primaryKeyColumn not specified
        tables: ['users'],
      });

      expect(audit).toBeDefined();

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
      );

      currentUserId = 'test-user';

      // Should work with default 'id' column
      const user = await userRepo.create({
        email: 'test@example.com',
        name: 'Test User',
      });

      const auditLogs = await db.selectFrom('audit_logs').selectAll().execute();

      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]!.entity_id).toBe(String(user.id));
    });

    it('should support primaryKeyColumn with numeric IDs', async () => {
      const audit = auditPluginSQLite({
        getUserId: () => currentUserId,
        primaryKeyColumn: 'id', // Numeric primary key
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
      );

      currentUserId = 'pk-test-user';

      const user = await userRepo.create({
        email: 'pk-test@example.com',
        name: 'PK Test User',
      });

      const auditLogs = await db.selectFrom('audit_logs').selectAll().execute();

      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]!.table_name).toBe('users');
      expect(auditLogs[0]!.entity_id).toBe(String(user.id));
      expect(auditLogs[0]!.operation).toBe('INSERT');
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain backward compatibility with existing code', async () => {
      // Old way (without primaryKeyColumn)
      const oldAudit = auditPluginSQLite({
        getUserId: () => 'old-user',
        tables: ['users'],
      });

      // New way (with explicit primaryKeyColumn)
      const newAudit = auditPluginSQLite({
        getUserId: () => 'new-user',
        primaryKeyColumn: 'id',
        tables: ['users'],
      });

      // Both should work the same way
      expect(oldAudit).toBeDefined();
      expect(newAudit).toBeDefined();

      // Both should have the same plugin name and version
      expect(oldAudit.name).toBe(newAudit.name);
      expect(oldAudit.version).toBe(newAudit.version);
    });

    it('should work with all repository methods using default primary key', async () => {
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
      );

      currentUserId = 'compatibility-user';

      // Create
      const user = await userRepo.create({
        email: 'compat@example.com',
        name: 'Compat User',
      });

      // Update
      await userRepo.update(user.id, { name: 'Updated Name' });

      // Delete
      await userRepo.delete(user.id);

      const auditLogs = await db
        .selectFrom('audit_logs')
        .selectAll()
        .orderBy('id', 'asc')
        .execute();

      expect(auditLogs).toHaveLength(3);
      expect(auditLogs[0]!.operation).toBe('INSERT');
      expect(auditLogs[1]!.operation).toBe('UPDATE');
      expect(auditLogs[2]!.operation).toBe('DELETE');

      // All should reference the same entity_id
      const entityId = String(user.id);
      expect(auditLogs[0]!.entity_id).toBe(entityId);
      expect(auditLogs[1]!.entity_id).toBe(entityId);
      expect(auditLogs[2]!.entity_id).toBe(entityId);
    });
  });

  describe('Documentation Examples', () => {
    it('should demonstrate primaryKeyColumn configuration', async () => {
      // Example from README
      const audit = auditPluginSQLite({
        auditTable: 'audit_logs',
        primaryKeyColumn: 'id', // Default value, can be 'uuid', 'user_id', etc.
        captureOldValues: true,
        captureNewValues: true,
        getUserId: () => currentUserId,
        tables: ['users'],
      });

      expect(audit).toBeDefined();

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

      currentUserId = 'doc-example-user';

      const user = await userRepo.create({
        email: 'example@example.com',
        name: 'Example User',
      });

      // Verify audit log was created
      const history = await userRepo.getAuditHistory(user.id);
      expect(history).toHaveLength(1);
      expect(history[0]!.operation).toBe('INSERT');
      expect(history[0]!.entity_id).toBe(String(user.id));
    });

    it('should demonstrate that feature works with numeric IDs', async () => {
      const audit = auditPluginSQLite({
        primaryKeyColumn: 'id', // Numeric ID
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
      );

      currentUserId = 'numeric-test';

      // Create multiple users
      const user1 = await userRepo.create({
        email: 'user1@example.com',
        name: 'User 1',
      });

      const user2 = await userRepo.create({
        email: 'user2@example.com',
        name: 'User 2',
      });

      // Verify audit logs
      const logs = await db.selectFrom('audit_logs').selectAll().orderBy('id', 'asc').execute();

      expect(logs).toHaveLength(2);
      expect(logs[0]!.entity_id).toBe(String(user1.id));
      expect(logs[1]!.entity_id).toBe(String(user2.id));

      // Verify numeric IDs are different
      expect(user1.id).not.toBe(user2.id);
      expect(typeof user1.id).toBe('number');
      expect(typeof user2.id).toBe('number');
    });
  });

  describe('Type Safety', () => {
    it('should accept string values for primaryKeyColumn', () => {
      const audit1 = auditPluginSQLite({
        primaryKeyColumn: 'id',
      });

      const audit2 = auditPluginSQLite({
        primaryKeyColumn: 'uuid',
      });

      const audit3 = auditPluginSQLite({
        primaryKeyColumn: 'custom_pk',
      });

      expect(audit1).toBeDefined();
      expect(audit2).toBeDefined();
      expect(audit3).toBeDefined();
    });

    it('should work without primaryKeyColumn specified', () => {
      const audit = auditPluginSQLite({
        getUserId: () => 'test',
      });

      expect(audit).toBeDefined();
      // When not specified, it defaults to 'id'
    });
  });
});
