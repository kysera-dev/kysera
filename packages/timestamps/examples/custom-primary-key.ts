/**
 * Example: Custom Primary Key Configuration
 *
 * This example demonstrates how to use the timestampsPlugin with custom primary key columns.
 * By default, the plugin uses 'id' as the primary key column for the touch() method.
 * If your tables use different column names (e.g., 'uuid', 'user_id', 'account_id'),
 * you can configure the plugin to use those columns instead.
 */

import { Kysely, Generated } from 'kysely';
import { createORM, createRepositoryFactory } from '@kysera/repository';
import { timestampsPlugin } from '@kysera/timestamps';

// Example 1: Using 'user_id' as primary key
interface Database {
  users: {
    user_id: Generated<number>; // Custom primary key
    email: string;
    name: string;
    created_at: Generated<Date>;
    updated_at: Date | null;
  };
}

// Configure the plugin with custom primary key
const plugin = timestampsPlugin({
  primaryKeyColumn: 'user_id', // Specify custom primary key column
});

// Example usage
async function example(db: Kysely<Database>) {
  const orm = await createORM(db, [plugin]);

  const userRepo = orm.createRepository((executor) => {
    const factory = createRepositoryFactory(executor);
    return factory.create({
      tableName: 'users',
      mapRow: (row) => row,
      schemas: {
        create: { parse: (v: any) => v },
        update: { parse: (v: any) => v },
      },
    });
  });

  // Create a user
  const user = await userRepo.create({
    email: 'alice@example.com',
    name: 'Alice',
  });

  console.log('Created user:', user);
  // Output: { user_id: 1, email: 'alice@example.com', name: 'Alice', created_at: '2024-...', updated_at: null }

  // Touch the user using the custom primary key
  // The plugin will use 'user_id' instead of 'id' for the WHERE clause
  await userRepo.touch(user.user_id);

  console.log('Touched user - updated_at timestamp updated');
}

// Example 2: Using UUID as primary key
interface ProductDatabase {
  products: {
    uuid: string; // UUID primary key
    title: string;
    price: number;
    created_at: Generated<Date>;
    updated_at: Date | null;
  };
}

const uuidPlugin = timestampsPlugin({
  primaryKeyColumn: 'uuid', // Use UUID column
});

async function uuidExample(db: Kysely<ProductDatabase>) {
  const orm = await createORM(db, [uuidPlugin]);

  const productRepo = orm.createRepository((executor) => {
    const factory = createRepositoryFactory(executor);
    return factory.create({
      tableName: 'products',
      mapRow: (row) => row,
      schemas: {
        create: { parse: (v: any) => v },
        update: { parse: (v: any) => v },
      },
    });
  });

  // Create a product
  const product = await productRepo.create({
    uuid: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    title: 'Widget',
    price: 2999,
  });

  // Touch using UUID
  await productRepo.touch(product.uuid as any);

  console.log('Product touched using UUID primary key');
}

// Example 3: Multiple tables with different primary keys
interface MultiTableDatabase {
  accounts: {
    account_id: Generated<number>;
    name: string;
    created_at: Generated<Date>;
    updated_at: Date | null;
  };
  transactions: {
    transaction_id: Generated<number>;
    amount: number;
    created_at: Generated<Date>;
    updated_at: Date | null;
  };
}

// Note: If you have multiple tables with different primary key columns,
// you might need to use multiple plugin instances with table filtering:

const accountPlugin = timestampsPlugin({
  primaryKeyColumn: 'account_id',
  tables: ['accounts'], // Only apply to accounts table
});

const transactionPlugin = timestampsPlugin({
  primaryKeyColumn: 'transaction_id',
  tables: ['transactions'], // Only apply to transactions table
});

async function multiTableExample(db: Kysely<MultiTableDatabase>) {
  const orm = await createORM(db, [accountPlugin, transactionPlugin]);

  // Both repositories will use their respective primary key columns for touch()
  const accountRepo = orm.createRepository((executor) => {
    const factory = createRepositoryFactory(executor);
    return factory.create({
      tableName: 'accounts',
      mapRow: (row) => row,
      schemas: {
        create: { parse: (v: any) => v },
        update: { parse: (v: any) => v },
      },
    });
  });

  const account = await accountRepo.create({
    name: 'Premium Account',
  });

  // Uses 'account_id' for WHERE clause
  await accountRepo.touch(account.account_id);
}

// Example 4: Backward compatibility (default behavior)
interface StandardDatabase {
  posts: {
    id: Generated<number>; // Standard 'id' primary key
    title: string;
    content: string;
    created_at: Generated<Date>;
    updated_at: Date | null;
  };
}

// Don't specify primaryKeyColumn - defaults to 'id'
const defaultPlugin = timestampsPlugin();

async function backwardCompatibilityExample(db: Kysely<StandardDatabase>) {
  const orm = await createORM(db, [defaultPlugin]);

  const postRepo = orm.createRepository((executor) => {
    const factory = createRepositoryFactory(executor);
    return factory.create({
      tableName: 'posts',
      mapRow: (row) => row,
      schemas: {
        create: { parse: (v: any) => v },
        update: { parse: (v: any) => v },
      },
    });
  });

  const post = await postRepo.create({
    title: 'Hello World',
    content: 'This is my first post',
  });

  // Works with default 'id' column
  await postRepo.touch(post.id);

  console.log('Backward compatible - uses default "id" column');
}

/**
 * Key Points:
 *
 * 1. The primaryKeyColumn option only affects the touch() method
 * 2. The update() method uses the repository's own primary key logic
 * 3. Default value is 'id' for backward compatibility
 * 4. Supports any column type (number, string, etc.)
 * 5. Configure per plugin instance for different tables
 *
 * Database Setup Example (PostgreSQL):
 *
 * -- Table with custom primary key
 * CREATE TABLE users (
 *   user_id SERIAL PRIMARY KEY,
 *   email VARCHAR(255) NOT NULL,
 *   name VARCHAR(255) NOT NULL,
 *   created_at TIMESTAMP DEFAULT NOW(),
 *   updated_at TIMESTAMP
 * );
 *
 * -- Table with UUID primary key
 * CREATE TABLE products (
 *   uuid UUID PRIMARY KEY,
 *   title VARCHAR(255) NOT NULL,
 *   price INTEGER NOT NULL,
 *   created_at TIMESTAMP DEFAULT NOW(),
 *   updated_at TIMESTAMP
 * );
 */
