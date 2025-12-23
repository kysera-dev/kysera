import { type Kysely, sql } from 'kysely'

export interface Migration {
  name: string
  up: (db: Kysely<any>) => Promise<void>
  down?: (db: Kysely<any>) => Promise<void>
}

export const migrations: Migration[] = [
  {
    name: '001_create_categories',
    async up(db) {
      await db.schema
        .createTable('categories')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('name', 'varchar(100)', col => col.notNull())
        .addColumn('slug', 'varchar(100)', col => col.notNull().unique())
        .addColumn('parent_id', 'integer', col => col.references('categories.id').onDelete('set null'))
        .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .execute()

      await db.schema.createIndex('categories_slug_idx').on('categories').column('slug').execute()
      await db.schema.createIndex('categories_parent_id_idx').on('categories').column('parent_id').execute()
    },
    async down(db) {
      await db.schema.dropTable('categories').execute()
    }
  },
  {
    name: '002_create_products',
    async up(db) {
      await db.schema
        .createTable('products')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('category_id', 'integer', col =>
          col.notNull().references('categories.id').onDelete('cascade')
        )
        .addColumn('name', 'varchar(255)', col => col.notNull())
        .addColumn('description', 'text', col => col.notNull())
        .addColumn('price', 'decimal(10, 2)', col => col.notNull())
        .addColumn('stock', 'integer', col => col.notNull().defaultTo(0))
        .addColumn('is_active', 'boolean', col => col.notNull().defaultTo(true))
        .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .addColumn('updated_at', 'timestamp')
        .execute()

      await db.schema.createIndex('products_category_id_idx').on('products').column('category_id').execute()
      await db.schema.createIndex('products_is_active_idx').on('products').column('is_active').execute()
    },
    async down(db) {
      await db.schema.dropTable('products').execute()
    }
  },
  {
    name: '003_create_cart_items',
    async up(db) {
      await db.schema
        .createTable('cart_items')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('user_id', 'integer', col => col.notNull())
        .addColumn('product_id', 'integer', col =>
          col.notNull().references('products.id').onDelete('cascade')
        )
        .addColumn('quantity', 'integer', col => col.notNull().defaultTo(1))
        .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .execute()

      // Composite index for user's cart lookup
      await db.schema
        .createIndex('cart_items_user_product_idx')
        .on('cart_items')
        .columns(['user_id', 'product_id'])
        .execute()
    },
    async down(db) {
      await db.schema.dropTable('cart_items').execute()
    }
  },
  {
    name: '004_create_orders',
    async up(db) {
      await db.schema
        .createTable('orders')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('user_id', 'integer', col => col.notNull())
        .addColumn('status', 'varchar(20)', col => col.notNull().defaultTo('pending'))
        .addColumn('total_amount', 'decimal(10, 2)', col => col.notNull())
        .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .addColumn('updated_at', 'timestamp')
        .execute()

      await db.schema.createIndex('orders_user_id_idx').on('orders').column('user_id').execute()
      await db.schema.createIndex('orders_status_idx').on('orders').column('status').execute()
    },
    async down(db) {
      await db.schema.dropTable('orders').execute()
    }
  },
  {
    name: '005_create_order_items',
    async up(db) {
      await db.schema
        .createTable('order_items')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('order_id', 'integer', col =>
          col.notNull().references('orders.id').onDelete('cascade')
        )
        .addColumn('product_id', 'integer', col =>
          col.notNull().references('products.id').onDelete('restrict')
        )
        .addColumn('quantity', 'integer', col => col.notNull())
        .addColumn('price', 'decimal(10, 2)', col => col.notNull())
        .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .execute()

      await db.schema.createIndex('order_items_order_id_idx').on('order_items').column('order_id').execute()
    },
    async down(db) {
      await db.schema.dropTable('order_items').execute()
    }
  },
  {
    name: '006_create_inventory_movements',
    async up(db) {
      await db.schema
        .createTable('inventory_movements')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('product_id', 'integer', col =>
          col.notNull().references('products.id').onDelete('cascade')
        )
        .addColumn('quantity_change', 'integer', col => col.notNull())
        .addColumn('reason', 'varchar(255)', col => col.notNull())
        .addColumn('created_at', 'timestamp', col => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .execute()

      await db.schema
        .createIndex('inventory_movements_product_id_idx')
        .on('inventory_movements')
        .column('product_id')
        .execute()
    },
    async down(db) {
      await db.schema.dropTable('inventory_movements').execute()
    }
  }
]
