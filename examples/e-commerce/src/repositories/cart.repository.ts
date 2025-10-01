import type { Selectable } from 'kysely'
import { sql } from 'kysely'
import { z } from 'zod'
import type { Executor } from '@kysera/core'
import type { Database, CartItemsTable } from '../db/schema'

// Domain types
export type CartItem = Selectable<CartItemsTable>

export interface CartItemWithProduct {
  id: number
  user_id: number
  product_id: number
  product_name: string
  price: number
  quantity: number
  subtotal: number
  created_at: Date
}

// Validation schemas
export const CartItemSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  product_id: z.number(),
  quantity: z.number().int().positive(),
  created_at: z.date(),
})

export const AddToCartSchema = z.object({
  user_id: z.number(),
  product_id: z.number(),
  quantity: z.number().int().positive(),
})

export const UpdateCartItemSchema = z.object({
  quantity: z.number().int().positive(),
})

// Mapper function
function mapCartItemRow(row: Selectable<CartItemsTable>): CartItem {
  return {
    id: row.id,
    user_id: row.user_id,
    product_id: row.product_id,
    quantity: row.quantity,
    created_at: row.created_at
  }
}

// Repository
export function createCartRepository(executor: Executor<Database>) {
  const validateDbResults = process.env['NODE_ENV'] === 'development'

  return {
    async findByUserId(userId: number): Promise<CartItem[]> {
      const rows = await executor
        .selectFrom('cart_items')
        .selectAll()
        .where('user_id', '=', userId)
        .execute()

      const items = rows.map(mapCartItemRow)
      return validateDbResults
        ? items.map(i => CartItemSchema.parse(i))
        : items
    },

    /**
     * Get cart with product details and calculated subtotals
     */
    async getCartWithProducts(userId: number): Promise<CartItemWithProduct[]> {
      const rows = await executor
        .selectFrom('cart_items')
        .innerJoin('products', 'products.id', 'cart_items.product_id')
        .select([
          'cart_items.id',
          'cart_items.user_id',
          'cart_items.product_id',
          'products.name as product_name',
          'products.price',
          'cart_items.quantity',
          sql<number>`products.price * cart_items.quantity`.as('subtotal'),
          'cart_items.created_at'
        ])
        .where('cart_items.user_id', '=', userId)
        .execute()

      return rows as CartItemWithProduct[]
    },

    async addItem(input: unknown): Promise<CartItem> {
      const validated = AddToCartSchema.parse(input)

      // Check if item already exists in cart
      const existing = await executor
        .selectFrom('cart_items')
        .selectAll()
        .where('user_id', '=', validated.user_id)
        .where('product_id', '=', validated.product_id)
        .executeTakeFirst()

      if (existing) {
        // Update quantity if item already exists
        const row = await executor
          .updateTable('cart_items')
          .set({ quantity: sql`quantity + ${validated.quantity}` })
          .where('id', '=', existing.id)
          .returningAll()
          .executeTakeFirstOrThrow()

        const item = mapCartItemRow(row)
        return validateDbResults ? CartItemSchema.parse(item) : item
      }

      // Insert new item
      const row = await executor
        .insertInto('cart_items')
        .values(validated)
        .returningAll()
        .executeTakeFirstOrThrow()

      const item = mapCartItemRow(row)
      return validateDbResults ? CartItemSchema.parse(item) : item
    },

    async updateQuantity(itemId: number, input: unknown): Promise<CartItem> {
      const validated = UpdateCartItemSchema.parse(input)

      const row = await executor
        .updateTable('cart_items')
        .set({ quantity: validated.quantity })
        .where('id', '=', itemId)
        .returningAll()
        .executeTakeFirstOrThrow()

      const item = mapCartItemRow(row)
      return validateDbResults ? CartItemSchema.parse(item) : item
    },

    async removeItem(itemId: number): Promise<void> {
      await executor
        .deleteFrom('cart_items')
        .where('id', '=', itemId)
        .execute()
    },

    async clear(userId: number): Promise<void> {
      await executor
        .deleteFrom('cart_items')
        .where('user_id', '=', userId)
        .execute()
    },

    async getTotal(userId: number): Promise<number> {
      const result = await executor
        .selectFrom('cart_items')
        .innerJoin('products', 'products.id', 'cart_items.product_id')
        .select(sql<number>`SUM(products.price * cart_items.quantity)`.as('total'))
        .where('cart_items.user_id', '=', userId)
        .executeTakeFirst()

      return result?.total ?? 0
    }
  }
}
