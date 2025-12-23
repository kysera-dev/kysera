import { type Kysely, sql } from 'kysely'

export interface Migration {
  name: string
  up: (db: Kysely<any>) => Promise<void>
  down?: (db: Kysely<any>) => Promise<void>
}

export const migrations: Migration[] = [
  {
    name: '001_create_tenants',
    async up(db) {
      await db.schema
        .createTable('tenants')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('name', 'varchar(255)', col => col.notNull())
        .addColumn('slug', 'varchar(100)', col => col.notNull().unique())
        .addColumn('plan', 'varchar(20)', col => col.notNull().defaultTo('free'))
        .addColumn('max_users', 'integer', col => col.notNull().defaultTo(5))
        .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .execute()

      await db.schema.createIndex('tenants_slug_idx').on('tenants').column('slug').execute()
    },
    async down(db) {
      await db.schema.dropTable('tenants').execute()
    }
  },
  {
    name: '002_create_users',
    async up(db) {
      await db.schema
        .createTable('users')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('tenant_id', 'integer', col =>
          col.notNull().references('tenants.id').onDelete('cascade')
        )
        .addColumn('email', 'varchar(255)', col => col.notNull())
        .addColumn('name', 'varchar(100)', col => col.notNull())
        .addColumn('role', 'varchar(20)', col => col.notNull().defaultTo('member'))
        .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .execute()

      // Unique email per tenant
      await db.schema
        .createIndex('users_tenant_email_idx')
        .on('users')
        .columns(['tenant_id', 'email'])
        .unique()
        .execute()

      await db.schema.createIndex('users_tenant_id_idx').on('users').column('tenant_id').execute()
    },
    async down(db) {
      await db.schema.dropTable('users').execute()
    }
  },
  {
    name: '003_create_projects',
    async up(db) {
      await db.schema
        .createTable('projects')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('tenant_id', 'integer', col =>
          col.notNull().references('tenants.id').onDelete('cascade')
        )
        .addColumn('name', 'varchar(255)', col => col.notNull())
        .addColumn('description', 'text')
        .addColumn('status', 'varchar(20)', col => col.notNull().defaultTo('active'))
        .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .execute()

      await db.schema
        .createIndex('projects_tenant_id_idx')
        .on('projects')
        .column('tenant_id')
        .execute()
    },
    async down(db) {
      await db.schema.dropTable('projects').execute()
    }
  },
  {
    name: '004_create_tasks',
    async up(db) {
      await db.schema
        .createTable('tasks')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('tenant_id', 'integer', col =>
          col.notNull().references('tenants.id').onDelete('cascade')
        )
        .addColumn('project_id', 'integer', col =>
          col.notNull().references('projects.id').onDelete('cascade')
        )
        .addColumn('title', 'varchar(255)', col => col.notNull())
        .addColumn('description', 'text')
        .addColumn('status', 'varchar(20)', col => col.notNull().defaultTo('todo'))
        .addColumn('assigned_to', 'integer', col => col.references('users.id').onDelete('set null'))
        .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .addColumn('updated_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .execute()

      await db.schema.createIndex('tasks_tenant_id_idx').on('tasks').column('tenant_id').execute()
      await db.schema
        .createIndex('tasks_project_id_idx')
        .on('tasks')
        .column('project_id')
        .execute()
      await db.schema
        .createIndex('tasks_assigned_to_idx')
        .on('tasks')
        .column('assigned_to')
        .execute()
    },
    async down(db) {
      await db.schema.dropTable('tasks').execute()
    }
  },
  {
    name: '005_create_audit_logs',
    async up(db) {
      await db.schema
        .createTable('audit_logs')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('tenant_id', 'integer', col =>
          col.notNull().references('tenants.id').onDelete('cascade')
        )
        .addColumn('table_name', 'varchar(100)', col => col.notNull())
        .addColumn('entity_id', 'varchar(100)', col => col.notNull())
        .addColumn('operation', 'varchar(20)', col => col.notNull())
        .addColumn('old_values', 'text')
        .addColumn('new_values', 'text')
        .addColumn('user_id', 'integer', col => col.references('users.id').onDelete('set null'))
        .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .execute()

      await db.schema
        .createIndex('audit_logs_tenant_id_idx')
        .on('audit_logs')
        .column('tenant_id')
        .execute()
      await db.schema
        .createIndex('audit_logs_table_entity_idx')
        .on('audit_logs')
        .columns(['table_name', 'entity_id'])
        .execute()
    },
    async down(db) {
      await db.schema.dropTable('audit_logs').execute()
    }
  }
]
