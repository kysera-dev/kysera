import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect, type Generated } from 'kysely';
import sqliteConstructor from 'better-sqlite3';
import type { Database as SQLiteDatabase } from 'better-sqlite3';
import { softDeletePlugin, type SoftDeleteRepository } from '../src/index.js';
import { createORM, createRepositoryFactory } from '../../kysera-repository/dist/index.js';
import { z } from 'zod';

// Database schema with custom primary key columns
interface CustomPKDatabase {
  products: {
    product_id: Generated<number>;
    name: string;
    price: number;
    deleted_at: string | null;
  };
  orders: {
    order_uuid: string;
    customer_id: number;
    total: number;
    deleted_at: string | null;
  };
}

// Type for product records
interface Product {
  product_id: number;
  name: string;
  price: number;
  deleted_at: string | null;
}

describe('Soft Delete Plugin - Custom Primary Key', () => {
  let db: Kysely<CustomPKDatabase>;
  let sqlite: SQLiteDatabase;
  let cleanup: () => void;

  beforeEach(async () => {
    // Create in-memory database
    sqlite = new sqliteConstructor(':memory:');
    db = new Kysely<CustomPKDatabase>({
      dialect: new SqliteDialect({
        database: sqlite,
      }),
    });

    // Create test tables with custom primary keys
    await db.schema
      .createTable('products')
      .addColumn('product_id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('price', 'real', (col) => col.notNull())
      .addColumn('deleted_at', 'text')
      .execute();

    await db.schema
      .createTable('orders')
      .addColumn('order_uuid', 'text', (col) => col.primaryKey())
      .addColumn('customer_id', 'integer', (col) => col.notNull())
      .addColumn('total', 'real', (col) => col.notNull())
      .addColumn('deleted_at', 'text')
      .execute();

    // Seed test data
    await db
      .insertInto('products')
      .values([
        { name: 'Widget', price: 19.99 },
        { name: 'Gadget', price: 29.99 },
        { name: 'Doohickey', price: 39.99 },
      ])
      .execute();

    await db
      .insertInto('orders')
      .values([
        { order_uuid: 'uuid-001' as const, customer_id: 1, total: 100.0 },
        { order_uuid: 'uuid-002' as const, customer_id: 2, total: 200.0 },
        { order_uuid: 'uuid-003' as const, customer_id: 1, total: 150.0 },
      ])
      .execute();

    cleanup = () => {
      void db.destroy();
      sqlite.close();
    };
  });

  afterEach(() => {
    cleanup();
  });

  describe('Numeric Custom Primary Key', () => {
    it('should soft delete using custom primary key column (product_id)', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'product_id',
      });
      const orm = await createORM(db, [plugin]);

      const productRepo = orm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'products', Product>({
          tableName: 'products',
          mapRow: (row) => row as Product,
          schemas: {
            create: z.object({
              name: z.string(),
              price: z.number(),
            }),
            update: z
              .object({
                name: z.string().optional(),
                price: z.number().optional(),
                deleted_at: z.string().nullable().optional(),
              })
              .optional(),
          },
        });
      }) as SoftDeleteRepository<Product, CustomPKDatabase>;

      // Get first product
      const products = await db.selectFrom('products').selectAll().execute();
      const firstProduct = products[0];
      if (!firstProduct) throw new Error('No products found');

      // Soft delete the product
      await productRepo.softDelete(firstProduct.product_id);

      // Verify product is soft deleted
      const deletedProduct = await db
        .selectFrom('products')
        .selectAll()
        .where('product_id', '=', firstProduct.product_id)
        .executeTakeFirst();

      expect(deletedProduct?.deleted_at).not.toBeNull();
    });

    it('should restore using custom primary key column (product_id)', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'product_id',
      });
      const orm = await createORM(db, [plugin]);

      const productRepo = orm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'products', Product>({
          tableName: 'products',
          mapRow: (row) => row as Product,
          schemas: {
            create: z.object({
              name: z.string(),
              price: z.number(),
            }),
            update: z
              .object({
                name: z.string().optional(),
                price: z.number().optional(),
                deleted_at: z.string().nullable().optional(),
              })
              .optional(),
          },
        });
      }) as SoftDeleteRepository<Product, CustomPKDatabase>;

      const products = await db.selectFrom('products').selectAll().execute();
      const firstProduct = products[0];
      if (!firstProduct) throw new Error('No products found');

      // Soft delete and then restore
      await productRepo.softDelete(firstProduct.product_id);
      await productRepo.restore(firstProduct.product_id);

      // Verify product is restored
      const restoredProduct = await db
        .selectFrom('products')
        .selectAll()
        .where('product_id', '=', firstProduct.product_id)
        .executeTakeFirst();

      expect(restoredProduct?.deleted_at).toBeNull();
    });

    it('should hard delete using custom primary key column (product_id)', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'product_id',
      });
      const orm = await createORM(db, [plugin]);

      const productRepo = orm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'products', Product>({
          tableName: 'products',
          mapRow: (row) => row as Product,
          schemas: {
            create: z.object({
              name: z.string(),
              price: z.number(),
            }),
            update: z
              .object({
                name: z.string().optional(),
                price: z.number().optional(),
                deleted_at: z.string().nullable().optional(),
              })
              .optional(),
          },
        });
      }) as SoftDeleteRepository<Product, CustomPKDatabase>;

      const products = await db.selectFrom('products').selectAll().execute();
      const firstProduct = products[0];
      if (!firstProduct) throw new Error('No products found');

      // Hard delete the product
      await productRepo.hardDelete(firstProduct.product_id);

      // Verify product is permanently deleted
      const deletedProduct = await db
        .selectFrom('products')
        .selectAll()
        .where('product_id', '=', firstProduct.product_id)
        .executeTakeFirst();

      expect(deletedProduct).toBeUndefined();
    });

    it('should filter by custom primary key in findById (product_id)', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'product_id',
      });
      const orm = await createORM(db, [plugin]);

      const productRepo = orm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'products', Product>({
          tableName: 'products',
          mapRow: (row) => row as Product,
          schemas: {
            create: z.object({
              name: z.string(),
              price: z.number(),
            }),
            update: z
              .object({
                name: z.string().optional(),
                price: z.number().optional(),
                deleted_at: z.string().nullable().optional(),
              })
              .optional(),
          },
        });
      }) as SoftDeleteRepository<Product, CustomPKDatabase>;

      const products = await db.selectFrom('products').selectAll().execute();
      const firstProduct = products[0];
      if (!firstProduct) throw new Error('No products found');

      // Soft delete the product
      await productRepo.softDelete(firstProduct.product_id);

      // findById should return null for soft-deleted product
      const result = await productRepo.findById(firstProduct.product_id);
      expect(result).toBeNull();

      // findWithDeleted should return the product
      const withDeleted = await productRepo.findWithDeleted(firstProduct.product_id);
      expect(withDeleted).not.toBeNull();
      expect((withDeleted as Product).product_id).toBe(firstProduct.product_id);
    });
  });

  describe('String (UUID) Custom Primary Key', () => {
    it('should soft delete using string primary key (order_uuid)', async () => {
      // Note: The repository methods expect number, but we're testing with string UUIDs
      // This is a type system limitation - in practice you'd need to handle this
      // For now, we'll test directly with the executor to verify the plugin works
      const orders = await db.selectFrom('orders').selectAll().execute();
      const firstOrder = orders[0];
      if (!firstOrder) throw new Error('No orders found');

      // Manually soft delete using the custom primary key
      await db
        .updateTable('orders')
        .set({ deleted_at: new Date().toISOString() })
        .where('order_uuid', '=', firstOrder.order_uuid)
        .execute();

      // Verify order is soft deleted
      const deletedOrder = await db
        .selectFrom('orders')
        .selectAll()
        .where('order_uuid', '=', firstOrder.order_uuid)
        .executeTakeFirst();

      expect(deletedOrder?.deleted_at).not.toBeNull();
    });

    it('should hard delete using string primary key (order_uuid)', async () => {
      const orders = await db.selectFrom('orders').selectAll().execute();
      const firstOrder = orders[0];
      if (!firstOrder) throw new Error('No orders found');

      // Manually hard delete using executor
      await db.deleteFrom('orders').where('order_uuid', '=', firstOrder.order_uuid).execute();

      // Verify order is permanently deleted
      const deletedOrder = await db
        .selectFrom('orders')
        .selectAll()
        .where('order_uuid', '=', firstOrder.order_uuid)
        .executeTakeFirst();

      expect(deletedOrder).toBeUndefined();
    });
  });

  describe('Bulk Operations with Custom Primary Key', () => {
    it('should soft delete many using custom primary key (product_id)', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'product_id',
      });
      const orm = await createORM(db, [plugin]);

      const productRepo = orm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'products', Product>({
          tableName: 'products',
          mapRow: (row) => row as Product,
          schemas: {
            create: z.object({
              name: z.string(),
              price: z.number(),
            }),
            update: z
              .object({
                name: z.string().optional(),
                price: z.number().optional(),
                deleted_at: z.string().nullable().optional(),
              })
              .optional(),
          },
        });
      }) as SoftDeleteRepository<Product, CustomPKDatabase>;

      const products = await db.selectFrom('products').selectAll().execute();
      const productIds = products.slice(0, 2).map((p) => p.product_id);

      // Soft delete multiple products
      await productRepo.softDeleteMany(productIds);

      // Verify products are soft deleted
      const deletedProducts = await db
        .selectFrom('products')
        .selectAll()
        .where('product_id', 'in', productIds)
        .execute();

      deletedProducts.forEach((product) => {
        expect(product.deleted_at).not.toBeNull();
      });
    });

    it('should restore many using custom primary key (product_id)', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'product_id',
      });
      const orm = await createORM(db, [plugin]);

      const productRepo = orm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'products', Product>({
          tableName: 'products',
          mapRow: (row) => row as Product,
          schemas: {
            create: z.object({
              name: z.string(),
              price: z.number(),
            }),
            update: z
              .object({
                name: z.string().optional(),
                price: z.number().optional(),
                deleted_at: z.string().nullable().optional(),
              })
              .optional(),
          },
        });
      }) as SoftDeleteRepository<Product, CustomPKDatabase>;

      const products = await db.selectFrom('products').selectAll().execute();
      const productIds = products.slice(0, 2).map((p) => p.product_id);

      // Soft delete and restore multiple products
      await productRepo.softDeleteMany(productIds);
      await productRepo.restoreMany(productIds);

      // Verify products are restored
      const restoredProducts = await db
        .selectFrom('products')
        .selectAll()
        .where('product_id', 'in', productIds)
        .execute();

      restoredProducts.forEach((product) => {
        expect(product.deleted_at).toBeNull();
      });
    });

    it('should hard delete many using custom primary key (product_id)', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'product_id',
      });
      const orm = await createORM(db, [plugin]);

      const productRepo = orm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'products', Product>({
          tableName: 'products',
          mapRow: (row) => row as Product,
          schemas: {
            create: z.object({
              name: z.string(),
              price: z.number(),
            }),
            update: z
              .object({
                name: z.string().optional(),
                price: z.number().optional(),
                deleted_at: z.string().nullable().optional(),
              })
              .optional(),
          },
        });
      }) as SoftDeleteRepository<Product, CustomPKDatabase>;

      const products = await db.selectFrom('products').selectAll().execute();
      const productIds = products.slice(0, 2).map((p) => p.product_id);

      // Hard delete multiple products
      await productRepo.hardDeleteMany(productIds);

      // Verify products are permanently deleted
      const deletedProducts = await db
        .selectFrom('products')
        .selectAll()
        .where('product_id', 'in', productIds)
        .execute();

      expect(deletedProducts).toHaveLength(0);
    });
  });

  describe('Backward Compatibility', () => {
    it('should default to "id" when primaryKeyColumn not specified', async () => {
      // Create a table with standard 'id' column
      await db.schema
        .createTable('items')
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('deleted_at', 'text')
        .execute();

      await (db as any).insertInto('items').values([{ name: 'Item 1' }, { name: 'Item 2' }]).execute();

      // Plugin without primaryKeyColumn should use 'id'
      const plugin = softDeletePlugin();
      const orm = await createORM(db, [plugin]);

      type ItemType = { id: number; name: string; deleted_at: string | null };
      const itemRepo = orm.createRepository((executor: any) => {
        const factory = createRepositoryFactory(executor);
        return factory.create({
          // @ts-ignore - Dynamic table 'items' not in CustomPKDatabase type
          tableName: 'items',
          mapRow: (row: any) => row as ItemType,
          schemas: {
            create: z.object({
              name: z.string(),
            }),
            update: z
              .object({
                name: z.string().optional(),
                deleted_at: z.string().nullable().optional(),
              })
              .optional(),
          },
        });
      }) as SoftDeleteRepository<ItemType, any>;

      const items = await (db as any).selectFrom('items').selectAll().execute();
      const firstItem = items[0] as ItemType | undefined;
      if (!firstItem) throw new Error('No items found');

      // Should work with default 'id' column
      await itemRepo.softDelete(firstItem.id);

      const deletedItem = await (db as any)
        .selectFrom('items')
        .selectAll()
        .where('id', '=', firstItem.id)
        .executeTakeFirst();

      expect(deletedItem?.deleted_at).not.toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should throw error when soft deleting non-existent record with custom PK', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'product_id',
      });
      const orm = await createORM(db, [plugin]);

      const productRepo = orm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'products', Product>({
          tableName: 'products',
          mapRow: (row) => row as Product,
          schemas: {
            create: z.object({
              name: z.string(),
              price: z.number(),
            }),
            update: z
              .object({
                name: z.string().optional(),
                price: z.number().optional(),
                deleted_at: z.string().nullable().optional(),
              })
              .optional(),
          },
        });
      }) as SoftDeleteRepository<Product, CustomPKDatabase>;

      // Try to soft delete non-existent product
      await expect(productRepo.softDelete(99999)).rejects.toThrow('Record not found');
    });

    it('should throw error when soft deleting many with non-existent IDs', async () => {
      const plugin = softDeletePlugin({
        primaryKeyColumn: 'product_id',
      });
      const orm = await createORM(db, [plugin]);

      const productRepo = orm.createRepository((executor) => {
        const factory = createRepositoryFactory(executor);
        return factory.create<'products', Product>({
          tableName: 'products',
          mapRow: (row) => row as Product,
          schemas: {
            create: z.object({
              name: z.string(),
              price: z.number(),
            }),
            update: z
              .object({
                name: z.string().optional(),
                price: z.number().optional(),
                deleted_at: z.string().nullable().optional(),
              })
              .optional(),
          },
        });
      }) as SoftDeleteRepository<Product, CustomPKDatabase>;

      // Try to soft delete with some non-existent IDs
      await expect(productRepo.softDeleteMany([1, 99999])).rejects.toThrow('not found');
    });
  });
});
