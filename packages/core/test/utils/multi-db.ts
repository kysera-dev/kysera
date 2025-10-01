import { Kysely, PostgresDialect, MysqlDialect, SqliteDialect, sql, type Generated } from 'kysely'
import { Pool } from 'pg'
import { createPool } from 'mysql2'
import Database from 'better-sqlite3'

export type DatabaseType = 'postgres' | 'mysql' | 'sqlite'

export interface MultiDbTestDatabase {
  users: {
    id: Generated<number>
    email: string
    name: string | null
    created_at: Generated<Date | string>
    updated_at: Date | string | null
    deleted_at: Date | string | null
  }
  posts: {
    id: Generated<number>
    user_id: number
    title: string
    content: string | null
    published: boolean
    created_at: Generated<Date | string>
    updated_at: Date | string | null
  }
  comments: {
    id: Generated<number>
    post_id: number
    user_id: number
    content: string
    created_at: Generated<Date | string>
  }
  categories: {
    id: Generated<number>
    name: string
    slug: string
    parent_id: number | null
  }
  post_categories: {
    post_id: number
    category_id: number
  }
  audit_logs: {
    id: Generated<number>
    table_name: string
    operation: string
    entity_id: string
    old_values: string | null
    new_values: string | null
    changed_by: string | null
    changed_at: Date | string
    metadata: string | null
  }
}

/**
 * Configuration for each database type
 */
export const DB_CONFIGS = {
  postgres: {
    host: 'localhost',
    port: 5432,
    database: 'kysera_test',
    user: 'test',
    password: 'test'
  },
  mysql: {
    host: 'localhost',
    port: 3306,
    database: 'kysera_test',
    user: 'test',
    password: 'test'
  },
  sqlite: {
    filename: ':memory:'
  }
}

/**
 * Create a test database connection
 */
export function createTestDb(type: DatabaseType): Kysely<MultiDbTestDatabase> {
  switch (type) {
    case 'postgres':
      return new Kysely<MultiDbTestDatabase>({
        dialect: new PostgresDialect({
          pool: new Pool(DB_CONFIGS.postgres)
        })
      })

    case 'mysql':
      return new Kysely<MultiDbTestDatabase>({
        dialect: new MysqlDialect({
          pool: createPool({
            ...DB_CONFIGS.mysql,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
          })
        })
      })

    case 'sqlite':
      const sqlite = new Database(DB_CONFIGS.sqlite.filename)
      // Enable foreign keys for SQLite
      sqlite.pragma('foreign_keys = ON')
      return new Kysely<MultiDbTestDatabase>({
        dialect: new SqliteDialect({ database: sqlite })
      })

    default:
      throw new Error(`Unsupported database type: ${type}`)
  }
}

/**
 * Initialize database schema
 */
export async function initializeSchema(db: Kysely<any>, type: DatabaseType): Promise<void> {
  // Drop existing tables
  await db.schema.dropTable('post_categories').ifExists().execute()
  await db.schema.dropTable('comments').ifExists().execute()
  await db.schema.dropTable('posts').ifExists().execute()
  await db.schema.dropTable('categories').ifExists().execute()
  await db.schema.dropTable('users').ifExists().execute()
  await db.schema.dropTable('audit_logs').ifExists().execute()

  // Create users table
  let usersTable = db.schema
    .createTable('users')
    .addColumn('id', type === 'postgres' ? 'serial' : 'integer', col =>
      type === 'postgres' ? col.primaryKey() : col.primaryKey().autoIncrement())
    .addColumn('email', 'varchar(255)', col => col.notNull().unique())
    .addColumn('name', 'varchar(255)')

  if (type === 'sqlite') {
    usersTable = usersTable
      .addColumn('created_at', 'text', col => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
      .addColumn('updated_at', 'text')
      .addColumn('deleted_at', 'text')
  } else {
    usersTable = usersTable
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp')
      .addColumn('deleted_at', 'timestamp')
  }

  await usersTable.execute()

  // Create posts table
  let postsTable = db.schema
    .createTable('posts')
    .addColumn('id', type === 'postgres' ? 'serial' : 'integer', col =>
      type === 'postgres' ? col.primaryKey() : col.primaryKey().autoIncrement())
    .addColumn('user_id', 'integer', col => col.notNull())
    .addColumn('title', 'varchar(255)', col => col.notNull())
    .addColumn('content', 'text')
    .addColumn('published', 'boolean', col => col.notNull().defaultTo(false))

  if (type === 'sqlite') {
    postsTable = postsTable
      .addColumn('created_at', 'text', col => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
      .addColumn('updated_at', 'text')
  } else {
    postsTable = postsTable
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp')
  }

  // Add foreign key constraint
  if (type === 'sqlite') {
    // SQLite doesn't support adding FK after table creation, must be inline
    // But inline references in Kysely don't support cascade for SQLite properly
    // We'll add it manually via raw SQL after table creation
  } else {
    // MySQL and PostgreSQL: add explicit foreign key constraint
    postsTable = postsTable.addForeignKeyConstraint(
      'posts_user_id_fk',
      ['user_id'],
      'users',
      ['id'],
      cb => cb.onDelete('cascade')
    )
  }

  await postsTable.execute()

  // For SQLite, we need to recreate the table with proper foreign key
  if (type === 'sqlite') {
    await db.schema.dropTable('posts').execute()

    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('user_id', 'integer', col =>
        col.notNull().references('users.id').onDelete('cascade'))
      .addColumn('title', 'varchar(255)', col => col.notNull())
      .addColumn('content', 'text')
      .addColumn('published', 'boolean', col => col.notNull().defaultTo(false))
      .addColumn('created_at', 'text', col => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
      .addColumn('updated_at', 'text')
      .execute()
  }

  // Create comments table
  let commentsTable = db.schema
    .createTable('comments')
    .addColumn('id', type === 'postgres' ? 'serial' : 'integer', col =>
      type === 'postgres' ? col.primaryKey() : col.primaryKey().autoIncrement())
    .addColumn('post_id', 'integer', col => col.notNull())
    .addColumn('user_id', 'integer', col => col.notNull())
    .addColumn('content', 'text', col => col.notNull())

  if (type === 'sqlite') {
    commentsTable = commentsTable
      .addColumn('created_at', 'text', col => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
  } else {
    commentsTable = commentsTable
      .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
  }

  // Add foreign key constraints
  if (type !== 'sqlite') {
    commentsTable = commentsTable
      .addForeignKeyConstraint('comments_post_id_fk', ['post_id'], 'posts', ['id'], cb => cb.onDelete('cascade'))
      .addForeignKeyConstraint('comments_user_id_fk', ['user_id'], 'users', ['id'], cb => cb.onDelete('cascade'))
  }

  await commentsTable.execute()

  // For SQLite, recreate with inline foreign keys
  if (type === 'sqlite') {
    await db.schema.dropTable('comments').execute()

    await db.schema
      .createTable('comments')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('post_id', 'integer', col =>
        col.notNull().references('posts.id').onDelete('cascade'))
      .addColumn('user_id', 'integer', col =>
        col.notNull().references('users.id').onDelete('cascade'))
      .addColumn('content', 'text', col => col.notNull())
      .addColumn('created_at', 'text', col => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
      .execute()
  }

  // Create categories table
  let categoriesTable = db.schema
    .createTable('categories')
    .addColumn('id', type === 'postgres' ? 'serial' : 'integer', col =>
      type === 'postgres' ? col.primaryKey() : col.primaryKey().autoIncrement())
    .addColumn('name', 'varchar(255)', col => col.notNull())
    .addColumn('slug', 'varchar(255)', col => col.notNull().unique())
    .addColumn('parent_id', 'integer')

  if (type !== 'sqlite') {
    categoriesTable = categoriesTable.addForeignKeyConstraint(
      'categories_parent_id_fk',
      ['parent_id'],
      'categories',
      ['id'],
      cb => cb.onDelete('cascade')
    )
  }

  await categoriesTable.execute()

  // For SQLite, recreate with inline foreign key
  if (type === 'sqlite') {
    await db.schema.dropTable('categories').execute()

    await db.schema
      .createTable('categories')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('name', 'varchar(255)', col => col.notNull())
      .addColumn('slug', 'varchar(255)', col => col.notNull().unique())
      .addColumn('parent_id', 'integer', col =>
        col.references('categories.id').onDelete('cascade'))
      .execute()
  }

  // Create post_categories junction table
  let postCategoriesTable = db.schema
    .createTable('post_categories')
    .addColumn('post_id', 'integer', col => col.notNull())
    .addColumn('category_id', 'integer', col => col.notNull())
    .addPrimaryKeyConstraint('pk_post_categories', ['post_id', 'category_id'])

  if (type !== 'sqlite') {
    postCategoriesTable = postCategoriesTable
      .addForeignKeyConstraint('pc_post_id_fk', ['post_id'], 'posts', ['id'], cb => cb.onDelete('cascade'))
      .addForeignKeyConstraint('pc_category_id_fk', ['category_id'], 'categories', ['id'], cb => cb.onDelete('cascade'))
  }

  await postCategoriesTable.execute()

  // For SQLite, recreate with inline foreign keys
  if (type === 'sqlite') {
    await db.schema.dropTable('post_categories').execute()

    await db.schema
      .createTable('post_categories')
      .addColumn('post_id', 'integer', col =>
        col.notNull().references('posts.id').onDelete('cascade'))
      .addColumn('category_id', 'integer', col =>
        col.notNull().references('categories.id').onDelete('cascade'))
      .addPrimaryKeyConstraint('pk_post_categories', ['post_id', 'category_id'])
      .execute()
  }

  // Create audit_logs table
  let auditTable = db.schema
    .createTable('audit_logs')
    .addColumn('id', type === 'postgres' ? 'serial' : 'integer', col =>
      type === 'postgres' ? col.primaryKey() : col.primaryKey().autoIncrement())
    .addColumn('table_name', 'varchar(255)', col => col.notNull())
    .addColumn('operation', 'varchar(50)', col => col.notNull())
    .addColumn('entity_id', 'varchar(255)', col => col.notNull())
    .addColumn('old_values', 'text')
    .addColumn('new_values', 'text')
    .addColumn('changed_by', 'varchar(255)')

  if (type === 'sqlite') {
    auditTable = auditTable
      .addColumn('changed_at', 'text', col => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
  } else {
    auditTable = auditTable
      .addColumn('changed_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
  }

  auditTable = auditTable.addColumn('metadata', 'text')

  await auditTable.execute()

  // Create indexes
  await db.schema
    .createIndex('idx_users_email')
    .on('users')
    .column('email')
    .execute()

  await db.schema
    .createIndex('idx_posts_user_id')
    .on('posts')
    .column('user_id')
    .execute()

  await db.schema
    .createIndex('idx_posts_published')
    .on('posts')
    .column('published')
    .execute()

  await db.schema
    .createIndex('idx_comments_post_id')
    .on('comments')
    .column('post_id')
    .execute()

  await db.schema
    .createIndex('idx_audit_logs_table_name')
    .on('audit_logs')
    .column('table_name')
    .execute()

  await db.schema
    .createIndex('idx_audit_logs_entity_id')
    .on('audit_logs')
    .column('entity_id')
    .execute()
}

/**
 * Seed database with test data
 */
export async function seedDatabase(db: Kysely<MultiDbTestDatabase>, type?: DatabaseType): Promise<void> {
  // Insert users
  await db
    .insertInto('users')
    .values([
      { email: 'alice@example.com', name: 'Alice' },
      { email: 'bob@example.com', name: 'Bob' },
      { email: 'charlie@example.com', name: 'Charlie' },
      { email: 'diana@example.com', name: 'Diana' },
      { email: 'eve@example.com', name: 'Eve' }
    ])
    .execute()

  // Get user IDs
  const users = await db.selectFrom('users').select('id').orderBy('email').execute()

  // Insert categories
  await db
    .insertInto('categories')
    .values([
      { name: 'Technology', slug: 'technology', parent_id: null },
      { name: 'Science', slug: 'science', parent_id: null }
    ])
    .execute()

  // Get inserted category IDs
  const techCategory = await db.selectFrom('categories').select('id').where('slug', '=', 'technology').executeTakeFirst()
  const sciCategory = await db.selectFrom('categories').select('id').where('slug', '=', 'science').executeTakeFirst()

  // Insert child categories with correct parent IDs
  await db
    .insertInto('categories')
    .values([
      { name: 'Programming', slug: 'programming', parent_id: techCategory?.id ?? null },
      { name: 'Physics', slug: 'physics', parent_id: sciCategory?.id ?? null }
    ])
    .execute()

  const progCategory = await db.selectFrom('categories').select('id').where('slug', '=', 'programming').executeTakeFirst()

  await db
    .insertInto('categories')
    .values([
      { name: 'Web Development', slug: 'web-dev', parent_id: progCategory?.id ?? null },
      { name: 'AI/ML', slug: 'ai-ml', parent_id: techCategory?.id ?? null }
    ])
    .execute()

  // Get category IDs
  const categories = await db.selectFrom('categories').select('id').orderBy('name').execute()

  // Insert posts (handle boolean for SQLite)
  const toBool = (val: boolean): any => {
    return type === 'sqlite' ? (val ? 1 : 0) : val
  }

  await db
    .insertInto('posts')
    .values([
      {
        user_id: users[0]!.id,  // alice
        title: 'Introduction to TypeScript',
        content: 'TypeScript is a typed superset of JavaScript...',
        published: toBool(true)
      },
      {
        user_id: users[0]!.id,  // alice
        title: 'Advanced TypeScript Patterns',
        content: 'Let\'s explore some advanced patterns...',
        published: toBool(true)
      },
      {
        user_id: users[1]!.id,  // bob
        title: 'Getting Started with Kysely',
        content: 'Kysely is a type-safe SQL query builder...',
        published: toBool(true)
      },
      {
        user_id: users[1]!.id,  // bob
        title: 'Draft Post',
        content: 'This is a work in progress...',
        published: toBool(false)
      },
      {
        user_id: users[2]!.id,  // charlie
        title: 'Database Performance Tips',
        content: 'Here are some tips for optimizing database performance...',
        published: toBool(true)
      }
    ])
    .execute()

  // Get post IDs
  const posts = await db.selectFrom('posts').select('id').orderBy('title').execute()

  // Insert comments
  await db
    .insertInto('comments')
    .values([
      {
        post_id: posts[3]!.id,  // Introduction to TypeScript
        user_id: users[1]!.id,  // bob
        content: 'Great introduction!'
      },
      {
        post_id: posts[3]!.id,  // Introduction to TypeScript
        user_id: users[2]!.id,  // charlie
        content: 'Very helpful, thanks!'
      },
      {
        post_id: posts[0]!.id,  // Advanced TypeScript Patterns
        user_id: users[3]!.id,  // diana
        content: 'Could you provide more examples?'
      },
      {
        post_id: posts[2]!.id,  // Getting Started with Kysely
        user_id: users[0]!.id,  // alice
        content: 'Kysely looks promising!'
      }
    ])
    .execute()

  // Link posts to categories
  await db
    .insertInto('post_categories')
    .values([
      { post_id: posts[3]!.id, category_id: categories[3]!.id },  // Introduction to TypeScript - Web Dev
      { post_id: posts[0]!.id, category_id: categories[3]!.id },  // Advanced TypeScript - Web Dev
      { post_id: posts[2]!.id, category_id: categories[1]!.id },  // Getting Started with Kysely - Programming
      { post_id: posts[1]!.id, category_id: categories[2]!.id }   // Database Performance - Technology
    ])
    .execute()
}

/**
 * Clear all data from database
 */
export async function clearDatabase(db: Kysely<MultiDbTestDatabase>): Promise<void> {
  await db.deleteFrom('comments').execute()
  await db.deleteFrom('post_categories').execute()
  await db.deleteFrom('posts').execute()
  await db.deleteFrom('categories').execute()
  await db.deleteFrom('users').execute()
  await db.deleteFrom('audit_logs').execute()
}