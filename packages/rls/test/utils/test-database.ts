/**
 * Test Database Utilities for @kysera/rls Integration Tests
 *
 * Provides multi-dialect database support for integration testing with
 * PostgreSQL, MySQL, and SQLite.
 */

import { Kysely, PostgresDialect, MysqlDialect, SqliteDialect, sql, type Generated } from 'kysely';
import type { Pool as PgPool } from 'pg';
import type { Pool as MysqlPool } from 'mysql2/promise';
import Database from 'better-sqlite3';

export type DatabaseType = 'postgres' | 'mysql' | 'sqlite';

/**
 * Test database schema for RLS testing
 * Includes multi-tenant support with tenant_id
 */
export interface RLSTestDatabase {
  users: {
    id: Generated<number>;
    email: string;
    name: string | null;
    tenant_id: number;
    role: string;
    is_active: boolean;
    created_at: Generated<Date | string>;
    updated_at: Date | string | null;
    deleted_at: Date | string | null;
  };
  posts: {
    id: Generated<number>;
    user_id: number;
    tenant_id: number;
    title: string;
    content: string | null;
    status: string;
    is_public: boolean;
    created_at: Generated<Date | string>;
    updated_at: Date | string | null;
  };
  comments: {
    id: Generated<number>;
    post_id: number;
    user_id: number;
    tenant_id: number;
    content: string;
    is_approved: boolean;
    created_at: Generated<Date | string>;
  };
  resources: {
    id: Generated<number>;
    owner_id: number;
    tenant_id: number;
    name: string;
    type: string;
    is_archived: boolean;
    created_at: Generated<Date | string>;
  };
  audit_logs: {
    id: Generated<number>;
    table_name: string;
    operation: string;
    entity_id: string;
    user_id: number | null;
    tenant_id: number | null;
    old_values: string | null;
    new_values: string | null;
    created_at: Generated<Date | string>;
  };
}

/**
 * Database configuration for each type
 */
export const DB_CONFIGS = {
  postgres: {
    host: process.env['POSTGRES_HOST'] || 'localhost',
    port: parseInt(process.env['POSTGRES_PORT'] || '5433', 10),
    database: process.env['POSTGRES_DB'] || 'rls_test',
    user: process.env['POSTGRES_USER'] || 'rls_user',
    password: process.env['POSTGRES_PASSWORD'] || 'rls_pass',
  },
  mysql: {
    host: process.env['MYSQL_HOST'] || 'localhost',
    port: parseInt(process.env['MYSQL_PORT'] || '3307', 10),
    database: process.env['MYSQL_DB'] || 'rls_test',
    user: process.env['MYSQL_USER'] || 'rls_user',
    password: process.env['MYSQL_PASSWORD'] || 'rls_pass',
  },
  sqlite: {
    filename: ':memory:',
  },
};

/**
 * Check if Docker is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const { execSync } = await import('child_process');
    execSync('docker --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a specific database is available
 */
export async function isDatabaseAvailable(type: DatabaseType): Promise<boolean> {
  if (type === 'sqlite') return true;

  try {
    const db = await createTestDb(type);
    await sql`SELECT 1`.execute(db);
    await db.destroy();
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a test database connection
 */
export async function createTestDb(type: DatabaseType): Promise<Kysely<RLSTestDatabase>> {
  switch (type) {
    case 'postgres': {
      const { Pool } = await import('pg');
      return new Kysely<RLSTestDatabase>({
        dialect: new PostgresDialect({
          pool: new Pool(DB_CONFIGS.postgres) as PgPool,
        }),
      });
    }

    case 'mysql': {
      const { createPool } = await import('mysql2');
      return new Kysely<RLSTestDatabase>({
        dialect: new MysqlDialect({
          pool: createPool({
            ...DB_CONFIGS.mysql,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
          }) as unknown as MysqlPool,
        }),
      });
    }

    case 'sqlite': {
      const sqlite = new Database(DB_CONFIGS.sqlite.filename);
      sqlite.pragma('foreign_keys = ON');
      return new Kysely<RLSTestDatabase>({
        dialect: new SqliteDialect({ database: sqlite }),
      });
    }

    default:
      throw new Error(`Unsupported database type: ${type}`);
  }
}

/**
 * Initialize database schema for RLS testing
 */
export async function initializeSchema(db: Kysely<RLSTestDatabase>, type: DatabaseType): Promise<void> {
  // Drop existing tables in reverse dependency order
  await db.schema.dropTable('audit_logs').ifExists().execute();
  await db.schema.dropTable('comments').ifExists().execute();
  await db.schema.dropTable('posts').ifExists().execute();
  await db.schema.dropTable('resources').ifExists().execute();
  await db.schema.dropTable('users').ifExists().execute();

  const isPostgres = type === 'postgres';
  const isSqlite = type === 'sqlite';

  // Create users table
  let usersBuilder = db.schema
    .createTable('users')
    .addColumn('id', isPostgres ? 'serial' : 'integer', (col) =>
      isPostgres ? col.primaryKey() : col.primaryKey().autoIncrement()
    )
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('name', 'varchar(255)')
    .addColumn('tenant_id', 'integer', (col) => col.notNull())
    .addColumn('role', 'varchar(50)', (col) => col.notNull().defaultTo('user'))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(isSqlite ? sql`1` : true));

  if (isSqlite) {
    usersBuilder = usersBuilder
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'text')
      .addColumn('deleted_at', 'text');
  } else {
    usersBuilder = usersBuilder
      .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp')
      .addColumn('deleted_at', 'timestamp');
  }

  await usersBuilder.execute();

  // Create resources table
  let resourcesBuilder = db.schema
    .createTable('resources')
    .addColumn('id', isPostgres ? 'serial' : 'integer', (col) =>
      isPostgres ? col.primaryKey() : col.primaryKey().autoIncrement()
    )
    .addColumn('owner_id', 'integer', (col) => col.notNull())
    .addColumn('tenant_id', 'integer', (col) => col.notNull())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('type', 'varchar(50)', (col) => col.notNull().defaultTo('document'))
    .addColumn('is_archived', 'boolean', (col) => col.notNull().defaultTo(isSqlite ? sql`0` : false));

  if (isSqlite) {
    resourcesBuilder = resourcesBuilder.addColumn('created_at', 'text', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    );
  } else {
    resourcesBuilder = resourcesBuilder
      .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addForeignKeyConstraint('resources_owner_fk', ['owner_id'], 'users', ['id'], (cb) => cb.onDelete('cascade'));
  }

  await resourcesBuilder.execute();

  // For SQLite, recreate with FK
  if (isSqlite) {
    await db.schema.dropTable('resources').execute();
    await db.schema
      .createTable('resources')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('owner_id', 'integer', (col) => col.notNull().references('users.id').onDelete('cascade'))
      .addColumn('tenant_id', 'integer', (col) => col.notNull())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('type', 'varchar(50)', (col) => col.notNull().defaultTo('document'))
      .addColumn('is_archived', 'boolean', (col) => col.notNull().defaultTo(sql`0`))
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  }

  // Create posts table
  let postsBuilder = db.schema
    .createTable('posts')
    .addColumn('id', isPostgres ? 'serial' : 'integer', (col) =>
      isPostgres ? col.primaryKey() : col.primaryKey().autoIncrement()
    )
    .addColumn('user_id', 'integer', (col) => col.notNull())
    .addColumn('tenant_id', 'integer', (col) => col.notNull())
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('content', 'text')
    .addColumn('status', 'varchar(50)', (col) => col.notNull().defaultTo('draft'))
    .addColumn('is_public', 'boolean', (col) => col.notNull().defaultTo(isSqlite ? sql`0` : false));

  if (isSqlite) {
    postsBuilder = postsBuilder
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'text');
  } else {
    postsBuilder = postsBuilder
      .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp')
      .addForeignKeyConstraint('posts_user_fk', ['user_id'], 'users', ['id'], (cb) => cb.onDelete('cascade'));
  }

  await postsBuilder.execute();

  // For SQLite, recreate with FK
  if (isSqlite) {
    await db.schema.dropTable('posts').execute();
    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('user_id', 'integer', (col) => col.notNull().references('users.id').onDelete('cascade'))
      .addColumn('tenant_id', 'integer', (col) => col.notNull())
      .addColumn('title', 'varchar(255)', (col) => col.notNull())
      .addColumn('content', 'text')
      .addColumn('status', 'varchar(50)', (col) => col.notNull().defaultTo('draft'))
      .addColumn('is_public', 'boolean', (col) => col.notNull().defaultTo(sql`0`))
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'text')
      .execute();
  }

  // Create comments table
  let commentsBuilder = db.schema
    .createTable('comments')
    .addColumn('id', isPostgres ? 'serial' : 'integer', (col) =>
      isPostgres ? col.primaryKey() : col.primaryKey().autoIncrement()
    )
    .addColumn('post_id', 'integer', (col) => col.notNull())
    .addColumn('user_id', 'integer', (col) => col.notNull())
    .addColumn('tenant_id', 'integer', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('is_approved', 'boolean', (col) => col.notNull().defaultTo(isSqlite ? sql`0` : false));

  if (isSqlite) {
    commentsBuilder = commentsBuilder.addColumn('created_at', 'text', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    );
  } else {
    commentsBuilder = commentsBuilder
      .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addForeignKeyConstraint('comments_post_fk', ['post_id'], 'posts', ['id'], (cb) => cb.onDelete('cascade'))
      .addForeignKeyConstraint('comments_user_fk', ['user_id'], 'users', ['id'], (cb) => cb.onDelete('cascade'));
  }

  await commentsBuilder.execute();

  // For SQLite, recreate with FK
  if (isSqlite) {
    await db.schema.dropTable('comments').execute();
    await db.schema
      .createTable('comments')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('post_id', 'integer', (col) => col.notNull().references('posts.id').onDelete('cascade'))
      .addColumn('user_id', 'integer', (col) => col.notNull().references('users.id').onDelete('cascade'))
      .addColumn('tenant_id', 'integer', (col) => col.notNull())
      .addColumn('content', 'text', (col) => col.notNull())
      .addColumn('is_approved', 'boolean', (col) => col.notNull().defaultTo(sql`0`))
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  }

  // Create audit_logs table
  let auditBuilder = db.schema
    .createTable('audit_logs')
    .addColumn('id', isPostgres ? 'serial' : 'integer', (col) =>
      isPostgres ? col.primaryKey() : col.primaryKey().autoIncrement()
    )
    .addColumn('table_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('operation', 'varchar(50)', (col) => col.notNull())
    .addColumn('entity_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('user_id', 'integer')
    .addColumn('tenant_id', 'integer')
    .addColumn('old_values', 'text')
    .addColumn('new_values', 'text');

  if (isSqlite) {
    auditBuilder = auditBuilder.addColumn('created_at', 'text', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    );
  } else {
    auditBuilder = auditBuilder.addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    );
  }

  await auditBuilder.execute();

  // Create indexes
  await db.schema.createIndex('idx_users_tenant').on('users').column('tenant_id').execute();
  await db.schema.createIndex('idx_users_role').on('users').column('role').execute();
  await db.schema.createIndex('idx_posts_tenant').on('posts').column('tenant_id').execute();
  await db.schema.createIndex('idx_posts_user').on('posts').column('user_id').execute();
  await db.schema.createIndex('idx_posts_status').on('posts').column('status').execute();
  await db.schema.createIndex('idx_resources_tenant').on('resources').column('tenant_id').execute();
  await db.schema.createIndex('idx_resources_owner').on('resources').column('owner_id').execute();
  await db.schema.createIndex('idx_comments_tenant').on('comments').column('tenant_id').execute();
}

/**
 * Seed database with test data for RLS testing
 */
export async function seedDatabase(db: Kysely<RLSTestDatabase>, type: DatabaseType): Promise<void> {
  const toBool = (val: boolean): any => (type === 'sqlite' ? (val ? 1 : 0) : val);

  // Tenant 1: Acme Corp
  await db
    .insertInto('users')
    .values([
      { email: 'alice@acme.com', name: 'Alice Admin', tenant_id: 1, role: 'admin', is_active: toBool(true) },
      { email: 'bob@acme.com', name: 'Bob User', tenant_id: 1, role: 'user', is_active: toBool(true) },
      { email: 'charlie@acme.com', name: 'Charlie Editor', tenant_id: 1, role: 'editor', is_active: toBool(true) },
      { email: 'disabled@acme.com', name: 'Disabled User', tenant_id: 1, role: 'user', is_active: toBool(false) },
    ])
    .execute();

  // Tenant 2: Beta Inc
  await db
    .insertInto('users')
    .values([
      { email: 'diana@beta.com', name: 'Diana Admin', tenant_id: 2, role: 'admin', is_active: toBool(true) },
      { email: 'eve@beta.com', name: 'Eve User', tenant_id: 2, role: 'user', is_active: toBool(true) },
    ])
    .execute();

  // Get user IDs
  const users = await db.selectFrom('users').select(['id', 'email', 'tenant_id']).execute();
  const alice = users.find((u) => u.email === 'alice@acme.com')!;
  const bob = users.find((u) => u.email === 'bob@acme.com')!;
  const charlie = users.find((u) => u.email === 'charlie@acme.com')!;
  const diana = users.find((u) => u.email === 'diana@beta.com')!;
  const eve = users.find((u) => u.email === 'eve@beta.com')!;

  // Create resources (for owner-based access testing)
  await db
    .insertInto('resources')
    .values([
      { owner_id: alice.id, tenant_id: 1, name: 'Alice Doc', type: 'document', is_archived: toBool(false) },
      { owner_id: bob.id, tenant_id: 1, name: 'Bob Doc', type: 'document', is_archived: toBool(false) },
      { owner_id: bob.id, tenant_id: 1, name: 'Bob Archived', type: 'document', is_archived: toBool(true) },
      { owner_id: diana.id, tenant_id: 2, name: 'Diana Doc', type: 'document', is_archived: toBool(false) },
    ])
    .execute();

  // Create posts (for status-based access testing)
  await db
    .insertInto('posts')
    .values([
      {
        user_id: alice.id,
        tenant_id: 1,
        title: 'Public Post by Alice',
        content: 'This is public',
        status: 'published',
        is_public: toBool(true),
      },
      {
        user_id: alice.id,
        tenant_id: 1,
        title: 'Draft Post by Alice',
        content: 'Work in progress',
        status: 'draft',
        is_public: toBool(false),
      },
      {
        user_id: bob.id,
        tenant_id: 1,
        title: 'Bob Published',
        content: 'Bob content',
        status: 'published',
        is_public: toBool(false),
      },
      {
        user_id: charlie.id,
        tenant_id: 1,
        title: 'Charlie Draft',
        content: 'Editor draft',
        status: 'draft',
        is_public: toBool(false),
      },
      {
        user_id: diana.id,
        tenant_id: 2,
        title: 'Beta Company Post',
        content: 'Tenant 2 content',
        status: 'published',
        is_public: toBool(true),
      },
    ])
    .execute();

  // Get post IDs
  const posts = await db.selectFrom('posts').select(['id', 'title', 'tenant_id']).execute();
  const alicePublic = posts.find((p) => p.title === 'Public Post by Alice')!;
  const bobPost = posts.find((p) => p.title === 'Bob Published')!;

  // Create comments
  await db
    .insertInto('comments')
    .values([
      { post_id: alicePublic.id, user_id: bob.id, tenant_id: 1, content: 'Great post!', is_approved: toBool(true) },
      {
        post_id: alicePublic.id,
        user_id: charlie.id,
        tenant_id: 1,
        content: 'Pending approval',
        is_approved: toBool(false),
      },
      { post_id: bobPost.id, user_id: alice.id, tenant_id: 1, content: 'Admin comment', is_approved: toBool(true) },
      { post_id: alicePublic.id, user_id: eve.id, tenant_id: 2, content: 'Cross-tenant comment', is_approved: toBool(false) },
    ])
    .execute();
}

/**
 * Clear all data from database
 */
export async function clearDatabase(db: Kysely<RLSTestDatabase>): Promise<void> {
  await db.deleteFrom('audit_logs').execute();
  await db.deleteFrom('comments').execute();
  await db.deleteFrom('posts').execute();
  await db.deleteFrom('resources').execute();
  await db.deleteFrom('users').execute();
}

/**
 * Setup test database with Vitest hooks
 */
export function setupRLSTestDatabase(type: DatabaseType = 'sqlite') {
  let db: Kysely<RLSTestDatabase>;

  beforeAll(async () => {
    db = await createTestDb(type);
    await initializeSchema(db, type);
  });

  beforeEach(async () => {
    await clearDatabase(db);
    await seedDatabase(db, type);
  });

  afterAll(async () => {
    await db.destroy();
  });

  return () => db;
}

/**
 * Get available database types for testing
 */
export function getAvailableDatabaseTypes(): DatabaseType[] {
  const types: DatabaseType[] = ['sqlite'];

  if (process.env['TEST_POSTGRES'] === 'true') {
    types.push('postgres');
  }

  if (process.env['TEST_MYSQL'] === 'true') {
    types.push('mysql');
  }

  return types;
}

/**
 * Skip test if database is not available
 */
export function skipIfUnavailable(type: DatabaseType) {
  return async () => {
    if (type === 'sqlite') return;

    const available = await isDatabaseAvailable(type);
    if (!available) {
      console.warn(`Skipping ${type} tests - database not available`);
      return 'Database not available';
    }
  };
}
