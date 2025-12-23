import { type Kysely, sql } from 'kysely'

export interface Migration {
  name: string
  up: (db: Kysely<any>) => Promise<void>
  down?: (db: Kysely<any>) => Promise<void>
}

export const migrations: Migration[] = [
  {
    name: '001_create_users',
    async up(db) {
      await db.schema
        .createTable('users')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('email', 'varchar(255)', col => col.notNull().unique())
        .addColumn('name', 'varchar(100)', col => col.notNull())
        .addColumn('created_at', 'timestamp', col =>
          col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .addColumn('deleted_at', 'timestamp')
        .execute()

      await db.schema.createIndex('users_email_idx').on('users').column('email').execute()

      await db.schema
        .createIndex('users_deleted_at_idx')
        .on('users')
        .column('deleted_at')
        .where('deleted_at', 'is', null)
        .execute()
    },
    async down(db) {
      await db.schema.dropTable('users').execute()
    }
  },
  {
    name: '002_create_posts',
    async up(db) {
      await db.schema
        .createTable('posts')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('user_id', 'integer', col =>
          col.notNull().references('users.id').onDelete('cascade')
        )
        .addColumn('title', 'varchar(255)', col => col.notNull())
        .addColumn('content', 'text', col => col.notNull())
        .addColumn('published', 'boolean', col => col.defaultTo(false))
        .addColumn('created_at', 'timestamp', col =>
          col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .addColumn('updated_at', 'timestamp')
        .addColumn('deleted_at', 'timestamp')
        .execute()

      await db.schema.createIndex('posts_user_id_idx').on('posts').column('user_id').execute()

      await db.schema.createIndex('posts_published_idx').on('posts').column('published').execute()
    },
    async down(db) {
      await db.schema.dropTable('posts').execute()
    }
  },
  {
    name: '003_create_comments',
    async up(db) {
      await db.schema
        .createTable('comments')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('post_id', 'integer', col =>
          col.notNull().references('posts.id').onDelete('cascade')
        )
        .addColumn('user_id', 'integer', col =>
          col.notNull().references('users.id').onDelete('cascade')
        )
        .addColumn('content', 'text', col => col.notNull())
        .addColumn('created_at', 'timestamp', col =>
          col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
        )
        .addColumn('deleted_at', 'timestamp')
        .execute()

      await db.schema.createIndex('comments_post_id_idx').on('comments').column('post_id').execute()

      await db.schema.createIndex('comments_user_id_idx').on('comments').column('user_id').execute()
    },
    async down(db) {
      await db.schema.dropTable('comments').execute()
    }
  }
]
