import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect, sql, type Generated } from 'kysely';
import sqliteConstructor from 'better-sqlite3';
import type { Database as SQLiteDatabase } from 'better-sqlite3';
import { softDeletePlugin } from '../src/index.js';
import { createORM, createRepositoryFactory } from '../../kysera-repository/dist/index.js';
import { z } from 'zod';

// Custom database schema with various primary key types
interface CustomKeyDatabase {
  // UUID primary key table
  products: {
    uuid: string;
    name: string;
    price: number;
    deleted_at: string | null;
  };
  // Custom named primary key
  customers: {
    customer_id: Generated<number>;
    email: string;
    name: string;
    deleted_at: string | null;
  };
  // Composite primary key table
  order_items: {
    order_id: number;
    product_id: number;
    quantity: number;
    deleted_at: string | null;
  };
  // Standard id for comparison
  orders: {
    id: Generated<number>;
    customer_id: number;
    total: number;
    deleted_at: string | null;
  };
}

interface Product {
  uuid: string;
  name: string;
  price: number;
  deleted_at: string | null;
}

interface Customer {
  customer_id: number;
  email: string;
  name: string;
  deleted_at: string | null;
}

interface OrderItem {
  order_id: number;
  product_id: number;
  quantity: number;
  deleted_at: string | null;
}

function createCustomKeyDatabase(): {
  db: Kysely<CustomKeyDatabase>;
  sqlite: SQLiteDatabase;
  cleanup: () => void;
} {
  const sqlite = new sqliteConstructor(':memory:');

  const db = new Kysely<CustomKeyDatabase>({
    dialect: new SqliteDialect({
      database: sqlite,
    }),
  });

  sqlite.exec('PRAGMA foreign_keys = OFF');

  return {
    db,
    sqlite,
    cleanup: () => {
      void db.destroy();
      sqlite.close();
    },
  };
}

async function initializeCustomKeySchema(db: Kysely<CustomKeyDatabase>): Promise<void> {
  // Create products table with UUID primary key
  await db.schema
    .createTable('products')
    .addColumn('uuid', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('price', 'real', (col) => col.notNull())
    .addColumn('deleted_at', 'text')
    .execute();

  // Create customers table with custom primary key name
  await db.schema
    .createTable('customers')
    .addColumn('customer_id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text')
    .addColumn('deleted_at', 'text')
    .execute();

  // Create order_items table with composite primary key
  await db.schema
    .createTable('order_items')
    .addColumn('order_id', 'integer', (col) => col.notNull())
    .addColumn('product_id', 'integer', (col) => col.notNull())
    .addColumn('quantity', 'integer', (col) => col.notNull())
    .addColumn('deleted_at', 'text')
    .execute();

  // Create composite primary key using raw SQL
  await sql`CREATE UNIQUE INDEX order_items_pk ON order_items (order_id, product_id)`.execute(db);

  // Create orders table with standard id
  await db.schema
    .createTable('orders')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('customer_id', 'integer', (col) => col.notNull())
    .addColumn('total', 'real', (col) => col.notNull())
    .addColumn('deleted_at', 'text')
    .execute();
}

async function seedCustomKeyData(db: Kysely<CustomKeyDatabase>): Promise<void> {
  // Seed products with UUIDs
  await db
    .insertInto('products')
    .values([
      { uuid: 'prod-001-uuid', name: 'Widget', price: 9.99, deleted_at: null },
      { uuid: 'prod-002-uuid', name: 'Gadget', price: 19.99, deleted_at: null },
      { uuid: 'prod-003-uuid', name: 'Gizmo', price: 29.99, deleted_at: null },
    ])
    .execute();

  // Seed customers
  await db
    .insertInto('customers')
    .values([
      { email: 'john@example.com', name: 'John Doe' },
      { email: 'jane@example.com', name: 'Jane Doe' },
    ])
    .execute();

  // Seed orders
  await db
    .insertInto('orders')
    .values([
      { customer_id: 1, total: 39.98 },
      { customer_id: 2, total: 19.99 },
    ])
    .execute();

  // Seed order items
  await db
    .insertInto('order_items')
    .values([
      { order_id: 1, product_id: 1, quantity: 2 },
      { order_id: 1, product_id: 2, quantity: 1 },
      { order_id: 2, product_id: 3, quantity: 1 },
    ])
    .execute();
}

describe('Soft Delete Plugin - Custom Primary Keys', () => {
  let db: Kysely<CustomKeyDatabase>;
  let cleanup: () => void;

  beforeEach(async () => {
    const setup = createCustomKeyDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
    await initializeCustomKeySchema(db);
    await seedCustomKeyData(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe('UUID Primary Keys', () => {
    it('should soft delete records with UUID primary key', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'uuid',
        tables: ['products'],
      });
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'products' as keyof CustomKeyDatabase,
          mapRow: (row) => row as Product,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as any;

      // Soft delete by UUID
      await repo.softDelete('prod-001-uuid');

      // Verify soft deleted
      const found = await repo.findById('prod-001-uuid');
      expect(found).toBeNull();

      // Verify with deleted
      const foundWithDeleted = await repo.findWithDeleted('prod-001-uuid');
      expect(foundWithDeleted).not.toBeNull();
      expect(foundWithDeleted.deleted_at).not.toBeNull();
    });

    it('should restore records with UUID primary key', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'uuid',
        tables: ['products'],
      });
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'products' as keyof CustomKeyDatabase,
          mapRow: (row) => row as Product,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as any;

      // Soft delete and restore
      await repo.softDelete('prod-002-uuid');
      await repo.restore('prod-002-uuid');

      // Verify restored
      const found = await repo.findById('prod-002-uuid');
      expect(found).not.toBeNull();
      expect(found.deleted_at).toBeNull();
    });

    it('should find all products excluding soft deleted with UUID', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'uuid',
        tables: ['products'],
      });
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'products' as keyof CustomKeyDatabase,
          mapRow: (row) => row as Product,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as any;

      // Soft delete one product
      await repo.softDelete('prod-001-uuid');

      // Find all should exclude soft deleted
      const all = await repo.findAll();
      expect(all).toHaveLength(2);
      expect(all.find((p: Product) => p.uuid === 'prod-001-uuid')).toBeUndefined();
    });
  });

  describe('Custom ID Column Names', () => {
    it('should soft delete records with custom primary key name', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'customer_id',
        tables: ['customers'],
      });
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'customers' as keyof CustomKeyDatabase,
          mapRow: (row) => row as Customer,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as any;

      // Get customer ID
      const customers = await db.selectFrom('customers').selectAll().execute();
      const johnId = customers.find(c => c.name === 'John Doe')?.customer_id;
      expect(johnId).toBeDefined();

      // Soft delete by custom key
      await repo.softDelete(johnId);

      // Verify soft deleted
      const found = await repo.findById(johnId);
      expect(found).toBeNull();

      const foundWithDeleted = await repo.findWithDeleted(johnId);
      expect(foundWithDeleted).not.toBeNull();
      expect(foundWithDeleted.deleted_at).not.toBeNull();
    });

    it('should restore records with custom primary key name', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'customer_id',
        tables: ['customers'],
      });
      const orm = await createORM(db, [plugin]);

      const repo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'customers' as keyof CustomKeyDatabase,
          mapRow: (row) => row as Customer,
          schemas: {
            create: z.any(),
            update: z.any(),
          },
        });
      }) as any;

      const customers = await db.selectFrom('customers').selectAll().execute();
      const janeId = customers.find(c => c.name === 'Jane Doe')?.customer_id;
      expect(janeId).toBeDefined();

      // Soft delete and restore
      await repo.softDelete(janeId);
      await repo.restore(janeId);

      // Verify restored
      const found = await repo.findById(janeId);
      expect(found).not.toBeNull();
      expect(found.deleted_at).toBeNull();
    });
  });

  describe('Composite Primary Keys', () => {
    it('should handle soft delete for composite key tables via direct query', async () => {
      // Note: The plugin's softDelete method uses a single ID parameter
      // For composite keys, we need to use direct queries
      const plugin = softDeletePlugin({
        tables: ['order_items'],
      });
      const orm = await createORM(db, [plugin]);

      // Direct soft delete with composite key
      await db
        .updateTable('order_items')
        .set({ deleted_at: new Date().toISOString() })
        .where('order_id', '=', 1)
        .where('product_id', '=', 1)
        .execute();

      // Verify soft deleted via query
      const result = await orm.applyPlugins(
        db.selectFrom('order_items').selectAll(),
        'select',
        'order_items',
        {}
      ).execute();

      expect(result).toHaveLength(2); // 3 - 1 deleted
    });

    it('should filter soft deleted records for composite key tables', async () => {
      const plugin = softDeletePlugin({
        tables: ['order_items'],
      });
      const orm = await createORM(db, [plugin]);

      // Soft delete two items
      await db
        .updateTable('order_items')
        .set({ deleted_at: new Date().toISOString() })
        .where('order_id', '=', 1)
        .execute(); // Deletes both items for order 1

      // Query should filter out deleted
      const result = await orm.applyPlugins(
        db.selectFrom('order_items').selectAll(),
        'select',
        'order_items',
        {}
      ).execute();

      expect(result).toHaveLength(1); // Only order 2's item remains
      expect((result[0] as OrderItem).order_id).toBe(2);
    });

    it('should include deleted records when requested for composite key tables', async () => {
      const plugin = softDeletePlugin({
        tables: ['order_items'],
      });
      const orm = await createORM(db, [plugin]);

      // Soft delete one item
      await db
        .updateTable('order_items')
        .set({ deleted_at: new Date().toISOString() })
        .where('order_id', '=', 2)
        .where('product_id', '=', 3)
        .execute();

      // Query with includeDeleted should include all
      const result = await orm.applyPlugins(
        db.selectFrom('order_items').selectAll(),
        'select',
        'order_items',
        { includeDeleted: true }
      ).execute();

      expect(result).toHaveLength(3);
    });

    it('should restore composite key records via direct query', async () => {
      // Soft delete first
      await db
        .updateTable('order_items')
        .set({ deleted_at: new Date().toISOString() })
        .where('order_id', '=', 1)
        .where('product_id', '=', 2)
        .execute();

      // Verify deleted
      const beforeRestore = await db
        .selectFrom('order_items')
        .selectAll()
        .where('order_id', '=', 1)
        .where('product_id', '=', 2)
        .executeTakeFirst();
      expect(beforeRestore?.deleted_at).not.toBeNull();

      // Restore
      await db
        .updateTable('order_items')
        .set({ deleted_at: null })
        .where('order_id', '=', 1)
        .where('product_id', '=', 2)
        .execute();

      // Verify restored
      const afterRestore = await db
        .selectFrom('order_items')
        .selectAll()
        .where('order_id', '=', 1)
        .where('product_id', '=', 2)
        .executeTakeFirst();
      expect(afterRestore?.deleted_at).toBeNull();
    });
  });

  describe('Mixed Primary Key Scenarios', () => {
    it.skip('should handle different primary key types in same ORM - SKIPPED: Plugin validation now prevents duplicate names', async () => {
      // Create plugins for different tables with different key columns
      const productPlugin = softDeletePlugin({
        primaryKeyColumn: 'uuid',
        tables: ['products'],
      });

      const customerPlugin = softDeletePlugin({
        primaryKeyColumn: 'customer_id',
        tables: ['customers'],
      });

      const orderPlugin = softDeletePlugin({
        primaryKeyColumn: 'id',
        tables: ['orders'],
      });

      // Create ORM with multiple plugins
      const orm = await createORM(db, [productPlugin, customerPlugin, orderPlugin]);

      // Create repositories
      const productRepo = orm.createRepository((executor) => {
        const base = createRepositoryFactory(executor);
        return base.create({
          tableName: 'products' as keyof CustomKeyDatabase,
          mapRow: (row) => row as Product,
          schemas: { create: z.any(), update: z.any() },
        });
      }) as any;

      // Soft delete a product by UUID
      await productRepo.softDelete('prod-003-uuid');

      // Verify
      const foundProduct = await productRepo.findById('prod-003-uuid');
      expect(foundProduct).toBeNull();

      const allProducts = await productRepo.findAll();
      expect(allProducts).toHaveLength(2);
    });

    it('should not affect tables not in the configured list', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'uuid',
        tables: ['products'], // Only products
      });
      const orm = await createORM(db, [plugin]);

      // Soft delete a product
      await db
        .updateTable('products')
        .set({ deleted_at: new Date().toISOString() })
        .where('uuid', '=', 'prod-001-uuid')
        .execute();

      // Products query should filter
      const products = await orm.applyPlugins(
        db.selectFrom('products').selectAll(),
        'select',
        'products',
        {}
      ).execute();
      expect(products).toHaveLength(2);

      // Customers query should NOT filter (not in tables list)
      await db
        .updateTable('customers')
        .set({ deleted_at: new Date().toISOString() })
        .where('customer_id', '=', 1)
        .execute();

      const customers = await orm.applyPlugins(
        db.selectFrom('customers').selectAll(),
        'select',
        'customers',
        {}
      ).execute();
      // Should include deleted because customers is not in tables list
      expect(customers).toHaveLength(2);
    });
  });
});
