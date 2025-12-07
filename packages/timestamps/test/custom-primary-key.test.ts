import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely } from 'kysely';
import Database from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { createORM, createRepositoryFactory } from '../../kysera-repository/dist/index.js';
import { timestampsPlugin, type TimestampsRepository } from '../src';

// Test database schema with custom primary key
interface TestDatabase {
  accounts: {
    account_id: number;
    name: string;
    balance: number;
    created_at?: Date | string | null;
    updated_at?: Date | string | null;
  };
  products: {
    uuid: string;
    title: string;
    price: number;
    created_at?: Date | string | null;
    updated_at?: Date | string | null;
  };
}

describe('Custom Primary Key Support', () => {
  let db: Kysely<TestDatabase>;
  let sqlite: Database.Database;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({ database: sqlite }),
    });

    // Create accounts table with custom primary key
    await db.schema
      .createTable('accounts')
      .addColumn('account_id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('balance', 'integer', (col) => col.notNull())
      .addColumn('created_at', 'text')
      .addColumn('updated_at', 'text')
      .execute();

    // Create products table with UUID primary key
    await db.schema
      .createTable('products')
      .addColumn('uuid', 'text', (col) => col.primaryKey())
      .addColumn('title', 'text', (col) => col.notNull())
      .addColumn('price', 'integer', (col) => col.notNull())
      .addColumn('created_at', 'text')
      .addColumn('updated_at', 'text')
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
    sqlite.close();
  });

  it('should demonstrate that default primary key "id" is used when not configured', async () => {
    // This test demonstrates that when primaryKeyColumn is not configured,
    // the plugin defaults to 'id', which may not match all table schemas.
    // Tables should configure primaryKeyColumn if they use a different column name.

    // Create a users table with standard 'id' primary key to test default behavior
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('email', 'text', (col) => col.notNull())
      .addColumn('created_at', 'text')
      .addColumn('updated_at', 'text')
      .execute();

    const plugin = timestampsPlugin();
    const orm = await createORM(db as any, [plugin]);

    const userRepo = orm.createRepository((executor) => {
      const factory = createRepositoryFactory(executor as any);
      return factory.create({
        // @ts-ignore - Dynamic table 'users' not in TestDatabase type
        tableName: 'users',
        mapRow: (row: any) => row,
        schemas: {
          create: { parse: (v: any) => v } as any,
          update: { parse: (v: any) => v } as any,
        },
      });
    }) as TimestampsRepository<any, any>;

    const user = await userRepo.create({
      email: 'user@example.com',
    });

    const originalCreatedAt = user.created_at;

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Touch should work with default 'id' column
    await userRepo.touch(user.id);

    // Fetch the updated user
    const result = await db
      .selectFrom('users' as any)
      .selectAll()
      .where('id' as any, '=', user.id as any)
      .executeTakeFirst();

    expect(result).toBeDefined();
    expect(result?.['updated_at']).toBeDefined();
    expect(result?.['updated_at']).not.toBe(originalCreatedAt);
  });

  it('should use custom primary key column when configured', async () => {
    const plugin = timestampsPlugin({
      primaryKeyColumn: 'account_id',
    });
    const orm = await createORM<TestDatabase>(db, [plugin]);

    const accountRepo = orm.createRepository((executor) => {
      const factory = createRepositoryFactory<TestDatabase>(executor);
      return factory.create<'accounts', any>({
        tableName: 'accounts',
        mapRow: (row) => row,
        schemas: {
          create: { parse: (v: any) => v } as any,
          update: { parse: (v: any) => v } as any,
        },
      });
    }) as TimestampsRepository<any, TestDatabase>;

    const account = await accountRepo.create({
      name: 'Premium Account',
      balance: 5000,
    });

    const originalName = account.name;
    const originalCreatedAt = account.created_at;
    const accountId = account.account_id;

    // Wait a bit to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Touch the record using the custom primary key
    await accountRepo.touch(accountId);

    // Fetch the updated account
    const touched = await db
      .selectFrom('accounts')
      .selectAll()
      .where('account_id', '=', accountId)
      .executeTakeFirst();

    expect(touched).toBeDefined();
    expect(touched?.name).toBe(originalName); // Name unchanged
    expect(touched?.created_at).toBe(originalCreatedAt); // created_at unchanged
    expect(touched?.updated_at).toBeDefined();
    expect(touched?.updated_at).not.toBe(originalCreatedAt); // updated_at changed
  });

  it('should support string-based primary keys (UUID)', async () => {
    const plugin = timestampsPlugin({
      primaryKeyColumn: 'uuid',
    });
    const orm = await createORM<TestDatabase>(db, [plugin]);

    const productRepo = orm.createRepository((executor) => {
      const factory = createRepositoryFactory<TestDatabase>(executor);
      return factory.create<'products', any>({
        tableName: 'products',
        mapRow: (row) => row,
        schemas: {
          create: { parse: (v: any) => v } as any,
          update: { parse: (v: any) => v } as any,
        },
      });
    });

    // Create a product with a UUID
    const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    await db
      .insertInto('products')
      .values({
        uuid,
        title: 'Test Product',
        price: 2999,
        created_at: new Date().toISOString(),
        updated_at: null,
      })
      .execute();

    // Fetch the product to get initial state
    const product = await db
      .selectFrom('products')
      .selectAll()
      .where('uuid', '=', uuid)
      .executeTakeFirst();

    expect(product).toBeDefined();
    const originalCreatedAt = product?.created_at;

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Create repository with plugin and touch using UUID
    const extendedRepo = plugin.extendRepository!(productRepo) as TimestampsRepository<any, TestDatabase>;
    await extendedRepo.touch(uuid as any);

    // Fetch the updated product
    const touched = await db
      .selectFrom('products')
      .selectAll()
      .where('uuid', '=', uuid)
      .executeTakeFirst();

    expect(touched).toBeDefined();
    expect(touched?.title).toBe('Test Product'); // Title unchanged
    expect(touched?.created_at).toBe(originalCreatedAt); // created_at unchanged
    expect(touched?.updated_at).toBeDefined();
    expect(touched?.updated_at).not.toBe(originalCreatedAt); // updated_at changed
  });

  it('should maintain backward compatibility with default "id" column', async () => {
    // Not specifying primaryKeyColumn should default to 'id'
    const plugin = timestampsPlugin();

    // Create a simple users table with 'id' as primary key
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('email', 'text', (col) => col.notNull())
      .addColumn('created_at', 'text')
      .addColumn('updated_at', 'text')
      .execute();

    const orm = await createORM(db as any, [plugin]);

    const userRepo = orm.createRepository((executor) => {
      const factory = createRepositoryFactory(executor as any);
      return factory.create({
        // @ts-ignore - Dynamic table 'users' not in TestDatabase type
        tableName: 'users',
        mapRow: (row: any) => row,
        schemas: {
          create: { parse: (v: any) => v } as any,
          update: { parse: (v: any) => v } as any,
        },
      });
    }) as TimestampsRepository<any, any>;

    const user = await userRepo.create({
      email: 'user@example.com',
    });

    const originalCreatedAt = user.created_at;

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Touch should work with default 'id' column
    await userRepo.touch(user.id);

    // Fetch the updated user
    const result = await db
      .selectFrom('users' as any)
      .selectAll()
      .where('id' as any, '=', user.id as any)
      .executeTakeFirst();

    expect(result).toBeDefined();
    expect(result?.['updated_at']).toBeDefined();
    expect(result?.['updated_at']).not.toBe(originalCreatedAt);
  });

  it('should work with different primary key columns in different tables', async () => {
    // Create plugin with primary key for accounts
    const accountPlugin = timestampsPlugin({
      primaryKeyColumn: 'account_id',
      tables: ['accounts'],
    });

    // Note: In a real scenario, you'd typically use one plugin with a single primary key column
    // This test demonstrates that the configuration is per-plugin instance
    const orm1 = await createORM<TestDatabase>(db, [accountPlugin]);

    const accountRepo = orm1.createRepository((executor) => {
      const factory = createRepositoryFactory<TestDatabase>(executor);
      return factory.create<'accounts', any>({
        tableName: 'accounts',
        mapRow: (row) => row,
        schemas: {
          create: { parse: (v: any) => v } as any,
          update: { parse: (v: any) => v } as any,
        },
      });
    }) as TimestampsRepository<any, TestDatabase>;

    // Create account
    const account = await accountRepo.create({
      name: 'Multi-Table Test Account',
      balance: 3000,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Touch account using account_id
    await accountRepo.touch(account.account_id);

    const touchedAccount = await db
      .selectFrom('accounts')
      .selectAll()
      .where('account_id', '=', account.account_id)
      .executeTakeFirst();

    expect(touchedAccount?.updated_at).toBeDefined();
  });
});
