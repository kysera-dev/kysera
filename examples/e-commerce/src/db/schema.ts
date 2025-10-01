import type { Generated } from 'kysely'

/**
 * Database schema for e-commerce application
 */

export interface CategoriesTable {
  id: Generated<number>
  name: string
  slug: string
  parent_id: number | null
  created_at: Generated<Date>
}

export interface ProductsTable {
  id: Generated<number>
  category_id: number
  name: string
  description: string
  price: number
  stock: number
  is_active: Generated<boolean>
  created_at: Generated<Date>
  updated_at: Date | null
}

export interface CartItemsTable {
  id: Generated<number>
  user_id: number
  product_id: number
  quantity: number
  created_at: Generated<Date>
}

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'

export interface OrdersTable {
  id: Generated<number>
  user_id: number
  status: OrderStatus
  total_amount: number
  created_at: Generated<Date>
  updated_at: Date | null
}

export interface OrderItemsTable {
  id: Generated<number>
  order_id: number
  product_id: number
  quantity: number
  price: number
  created_at: Generated<Date>
}

export interface InventoryMovementsTable {
  id: Generated<number>
  product_id: number
  quantity_change: number
  reason: string
  created_at: Generated<Date>
}

export interface MigrationsTable {
  name: string
  executed_at: Generated<Date>
}

export interface Database {
  categories: CategoriesTable
  products: ProductsTable
  cart_items: CartItemsTable
  orders: OrdersTable
  order_items: OrderItemsTable
  inventory_movements: InventoryMovementsTable
  migrations: MigrationsTable
}
