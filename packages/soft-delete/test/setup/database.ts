import { Kysely, SqliteDialect, type Generated } from 'kysely';
import sqliteConstructor from 'better-sqlite3';
import type { Database as SQLiteDatabase } from 'better-sqlite3';

// Test database schema
export interface TestDatabase {
  users: {
    id: Generated<number>;
    email: string;
    name: string;
    created_at: Generated<string>; // SQLite uses text for dates
    deleted_at: string | null;
  };
  posts: {
    id: Generated<number>;
    user_id: number;
    title: string;
    content: string;
    published: number; // SQLite uses 0/1 for boolean
    created_at: Generated<string>; // SQLite uses text for dates
    updated_at: string | null;
    deleted_at: string | null;
  };
  comments: {
    id: Generated<number>;
    post_id: number;
    user_id: number;
    content: string;
    created_at: Generated<string>; // SQLite uses text for dates
    deleted_at: string | null;
  };
}

// Create in-memory SQLite database for testing
export function createTestDatabase(): {
  db: Kysely<TestDatabase>;
  sqlite: SQLiteDatabase;
  cleanup: () => void;
} {
  // Use in-memory database for speed
  const sqlite = new sqliteConstructor(':memory:');

  const db = new Kysely<TestDatabase>({
    dialect: new SqliteDialect({
      database: sqlite,
    }),
  });

  // Disable foreign key constraints for tests to allow deletion
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

// Initialize test schema
export async function initializeTestSchema(db: Kysely<TestDatabase>): Promise<void> {
  // Create users table
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('name', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
    .addColumn('deleted_at', 'text')
    .execute();

  // Create posts table
  await db.schema
    .createTable('posts')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('user_id', 'integer', (col) => col.notNull().references('users.id'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('content', 'text')
    .addColumn('published', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
    .addColumn('updated_at', 'text')
    .addColumn('deleted_at', 'text')
    .execute();

  // Create comments table
  await db.schema
    .createTable('comments')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('post_id', 'integer', (col) => col.notNull().references('posts.id'))
    .addColumn('user_id', 'integer', (col) => col.notNull().references('users.id'))
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
    .addColumn('deleted_at', 'text')
    .execute();
}

// Seed test data
export async function seedTestData(db: Kysely<TestDatabase>): Promise<void> {
  await initializeTestSchema(db);

  // Insert users
  await db
    .insertInto('users')
    .values([
      { email: 'alice@example.com', name: 'Alice' },
      { email: 'bob@example.com', name: 'Bob' },
      { email: 'charlie@example.com', name: 'Charlie' },
    ])
    .execute();

  // Get user IDs
  const users = await db.selectFrom('users').select('id').orderBy('email').execute();

  // Insert posts
  // Validate users exist
  const firstUser = users[0];
  const secondUser = users[1];
  if (!firstUser || !secondUser) {
    throw new Error('Failed to create test users');
  }

  await db
    .insertInto('posts')
    .values([
      {
        user_id: firstUser.id,
        title: 'First Post',
        content: 'This is the first post content',
        published: 1,
      },
      {
        user_id: firstUser.id,
        title: 'Second Post',
        content: 'This is the second post content',
        published: 0,
      },
      {
        user_id: secondUser.id,
        title: "Bob's Post",
        content: "Bob's post content",
        published: 1,
      },
    ])
    .execute();

  // Get post IDs
  const posts = await db.selectFrom('posts').select('id').orderBy('title').execute();

  // Validate posts exist
  const firstPost = posts[0];
  const secondPost = posts[1];
  const thirdUser = users[2];
  if (!firstPost || !secondPost || !thirdUser) {
    throw new Error('Failed to create test posts or users');
  }

  // Insert comments
  await db
    .insertInto('comments')
    .values([
      {
        post_id: secondPost.id,
        user_id: secondUser.id,
        content: 'Great post!',
      },
      {
        post_id: firstPost.id,
        user_id: thirdUser.id,
        content: 'Thanks for sharing',
      },
    ])
    .execute();
}

// Test transaction helper
export async function withTestTransaction<T>(
  db: Kysely<TestDatabase>,
  fn: (trx: Kysely<TestDatabase>) => Promise<T>
): Promise<T> {
  return await db.transaction().execute(async (trx) => {
    try {
      await fn(trx);
      throw new Error('ROLLBACK_TEST'); // Always rollback
    } catch (error) {
      if ((error as Error).message === 'ROLLBACK_TEST') {
        // This is our intentional rollback
        return undefined as T;
      }
      throw error;
    }
  });
}
