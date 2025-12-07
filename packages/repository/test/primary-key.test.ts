import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createRepositoryFactory } from '../src/repository.js';
import type { Kysely, Selectable, Generated } from 'kysely';
import { SqliteDialect } from 'kysely';
import SQLite from 'better-sqlite3';
import type { Database as SQLiteDatabase } from 'better-sqlite3';
import { Kysely as KyselyInstance } from 'kysely';

// Test database schema with various primary key types
interface PrimaryKeyTestDatabase {
  // Standard auto-increment integer PK
  users: {
    id: Generated<number>;
    email: string;
    name: string;
  };
  // Custom string primary key (user_id instead of id)
  profiles: {
    user_id: string;
    bio: string;
    avatar_url: string | null;
  };
  // UUID primary key
  documents: {
    uuid: string;
    title: string;
    content: string;
    created_at: Generated<string>;
  };
  // Composite primary key (tenant + user)
  tenant_users: {
    tenant_id: string;
    user_id: string;
    role: string;
    joined_at: Generated<string>;
  };
  // Composite primary key with mixed types
  order_items: {
    order_id: number;
    product_id: number;
    quantity: number;
    price: number;
  };
}

// Entity types
interface User {
  id: number;
  email: string;
  name: string;
}

interface Profile {
  user_id: string; // Keep same as DB column for simpler testing
  bio: string;
  avatar_url: string | null;
}

interface Document {
  uuid: string;
  title: string;
  content: string;
  created_at: string;
}

interface TenantUser {
  tenant_id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

interface OrderItem {
  order_id: number;
  product_id: number;
  quantity: number;
  price: number;
}

// Composite key type
interface TenantUserKey {
  tenant_id: string;
  user_id: string;
}

interface OrderItemKey {
  order_id: number;
  product_id: number;
}

// Create test database
function createPrimaryKeyTestDatabase(): {
  db: Kysely<PrimaryKeyTestDatabase>;
  sqlite: SQLiteDatabase;
  cleanup: () => Promise<void>;
} {
  const sqlite = new SQLite(':memory:');

  const db = new KyselyInstance<PrimaryKeyTestDatabase>({
    dialect: new SqliteDialect({
      database: sqlite,
    }),
  });

  sqlite.exec(`
    -- Standard auto-increment table
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );

    -- Custom string primary key
    CREATE TABLE profiles (
      user_id TEXT PRIMARY KEY,
      bio TEXT NOT NULL,
      avatar_url TEXT
    );

    -- UUID primary key
    CREATE TABLE documents (
      uuid TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Composite primary key
    CREATE TABLE tenant_users (
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, user_id)
    );

    -- Composite primary key with numbers
    CREATE TABLE order_items (
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      PRIMARY KEY (order_id, product_id)
    );
  `);

  const cleanup = async () => {
    await db.destroy();
    sqlite.close();
  };

  return { db, sqlite, cleanup };
}

// Helper to generate UUIDs
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

describe('Custom Primary Key Support', () => {
  let db: Kysely<PrimaryKeyTestDatabase>;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = createPrimaryKeyTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('Standard Integer Primary Key (default behavior)', () => {
    it('should work with default id column', async () => {
      const factory = createRepositoryFactory(db);

      const userRepo = factory.create<'users', User, number>({
        tableName: 'users',
        // No primaryKey specified - defaults to 'id'
        mapRow: (row: Selectable<PrimaryKeyTestDatabase['users']>): User => ({
          id: row.id,
          email: row.email,
          name: row.name,
        }),
        schemas: {
          create: z.object({
            email: z.string().email(),
            name: z.string(),
          }),
        },
      });

      // Create
      const user = await userRepo.create({
        email: 'test@example.com',
        name: 'Test User',
      });

      expect(user.id).toBeGreaterThan(0);
      expect(user.email).toBe('test@example.com');

      // FindById
      const found = await userRepo.findById(user.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(user.id);

      // Update
      const updated = await userRepo.update(user.id, { name: 'Updated Name' });
      expect(updated.name).toBe('Updated Name');

      // Delete
      const deleted = await userRepo.delete(user.id);
      expect(deleted).toBe(true);

      const notFound = await userRepo.findById(user.id);
      expect(notFound).toBeNull();
    });
  });

  describe('Custom Single String Primary Key', () => {
    it('should work with custom string primary key column', async () => {
      const factory = createRepositoryFactory(db);

      const profileRepo = factory.create<'profiles', Profile, string>({
        tableName: 'profiles',
        primaryKey: 'user_id',
        primaryKeyType: 'string',
        mapRow: (row: Selectable<PrimaryKeyTestDatabase['profiles']>): Profile => ({
          user_id: row.user_id,
          bio: row.bio,
          avatar_url: row.avatar_url,
        }),
        schemas: {
          create: z.object({
            user_id: z.string(),
            bio: z.string(),
            avatar_url: z.string().nullable().optional(),
          }),
        },
      });

      // Create with string PK
      const profile = await profileRepo.create({
        user_id: 'user-123',
        bio: 'Hello, I am a developer',
        avatar_url: null,
      });

      expect(profile.user_id).toBe('user-123');
      expect(profile.bio).toBe('Hello, I am a developer');

      // FindById with string key
      const found = await profileRepo.findById('user-123');
      expect(found).not.toBeNull();
      expect(found?.user_id).toBe('user-123');

      // Update with string key
      const updated = await profileRepo.update('user-123', {
        bio: 'Updated bio',
      });
      expect(updated.bio).toBe('Updated bio');

      // FindByIds with string keys
      await profileRepo.create({
        user_id: 'user-456',
        bio: 'Another user',
        avatar_url: 'https://example.com/avatar.png',
      });

      const profiles = await profileRepo.findByIds(['user-123', 'user-456']);
      expect(profiles).toHaveLength(2);

      // Delete with string key
      const deleted = await profileRepo.delete('user-123');
      expect(deleted).toBe(true);
    });
  });

  describe('UUID Primary Key', () => {
    it('should work with UUID primary key', async () => {
      const factory = createRepositoryFactory(db);

      const documentRepo = factory.create<'documents', Document, string>({
        tableName: 'documents',
        primaryKey: 'uuid',
        primaryKeyType: 'uuid',
        mapRow: (row: Selectable<PrimaryKeyTestDatabase['documents']>): Document => ({
          uuid: row.uuid,
          title: row.title,
          content: row.content,
          created_at: row.created_at,
        }),
        schemas: {
          create: z.object({
            uuid: z.string().uuid(),
            title: z.string(),
            content: z.string(),
          }),
        },
      });

      const uuid1 = generateUUID();
      const uuid2 = generateUUID();

      // Create with UUID
      const doc1 = await documentRepo.create({
        uuid: uuid1,
        title: 'First Document',
        content: 'Content of first document',
      });

      expect(doc1.uuid).toBe(uuid1);
      expect(doc1.title).toBe('First Document');

      // FindById with UUID
      const found = await documentRepo.findById(uuid1);
      expect(found).not.toBeNull();
      expect(found?.uuid).toBe(uuid1);

      // Create another document
      await documentRepo.create({
        uuid: uuid2,
        title: 'Second Document',
        content: 'Content of second document',
      });

      // FindByIds with UUIDs
      const docs = await documentRepo.findByIds([uuid1, uuid2]);
      expect(docs).toHaveLength(2);

      // BulkDelete with UUIDs
      const deletedCount = await documentRepo.bulkDelete([uuid1, uuid2]);
      expect(deletedCount).toBe(2);
    });
  });

  describe('Composite Primary Key', () => {
    it('should work with composite string primary key', async () => {
      const factory = createRepositoryFactory(db);

      const tenantUserRepo = factory.create<'tenant_users', TenantUser, TenantUserKey>({
        tableName: 'tenant_users',
        primaryKey: ['tenant_id', 'user_id'],
        primaryKeyType: 'string',
        mapRow: (row: Selectable<PrimaryKeyTestDatabase['tenant_users']>): TenantUser => ({
          tenant_id: row.tenant_id,
          user_id: row.user_id,
          role: row.role,
          joined_at: row.joined_at,
        }),
        schemas: {
          create: z.object({
            tenant_id: z.string(),
            user_id: z.string(),
            role: z.string(),
          }),
          update: z.object({
            role: z.string().optional(),
          }),
        },
      });

      // Create with composite key
      const tenantUser = await tenantUserRepo.create({
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        role: 'admin',
      });

      expect(tenantUser.tenant_id).toBe('tenant-1');
      expect(tenantUser.user_id).toBe('user-1');
      expect(tenantUser.role).toBe('admin');

      // FindById with composite key
      const found = await tenantUserRepo.findById({
        tenant_id: 'tenant-1',
        user_id: 'user-1',
      });
      expect(found).not.toBeNull();
      expect(found?.role).toBe('admin');

      // Update with composite key
      const updated = await tenantUserRepo.update(
        { tenant_id: 'tenant-1', user_id: 'user-1' },
        { role: 'member' }
      );
      expect(updated.role).toBe('member');

      // Create more tenant users
      await tenantUserRepo.create({
        tenant_id: 'tenant-1',
        user_id: 'user-2',
        role: 'viewer',
      });

      await tenantUserRepo.create({
        tenant_id: 'tenant-2',
        user_id: 'user-1',
        role: 'admin',
      });

      // FindByIds with composite keys
      const users = await tenantUserRepo.findByIds([
        { tenant_id: 'tenant-1', user_id: 'user-1' },
        { tenant_id: 'tenant-1', user_id: 'user-2' },
      ]);
      expect(users).toHaveLength(2);

      // Delete with composite key
      const deleted = await tenantUserRepo.delete({
        tenant_id: 'tenant-1',
        user_id: 'user-1',
      });
      expect(deleted).toBe(true);

      // Verify deletion
      const notFound = await tenantUserRepo.findById({
        tenant_id: 'tenant-1',
        user_id: 'user-1',
      });
      expect(notFound).toBeNull();
    });

    it('should work with composite numeric primary key', async () => {
      const factory = createRepositoryFactory(db);

      const orderItemRepo = factory.create<'order_items', OrderItem, OrderItemKey>({
        tableName: 'order_items',
        primaryKey: ['order_id', 'product_id'],
        primaryKeyType: 'number',
        mapRow: (row: Selectable<PrimaryKeyTestDatabase['order_items']>): OrderItem => ({
          order_id: row.order_id,
          product_id: row.product_id,
          quantity: row.quantity,
          price: row.price,
        }),
        schemas: {
          create: z.object({
            order_id: z.number(),
            product_id: z.number(),
            quantity: z.number().positive(),
            price: z.number().positive(),
          }),
          update: z.object({
            quantity: z.number().positive().optional(),
            price: z.number().positive().optional(),
          }),
        },
      });

      // Create order items
      const item1 = await orderItemRepo.create({
        order_id: 1,
        product_id: 100,
        quantity: 2,
        price: 29.99,
      });

      expect(item1.order_id).toBe(1);
      expect(item1.product_id).toBe(100);

      await orderItemRepo.create({
        order_id: 1,
        product_id: 101,
        quantity: 1,
        price: 49.99,
      });

      // FindById with numeric composite key
      const found = await orderItemRepo.findById({
        order_id: 1,
        product_id: 100,
      });
      expect(found).not.toBeNull();
      expect(found?.quantity).toBe(2);

      // Update
      const updated = await orderItemRepo.update(
        { order_id: 1, product_id: 100 },
        { quantity: 5 }
      );
      expect(updated.quantity).toBe(5);

      // BulkDelete
      const deletedCount = await orderItemRepo.bulkDelete([
        { order_id: 1, product_id: 100 },
        { order_id: 1, product_id: 101 },
      ]);
      expect(deletedCount).toBe(2);
    });
  });

  describe('Bulk Operations with Custom Primary Keys', () => {
    it('should support bulkCreate with custom primary keys', async () => {
      const factory = createRepositoryFactory(db);

      const profileRepo = factory.create<'profiles', Profile, string>({
        tableName: 'profiles',
        primaryKey: 'user_id',
        primaryKeyType: 'string',
        mapRow: (row: Selectable<PrimaryKeyTestDatabase['profiles']>): Profile => ({
          user_id: row.user_id,
          bio: row.bio,
          avatar_url: row.avatar_url,
        }),
        schemas: {
          create: z.object({
            user_id: z.string(),
            bio: z.string(),
            avatar_url: z.string().nullable().optional(),
          }),
        },
      });

      const profiles = await profileRepo.bulkCreate([
        { user_id: 'bulk-1', bio: 'User 1 bio', avatar_url: null },
        { user_id: 'bulk-2', bio: 'User 2 bio', avatar_url: null },
        { user_id: 'bulk-3', bio: 'User 3 bio', avatar_url: null },
      ]);

      expect(profiles).toHaveLength(3);
      expect(profiles[0]?.user_id).toBe('bulk-1');
      expect(profiles[1]?.user_id).toBe('bulk-2');
      expect(profiles[2]?.user_id).toBe('bulk-3');
    });

    it('should support bulkUpdate with custom primary keys', async () => {
      const factory = createRepositoryFactory(db);

      const profileRepo = factory.create<'profiles', Profile, string>({
        tableName: 'profiles',
        primaryKey: 'user_id',
        primaryKeyType: 'string',
        mapRow: (row: Selectable<PrimaryKeyTestDatabase['profiles']>): Profile => ({
          user_id: row.user_id,
          bio: row.bio,
          avatar_url: row.avatar_url,
        }),
        schemas: {
          create: z.object({
            user_id: z.string(),
            bio: z.string(),
            avatar_url: z.string().nullable().optional(),
          }),
          update: z.object({
            bio: z.string().optional(),
            avatar_url: z.string().nullable().optional(),
          }),
        },
      });

      // Create profiles first
      await profileRepo.bulkCreate([
        { user_id: 'update-1', bio: 'Original 1', avatar_url: null },
        { user_id: 'update-2', bio: 'Original 2', avatar_url: null },
      ]);

      // Bulk update
      const updated = await profileRepo.bulkUpdate([
        { id: 'update-1', data: { bio: 'Updated 1' } },
        { id: 'update-2', data: { bio: 'Updated 2' } },
      ]);

      expect(updated).toHaveLength(2);
      expect(updated[0]?.bio).toBe('Updated 1');
      expect(updated[1]?.bio).toBe('Updated 2');
    });
  });

  describe('Pagination with Custom Primary Keys', () => {
    it('should paginate with string primary key', async () => {
      const factory = createRepositoryFactory(db);

      const profileRepo = factory.create<'profiles', Profile, string>({
        tableName: 'profiles',
        primaryKey: 'user_id',
        primaryKeyType: 'string',
        mapRow: (row: Selectable<PrimaryKeyTestDatabase['profiles']>): Profile => ({
          user_id: row.user_id,
          bio: row.bio,
          avatar_url: row.avatar_url,
        }),
        schemas: {
          create: z.object({
            user_id: z.string(),
            bio: z.string(),
            avatar_url: z.string().nullable().optional(),
          }),
        },
      });

      // Create test data
      for (let i = 1; i <= 10; i++) {
        const paddedNum = i.toString().padStart(2, '0');
        await profileRepo.create({
          user_id: 'user-' + paddedNum,
          bio: 'Bio for user ' + i,
          avatar_url: null,
        });
      }

      // Test offset pagination
      const page1 = await profileRepo.paginate({
        limit: 3,
        offset: 0,
        orderBy: 'user_id',
        orderDirection: 'asc',
      });

      expect(page1.items).toHaveLength(3);
      expect(page1.total).toBe(10);
      expect(page1.items[0]?.user_id).toBe('user-01');

      const page2 = await profileRepo.paginate({
        limit: 3,
        offset: 3,
        orderBy: 'user_id',
        orderDirection: 'asc',
      });

      expect(page2.items).toHaveLength(3);
      expect(page2.items[0]?.user_id).toBe('user-04');
    });

    it('should support cursor pagination with custom primary key', async () => {
      const factory = createRepositoryFactory(db);

      const profileRepo = factory.create<'profiles', Profile, string>({
        tableName: 'profiles',
        primaryKey: 'user_id',
        primaryKeyType: 'string',
        mapRow: (row: Selectable<PrimaryKeyTestDatabase['profiles']>): Profile => ({
          user_id: row.user_id,
          bio: row.bio,
          avatar_url: row.avatar_url,
        }),
        schemas: {
          create: z.object({
            user_id: z.string(),
            bio: z.string(),
            avatar_url: z.string().nullable().optional(),
          }),
        },
      });

      // Create test data
      for (let i = 1; i <= 10; i++) {
        const paddedNum = i.toString().padStart(2, '0');
        await profileRepo.create({
          user_id: 'cursor-' + paddedNum,
          bio: 'Bio ' + i,
          avatar_url: null,
        });
      }

      // First page - Note: orderBy uses the entity property name which matches DB column here
      const page1 = await profileRepo.paginateCursor({
        limit: 3,
        orderBy: 'user_id',
        orderDirection: 'asc',
      });

      expect(page1.items).toHaveLength(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).not.toBeNull();

      // Second page using cursor
      const page2 = await profileRepo.paginateCursor({
        limit: 3,
        cursor: page1.nextCursor,
        orderBy: 'user_id',
        orderDirection: 'asc',
      });

      expect(page2.items).toHaveLength(3);
      expect(page2.hasMore).toBe(true);
      // Ensure no overlap with first page
      const page1Ids = page1.items.map((p) => p.user_id);
      const page2Ids = page2.items.map((p) => p.user_id);
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
    });
  });

  describe('Transaction Support with Custom Primary Keys', () => {
    it('should work with transactions and custom primary keys', async () => {
      const factory = createRepositoryFactory(db);

      const profileRepo = factory.create<'profiles', Profile, string>({
        tableName: 'profiles',
        primaryKey: 'user_id',
        primaryKeyType: 'string',
        mapRow: (row: Selectable<PrimaryKeyTestDatabase['profiles']>): Profile => ({
          user_id: row.user_id,
          bio: row.bio,
          avatar_url: row.avatar_url,
        }),
        schemas: {
          create: z.object({
            user_id: z.string(),
            bio: z.string(),
            avatar_url: z.string().nullable().optional(),
          }),
        },
      });

      // Successful transaction
      await db.transaction().execute(async (trx) => {
        const txFactory = createRepositoryFactory(trx);
        const txRepo = txFactory.create<'profiles', Profile, string>({
          tableName: 'profiles',
          primaryKey: 'user_id',
          primaryKeyType: 'string',
          mapRow: (row: Selectable<PrimaryKeyTestDatabase['profiles']>): Profile => ({
            user_id: row.user_id,
            bio: row.bio,
            avatar_url: row.avatar_url,
          }),
          schemas: {
            create: z.object({
              user_id: z.string(),
              bio: z.string(),
              avatar_url: z.string().nullable().optional(),
            }),
          },
        });

        await txRepo.create({
          user_id: 'tx-user-1',
          bio: 'Transaction user',
          avatar_url: null,
        });
      });

      const found = await profileRepo.findById('tx-user-1');
      expect(found).not.toBeNull();

      // Rollback transaction
      try {
        await db.transaction().execute(async (trx) => {
          const txFactory = createRepositoryFactory(trx);
          const txRepo = txFactory.create<'profiles', Profile, string>({
            tableName: 'profiles',
            primaryKey: 'user_id',
            primaryKeyType: 'string',
            mapRow: (row: Selectable<PrimaryKeyTestDatabase['profiles']>): Profile => ({
              user_id: row.user_id,
              bio: row.bio,
              avatar_url: row.avatar_url,
            }),
            schemas: {
              create: z.object({
                user_id: z.string(),
                bio: z.string(),
                avatar_url: z.string().nullable().optional(),
              }),
            },
          });

          await txRepo.create({
            user_id: 'tx-rollback',
            bio: 'Should rollback',
            avatar_url: null,
          });

          throw new Error('Force rollback');
        });
      } catch {
        // Expected
      }

      const notFound = await profileRepo.findById('tx-rollback');
      expect(notFound).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-existent records with custom primary key', async () => {
      const factory = createRepositoryFactory(db);

      const profileRepo = factory.create<'profiles', Profile, string>({
        tableName: 'profiles',
        primaryKey: 'user_id',
        primaryKeyType: 'string',
        mapRow: (row: Selectable<PrimaryKeyTestDatabase['profiles']>): Profile => ({
          user_id: row.user_id,
          bio: row.bio,
          avatar_url: row.avatar_url,
        }),
        schemas: {
          create: z.object({
            user_id: z.string(),
            bio: z.string(),
            avatar_url: z.string().nullable().optional(),
          }),
        },
      });

      // findById returns null for non-existent
      const notFound = await profileRepo.findById('non-existent');
      expect(notFound).toBeNull();

      // update throws for non-existent
      await expect(
        profileRepo.update('non-existent', { bio: 'test' })
      ).rejects.toThrow();

      // delete returns false for non-existent
      const deleted = await profileRepo.delete('non-existent');
      expect(deleted).toBe(false);
    });

    it('should handle empty arrays for bulk operations', async () => {
      const factory = createRepositoryFactory(db);

      const profileRepo = factory.create<'profiles', Profile, string>({
        tableName: 'profiles',
        primaryKey: 'user_id',
        primaryKeyType: 'string',
        mapRow: (row: Selectable<PrimaryKeyTestDatabase['profiles']>): Profile => ({
          user_id: row.user_id,
          bio: row.bio,
          avatar_url: row.avatar_url,
        }),
        schemas: {
          create: z.object({
            user_id: z.string(),
            bio: z.string(),
            avatar_url: z.string().nullable().optional(),
          }),
        },
      });

      const emptyFind = await profileRepo.findByIds([]);
      expect(emptyFind).toHaveLength(0);

      const emptyCreate = await profileRepo.bulkCreate([]);
      expect(emptyCreate).toHaveLength(0);

      const emptyUpdate = await profileRepo.bulkUpdate([]);
      expect(emptyUpdate).toHaveLength(0);

      const emptyDelete = await profileRepo.bulkDelete([]);
      expect(emptyDelete).toBe(0);
    });

    it('should handle composite key with non-existent record', async () => {
      const factory = createRepositoryFactory(db);

      const tenantUserRepo = factory.create<'tenant_users', TenantUser, TenantUserKey>({
        tableName: 'tenant_users',
        primaryKey: ['tenant_id', 'user_id'],
        primaryKeyType: 'string',
        mapRow: (row: Selectable<PrimaryKeyTestDatabase['tenant_users']>): TenantUser => ({
          tenant_id: row.tenant_id,
          user_id: row.user_id,
          role: row.role,
          joined_at: row.joined_at,
        }),
        schemas: {
          create: z.object({
            tenant_id: z.string(),
            user_id: z.string(),
            role: z.string(),
          }),
        },
      });

      const notFound = await tenantUserRepo.findById({
        tenant_id: 'non-existent',
        user_id: 'non-existent',
      });
      expect(notFound).toBeNull();
    });
  });
});
