import { Kysely, SqliteDialect, type Generated, type Selectable } from 'kysely'
import Database from 'better-sqlite3'
import { beforeAll, afterAll, afterEach } from 'vitest'

// Test database schema
export interface TestDatabase {
  users: UsersTable
  posts: PostsTable
  comments: CommentsTable
}

export interface UsersTable {
  id: Generated<number>
  email: string
  name: string
  created_at: Generated<string>
  updated_at: string | null
  deleted_at: string | null
}

export interface PostsTable {
  id: Generated<number>
  user_id: number
  title: string
  content: string
  published: number // SQLite uses 0/1 for boolean
  created_at: Generated<string>
  updated_at: string | null
  deleted_at: string | null
}

export interface CommentsTable {
  id: Generated<number>
  post_id: number
  user_id: number
  content: string
  created_at: Generated<string>
  updated_at: string | null
}

// Domain types
export type User = Selectable<UsersTable>
export type Post = Selectable<PostsTable>
export type Comment = Selectable<CommentsTable>

/**
 * Create an in-memory SQLite database for testing
 */
export function createTestDatabase(): Kysely<TestDatabase> {
  const sqlite = new Database(':memory:')

  // Enable foreign key constraints
  sqlite.pragma('foreign_keys = ON')

  return new Kysely<TestDatabase>({
    dialect: new SqliteDialect({
      database: sqlite
    })
  })
}

/**
 * Initialize test database schema
 */
export async function initializeTestSchema(db: Kysely<TestDatabase>): Promise<void> {
  // Create users table
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    .addColumn('email', 'text', col => col.notNull().unique())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('created_at', 'text', col => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
    .addColumn('updated_at', 'text')
    .addColumn('deleted_at', 'text')
    .execute()

  // Create posts table
  await db.schema
    .createTable('posts')
    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    .addColumn('user_id', 'integer', col =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('title', 'text', col => col.notNull())
    .addColumn('content', 'text', col => col.notNull())
    .addColumn('published', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('created_at', 'text', col => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
    .addColumn('updated_at', 'text')
    .addColumn('deleted_at', 'text')
    .execute()

  // Create comments table
  await db.schema
    .createTable('comments')
    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    .addColumn('post_id', 'integer', col =>
      col.notNull().references('posts.id').onDelete('cascade')
    )
    .addColumn('user_id', 'integer', col =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('content', 'text', col => col.notNull())
    .addColumn('created_at', 'text', col => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
    .addColumn('updated_at', 'text')
    .execute()

  // Create indexes
  await db.schema
    .createIndex('idx_users_email')
    .on('users')
    .column('email')
    .execute()

  await db.schema
    .createIndex('idx_users_deleted_at')
    .on('users')
    .column('deleted_at')
    .execute()

  await db.schema
    .createIndex('idx_posts_user_id')
    .on('posts')
    .column('user_id')
    .execute()

  await db.schema
    .createIndex('idx_posts_deleted_at')
    .on('posts')
    .column('deleted_at')
    .execute()
}

/**
 * Clear all data from test database
 */
export async function clearTestDatabase(db: Kysely<TestDatabase>): Promise<void> {
  await db.deleteFrom('comments').execute()
  await db.deleteFrom('posts').execute()
  await db.deleteFrom('users').execute()
}

/**
 * Setup test database for a test suite
 */
export function setupTestDatabase() {
  let db: Kysely<TestDatabase>

  beforeAll(async () => {
    db = createTestDatabase()
    await initializeTestSchema(db)
  })

  afterEach(async () => {
    await clearTestDatabase(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  return () => db
}

/**
 * Test data factories
 */
export const testFactories = {
  user(overrides?: Partial<Omit<UsersTable, 'id' | 'created_at'>>): Omit<UsersTable, 'id' | 'created_at'> {
    return {
      email: `test${Date.now()}@example.com`,
      name: 'Test User',
      updated_at: null,
      deleted_at: null,
      ...overrides
    }
  },

  post(user_id: number, overrides?: Partial<Omit<PostsTable, 'id' | 'created_at'>>): Omit<PostsTable, 'id' | 'created_at'> {
    return {
      user_id,
      title: 'Test Post',
      content: 'Test content',
      published: 0,
      updated_at: null,
      deleted_at: null,
      ...overrides
    }
  },

  comment(post_id: number, user_id: number, overrides?: Partial<Omit<CommentsTable, 'id' | 'created_at'>>): Omit<CommentsTable, 'id' | 'created_at'> {
    return {
      post_id,
      user_id,
      content: 'Test comment',
      updated_at: null,
      ...overrides
    }
  }
}

/**
 * Seed test data
 */
export async function seedTestData(db: Kysely<TestDatabase>) {
  // Create users
  const user1 = await db
    .insertInto('users')
    .values(testFactories.user({ email: 'user1@example.com', name: 'User One' }))
    .returningAll()
    .executeTakeFirstOrThrow()

  const user2 = await db
    .insertInto('users')
    .values(testFactories.user({ email: 'user2@example.com', name: 'User Two' }))
    .returningAll()
    .executeTakeFirstOrThrow()

  // Create posts
  const post1 = await db
    .insertInto('posts')
    .values(testFactories.post(user1.id, { title: 'First Post', published: 1 }))
    .returningAll()
    .executeTakeFirstOrThrow()

  const post2 = await db
    .insertInto('posts')
    .values(testFactories.post(user1.id, { title: 'Second Post' }))
    .returningAll()
    .executeTakeFirstOrThrow()

  // Create comments
  await db
    .insertInto('comments')
    .values([
      testFactories.comment(post1.id, user2.id, { content: 'Great post!' }),
      testFactories.comment(post1.id, user1.id, { content: 'Thanks!' })
    ])
    .execute()

  return { user1, user2, post1, post2 }
}

/**
 * Helper to run tests in a transaction that gets rolled back
 */
export async function testInTransaction<T>(
  db: Kysely<TestDatabase>,
  fn: (trx: Kysely<TestDatabase>) => Promise<T>
): Promise<void> {
  class RollbackError extends Error {}

  try {
    await db.transaction().execute(async (trx) => {
      await fn(trx as any)
      throw new RollbackError('ROLLBACK')
    })
  } catch (error) {
    if (!(error instanceof RollbackError)) {
      throw error
    }
  }
}