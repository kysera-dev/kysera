import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Kysely, SqliteDialect, type Generated, type Selectable } from 'kysely';
import betterSqlite3 from 'better-sqlite3';
import { auditPluginSQLite } from '../src/index.js';
import { createRepositoryFactory } from '../../kysera-repository/dist/index.js';
import { createORM } from '../../kysera-repository/dist/index.js';
import { z } from 'zod';

// Test database schema
interface TestDatabase {
  users: UsersTable;
  posts: PostsTable;
  audit_logs: AuditLogsTable;
}

interface UsersTable {
  id: Generated<number>;
  email: string;
  name: string;
}

interface PostsTable {
  id: Generated<number>;
  user_id: number;
  title: string;
  content: string;
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
type Post = Selectable<PostsTable>;

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
  // Create users table
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .execute();

  // Create posts table
  await db.schema
    .createTable('posts')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('user_id', 'integer', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .execute();
}

async function clearTestDatabase(db: Kysely<TestDatabase>): Promise<void> {
  await db.deleteFrom('audit_logs').execute();
  await db.deleteFrom('posts').execute();
  await db.deleteFrom('users').execute();
}

describe('Audit Plugin', () => {
  let db: Kysely<TestDatabase>;
  let orm: any;
  let userRepo: any;
  let currentUserId: string | null = null;

  beforeAll(async () => {
    db = createTestDatabase();
    await initializeTestSchema(db);

    // Create ORM with audit plugin
    const audit = auditPluginSQLite({
      getUserId: () => currentUserId,
      tables: ['users', 'posts'],
    });

    orm = await createORM(db, [audit]);

    // Create repositories
    const factory = createRepositoryFactory(db);

    userRepo = orm.createRepository((_executor: any) =>
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

    // Removed postRepo as it's not used
  });

  beforeEach(async () => {
    await clearTestDatabase(db);
    currentUserId = null;
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('Basic Audit Operations', () => {
    it('should create audit log for INSERT', async () => {
      currentUserId = 'user123';

      const user = await userRepo.create({
        email: 'test@example.com',
        name: 'Test User',
      });

      const auditLogs = await db.selectFrom('audit_logs').selectAll().execute();

      expect(auditLogs).toHaveLength(1);

      const log = auditLogs[0]!;
      expect(log.table_name).toBe('users');
      expect(log.operation).toBe('INSERT');
      expect(log.entity_id).toBe(String(user.id));
      expect(log.changed_by).toBe('user123');
      expect(log.old_values).toBeNull();

      // Parse JSON string from database
      const newValues = log.new_values ? JSON.parse(log.new_values) : null;
      expect(newValues!.email).toBe('test@example.com');
      expect(newValues!.name).toBe('Test User');
    });

    it('should create audit log for UPDATE', async () => {
      currentUserId = 'user456';

      const user = await userRepo.create({
        email: 'test@example.com',
        name: 'Test User',
      });

      // Clear audit logs from creation
      await db.deleteFrom('audit_logs').execute();

      await userRepo.update(user.id, {
        name: 'Updated Name',
      });

      const auditLogs = await db.selectFrom('audit_logs').selectAll().execute();

      expect(auditLogs).toHaveLength(1);

      const log = auditLogs[0]!;
      expect(log.table_name).toBe('users');
      expect(log.operation).toBe('UPDATE');
      expect(log.entity_id).toBe(String(user.id));
      expect(log.changed_by).toBe('user456');

      // Parse JSON strings from database
      const oldValues = log.old_values ? JSON.parse(log.old_values) : null;
      expect(oldValues!.name).toBe('Test User');

      const newValues = log.new_values ? JSON.parse(log.new_values) : null;
      expect(newValues!.name).toBe('Updated Name');
    });

    it('should create audit log for DELETE', async () => {
      currentUserId = 'user789';

      const user = await userRepo.create({
        email: 'test@example.com',
        name: 'Test User',
      });

      // Clear audit logs from creation
      await db.deleteFrom('audit_logs').execute();

      await userRepo.delete(user.id);

      const auditLogs = await db.selectFrom('audit_logs').selectAll().execute();

      expect(auditLogs).toHaveLength(1);

      const log = auditLogs[0]!;
      expect(log.table_name).toBe('users');
      expect(log.operation).toBe('DELETE');
      expect(log.entity_id).toBe(String(user.id));
      expect(log.changed_by).toBe('user789');

      // Parse JSON string from database
      const oldValues = log.old_values ? JSON.parse(log.old_values) : null;
      expect(oldValues!.email).toBe('test@example.com');
      expect(log.new_values).toBeNull();
    });
  });

  describe('Bulk Operations', () => {
    it('should audit bulk create operations', async () => {
      currentUserId = 'bulk-user';

      await userRepo.bulkCreate([
        { email: 'user1@example.com', name: 'User 1' },
        { email: 'user2@example.com', name: 'User 2' },
        { email: 'user3@example.com', name: 'User 3' },
      ]);

      const auditLogs = await db.selectFrom('audit_logs').selectAll().orderBy('id', 'asc').execute();

      expect(auditLogs).toHaveLength(3);

      for (let i = 0; i < 3; i++) {
        const log = auditLogs[i]!;
        expect(log.operation).toBe('INSERT');
        expect(log.table_name).toBe('users');
        expect(log.changed_by).toBe('bulk-user');
      }
    });

    it('should audit bulk update operations', async () => {
      // Create users first
      const user1 = await userRepo.create({ email: 'user1@example.com', name: 'User 1' });
      const user2 = await userRepo.create({ email: 'user2@example.com', name: 'User 2' });

      // Clear creation logs
      await db.deleteFrom('audit_logs').execute();

      currentUserId = 'bulk-updater';

      await userRepo.bulkUpdate([
        { id: user1.id, data: { name: 'Updated 1' } },
        { id: user2.id, data: { name: 'Updated 2' } },
      ]);

      const auditLogs = await db.selectFrom('audit_logs').selectAll().orderBy('id', 'asc').execute();

      expect(auditLogs).toHaveLength(2);

      for (const log of auditLogs) {
        expect(log.operation).toBe('UPDATE');
        expect(log.changed_by).toBe('bulk-updater');
        expect(log.old_values).not.toBeNull();
        expect(log.new_values).not.toBeNull();
      }
    });

    it('should audit bulk delete operations', async () => {
      // Create users first
      const user1 = await userRepo.create({ email: 'user1@example.com', name: 'User 1' });
      const user2 = await userRepo.create({ email: 'user2@example.com', name: 'User 2' });
      const user3 = await userRepo.create({ email: 'user3@example.com', name: 'User 3' });

      // Clear creation logs
      await db.deleteFrom('audit_logs').execute();

      currentUserId = 'bulk-deleter';

      await userRepo.bulkDelete([user1.id, user2.id, user3.id]);

      const auditLogs = await db.selectFrom('audit_logs').selectAll().orderBy('id', 'asc').execute();

      expect(auditLogs).toHaveLength(3);

      for (const log of auditLogs) {
        expect(log.operation).toBe('DELETE');
        expect(log.changed_by).toBe('bulk-deleter');
        expect(log.old_values).not.toBeNull();
        expect(log.new_values).toBeNull();
      }
    });
  });

  describe('Audit History Methods', () => {
    it('should get audit history for an entity', async () => {
      currentUserId = 'history-user';

      const user = await userRepo.create({
        email: 'history@example.com',
        name: 'History User',
      });

      // Add small delays to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      await userRepo.update(user.id, { name: 'Updated Once' });

      await new Promise((resolve) => setTimeout(resolve, 10));
      await userRepo.update(user.id, { name: 'Updated Twice' });

      const history = await userRepo.getAuditHistory(user.id);

      expect(history).toHaveLength(3); // 1 INSERT + 2 UPDATE
      expect(history[0]!.operation).toBe('UPDATE'); // Most recent first
      expect(history[1]!.operation).toBe('UPDATE');
      expect(history[2]!.operation).toBe('INSERT');

      // Check the progression of changes
      const latestUpdate = history[0]!.new_values;
      expect(latestUpdate!.name).toBe('Updated Twice');
    });

    it('should get table audit logs with filters', async () => {
      // Create multiple operations
      currentUserId = 'user1';
      const user1 = await userRepo.create({ email: 'user1@example.com', name: 'User 1' });

      currentUserId = 'user2';
      await userRepo.update(user1.id, { name: 'Modified' });

      currentUserId = 'user3';
      await userRepo.create({ email: 'user2@example.com', name: 'User 2' });

      // Get INSERT operations only
      const insertLogs = await userRepo.getTableAuditLogs({
        operation: 'INSERT',
      });

      expect(insertLogs).toHaveLength(2);
      expect(insertLogs.every((l: any) => l.operation === 'INSERT')).toBe(true);

      // Get logs by specific user
      const user2Logs = await userRepo.getTableAuditLogs({
        userId: 'user2',
      });

      expect(user2Logs).toHaveLength(1);
      expect(user2Logs[0]!.changed_by).toBe('user2');
    });

    it('should get user changes', async () => {
      currentUserId = 'tracker';

      await userRepo.create({ email: 'track1@example.com', name: 'Track 1' });
      await userRepo.create({ email: 'track2@example.com', name: 'Track 2' });

      currentUserId = 'other-user';
      await userRepo.create({ email: 'other@example.com', name: 'Other' });

      const trackerChanges = await userRepo.getUserChanges('tracker');

      expect(trackerChanges).toHaveLength(2);
      expect(trackerChanges.every((c: any) => c.changed_by === 'tracker')).toBe(true);
    });

    it('should restore from audit log', async () => {
      currentUserId = 'restore-user';

      const user = await userRepo.create({
        email: 'restore@example.com',
        name: 'Original Name',
      });

      // Update the user
      await userRepo.update(user.id, {
        name: 'Modified Name',
      });

      // Get the audit logs
      const logs = await userRepo.getAuditHistory(user.id);

      // Find the UPDATE log
      const updateLog = logs.find((l: any) => l.operation === 'UPDATE');
      expect(updateLog).toBeDefined();

      // Restore to original state
      const restored = await userRepo.restoreFromAudit(updateLog!.id);

      expect(restored.name).toBe('Original Name');
    });
  });

  describe('Configuration Options', () => {
    it('should skip system operations when configured', async () => {
      // Create new ORM with skipSystemOperations
      const audit = auditPluginSQLite({
        skipSystemOperations: true,
        tables: ['users'],
      });

      const systemOrm = await createORM(db, [audit]);
      const factory = createRepositoryFactory(db);

      const systemRepo = systemOrm.createRepository((_executor: any) =>
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

      // Operation without user ID (system operation)
      currentUserId = null;
      await systemRepo.create({
        email: 'system@example.com',
        name: 'System User',
      });

      const auditLogs = await db.selectFrom('audit_logs').selectAll().where('changed_by', 'is', null).execute();

      // Should not create audit log for system operations
      expect(auditLogs).toHaveLength(0);
    });

    it('should include metadata when provided', async () => {
      const metadata = { ip: '192.168.1.1', userAgent: 'TestAgent/1.0' };

      const audit = auditPluginSQLite({
        getUserId: () => 'metadata-user',
        metadata: () => metadata,
        tables: ['users'],
      });

      const metaOrm = await createORM(db, [audit]);
      const factory = createRepositoryFactory(db);

      const metaRepo = metaOrm.createRepository((_executor: any) =>
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

      await metaRepo.create({
        email: 'meta@example.com',
        name: 'Meta User',
      });

      const auditLogs = await db.selectFrom('audit_logs').selectAll().where('metadata', 'is not', null).execute();

      expect(auditLogs).toHaveLength(1);

      // Parse JSON string from database
      const logMetadata = auditLogs[0]!.metadata ? JSON.parse(auditLogs[0]!.metadata) : null;
      expect(logMetadata).toEqual(metadata);
    });

    it('should respect table whitelist', async () => {
      const audit = auditPluginSQLite({
        tables: ['posts'], // Only audit posts, not users
      });

      const selectiveOrm = await createORM(db, [audit]);
      const factory = createRepositoryFactory(db);

      const selectiveUserRepo = selectiveOrm.createRepository((_executor: any) =>
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

      const selectivePostRepo = selectiveOrm.createRepository((_executor: any) =>
        factory.create({
          tableName: 'posts' as const,
          mapRow: (row: any) => row as Post,
          schemas: {
            create: z.object({
              user_id: z.number(),
              title: z.string(),
              content: z.string(),
            }),
          },
        })
      );

      // Create a user (should not be audited)
      const user = await selectiveUserRepo.create({
        email: 'noaudit@example.com',
        name: 'No Audit',
      });

      // Create a post (should be audited)
      await selectivePostRepo.create({
        user_id: user.id,
        title: 'Audited Post',
        content: 'This should be audited',
      });

      const auditLogs = await db.selectFrom('audit_logs').selectAll().execute();

      // Only the post should be audited
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]!.table_name).toBe('posts');
    });

    it('should respect table blacklist', async () => {
      const audit = auditPluginSQLite({
        excludeTables: ['users'], // Exclude users from audit
      });

      const excludeOrm = await createORM(db, [audit]);
      const factory = createRepositoryFactory(db);

      const excludeUserRepo = excludeOrm.createRepository((_executor: any) =>
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

      // Create a user (should not be audited due to exclusion)
      await excludeUserRepo.create({
        email: 'excluded@example.com',
        name: 'Excluded User',
      });

      const auditLogs = await db.selectFrom('audit_logs').selectAll().where('table_name', '=', 'users').execute();

      expect(auditLogs).toHaveLength(0);
    });
  });
});
