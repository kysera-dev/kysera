import { Kysely, SqliteDialect, type Generated } from 'kysely'
import SQLite from 'better-sqlite3'
import type { Database as SQLiteDatabase } from 'better-sqlite3'

// Test database schema
export interface TestDatabase {
  users: {
    id: Generated<number>
    email: string
    name: string
    created_at: Generated<Date>
    deleted_at: Date | null
  }
  posts: {
    id: Generated<number>
    user_id: number
    title: string
    content: string
    published: number  // SQLite uses 0/1 for boolean
    created_at: Generated<Date>
    updated_at: Date | null
    deleted_at: Date | null
  }
  comments: {
    id: Generated<number>
    post_id: number
    user_id: number
    content: string
    created_at: Generated<Date>
  }
}

// Create in-memory SQLite database for testing
export function createTestDatabase(): {
  db: Kysely<TestDatabase>
  sqlite: SQLiteDatabase
  cleanup: () => void
} {
  // Use in-memory database for speed
  const sqlite = new SQLite(':memory:')

  const db = new Kysely<TestDatabase>({
    dialect: new SqliteDialect({
      database: sqlite
    })
  })

  // Enable foreign key constraints in SQLite
  sqlite.exec('PRAGMA foreign_keys = ON')

  // Create tables
  sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME
    );

    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      published BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      deleted_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Create indexes
    CREATE INDEX idx_posts_user_id ON posts(user_id);
    CREATE INDEX idx_posts_deleted_at ON posts(deleted_at);
    CREATE INDEX idx_comments_post_id ON comments(post_id);
    CREATE INDEX idx_comments_user_id ON comments(user_id);
    CREATE INDEX idx_users_deleted_at ON users(deleted_at);
  `)

  const cleanup = async () => {
    await db.destroy()
    sqlite.close()
  }

  return { db, sqlite, cleanup }
}

// Seed test data
export async function seedTestData(db: Kysely<TestDatabase>) {
  // Insert users
  const users = await db
    .insertInto('users')
    .values([
      { email: 'alice@example.com', name: 'Alice' },
      { email: 'bob@example.com', name: 'Bob' },
      { email: 'charlie@example.com', name: 'Charlie' }
    ])
    .returningAll()
    .execute()

  // Insert posts
  const posts = await db
    .insertInto('posts')
    .values([
      {
        user_id: users[0]!.id,
        title: 'First Post',
        content: 'This is the first post content',
        published: 1
      },
      {
        user_id: users[0]!.id,
        title: 'Second Post',
        content: 'This is the second post content',
        published: 0
      },
      {
        user_id: users[1]!.id,
        title: 'Bob\'s Post',
        content: 'This is Bob\'s post content',
        published: 1
      }
    ])
    .returningAll()
    .execute()

  // Insert comments
  await db
    .insertInto('comments')
    .values([
      {
        post_id: posts[0]!.id,
        user_id: users[1]!.id,
        content: 'Great post!'
      },
      {
        post_id: posts[0]!.id,
        user_id: users[2]!.id,
        content: 'Thanks for sharing!'
      },
      {
        post_id: posts[2]!.id,
        user_id: users[0]!.id,
        content: 'Nice work, Bob!'
      }
    ])
    .execute()

  return { users, posts }
}

// Transaction test helper
export async function withTestTransaction<T>(
  db: Kysely<TestDatabase>,
  fn: (trx: Kysely<TestDatabase>) => Promise<T>
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    try {
      await fn(trx)
      throw new Error('ROLLBACK_TEST') // Always rollback
    } catch (error) {
      if ((error as Error).message === 'ROLLBACK_TEST') {
        // This is our intentional rollback
        return undefined as T
      }
      throw error
    }
  })
}