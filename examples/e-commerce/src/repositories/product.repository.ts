import type { Selectable } from 'kysely'
import { sql } from 'kysely'
import { z } from 'zod'
import type { Executor } from '@kysera/core'
import type { Database, ProductsTable } from '../db/schema'

// Domain types
export type Product = Selectable<ProductsTable>

// Custom errors
export class InsufficientStockError extends Error {
  constructor(productId: number) {
    super(`Insufficient stock for product ${productId}`)
    this.name = 'InsufficientStockError'
  }
}

// Validation schemas
export const ProductSchema = z.object({
  id: z.number(),
  category_id: z.number(),
  name: z.string(),
  description: z.string(),
  price: z.number().positive(),
  stock: z.number().int().min(0),
  is_active: z.boolean(),
  created_at: z.date(),
  updated_at: z.date().nullable(),
})

export const CreateProductSchema = z.object({
  category_id: z.number(),
  name: z.string().min(1).max(200),
  description: z.string(),
  price: z.number().positive(),
  stock: z.number().int().min(0),
  is_active: z.boolean().optional(),
})

export const UpdateProductSchema = CreateProductSchema.partial()

// Mapper function
function mapProductRow(row: Selectable<ProductsTable>): Product {
  return {
    id: row.id,
    category_id: row.category_id,
    name: row.name,
    description: row.description,
    price: row.price,
    stock: row.stock,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

// Repository
export function createProductRepository(executor: Executor<Database>) {
  const validateDbResults = process.env['NODE_ENV'] === 'development'

  return {
    async findById(id: number): Promise<Product | null> {
      const row = await executor
        .selectFrom('products')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()

      if (!row) return null

      const product = mapProductRow(row)
      return validateDbResults ? ProductSchema.parse(product) : product
    },

    async findAll(): Promise<Product[]> {
      const rows = await executor
        .selectFrom('products')
        .selectAll()
        .where('is_active', '=', true)
        .orderBy('created_at', 'desc')
        .execute()

      const products = rows.map(mapProductRow)
      return validateDbResults
        ? products.map(p => ProductSchema.parse(p))
        : products
    },

    async findByCategory(categoryId: number): Promise<Product[]> {
      const rows = await executor
        .selectFrom('products')
        .selectAll()
        .where('category_id', '=', categoryId)
        .where('is_active', '=', true)
        .where('stock', '>', 0)
        .execute()

      const products = rows.map(mapProductRow)
      return validateDbResults
        ? products.map(p => ProductSchema.parse(p))
        : products
    },

    async search(query: string): Promise<Product[]> {
      const rows = await executor
        .selectFrom('products')
        .selectAll()
        .where((eb) =>
          eb.or([
            eb('name', 'ilike', `%${query}%`),
            eb('description', 'ilike', `%${query}%`)
          ])
        )
        .where('is_active', '=', true)
        .where('stock', '>', 0)
        .orderBy('created_at', 'desc')
        .execute()

      const products = rows.map(mapProductRow)
      return validateDbResults
        ? products.map(p => ProductSchema.parse(p))
        : products
    },

    async create(input: unknown): Promise<Product> {
      const validated = CreateProductSchema.parse(input)

      const row = await executor
        .insertInto('products')
        .values({
          ...validated,
          updated_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const product = mapProductRow(row)
      return validateDbResults ? ProductSchema.parse(product) : product
    },

    async update(id: number, input: unknown): Promise<Product> {
      const validated = UpdateProductSchema.parse(input)

      const row = await executor
        .updateTable('products')
        .set({
          ...validated,
          updated_at: new Date()
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow()

      const product = mapProductRow(row)
      return validateDbResults ? ProductSchema.parse(product) : product
    },

    /**
     * Decrease stock with optimistic locking to prevent overselling
     * This uses a WHERE clause to ensure stock doesn't go negative
     */
    async decreaseStock(productId: number, quantity: number): Promise<Product> {
      const result = await executor
        .updateTable('products')
        .set({
          stock: sql`stock - ${quantity}`,
          updated_at: new Date()
        })
        .where('id', '=', productId)
        .where('stock', '>=', quantity) // Prevents negative stock
        .returningAll()
        .executeTakeFirst()

      if (!result) {
        throw new InsufficientStockError(productId)
      }

      const product = mapProductRow(result)
      return validateDbResults ? ProductSchema.parse(product) : product
    },

    async increaseStock(productId: number, quantity: number): Promise<Product> {
      const result = await executor
        .updateTable('products')
        .set({
          stock: sql`stock + ${quantity}`,
          updated_at: new Date()
        })
        .where('id', '=', productId)
        .returningAll()
        .executeTakeFirstOrThrow()

      const product = mapProductRow(result)
      return validateDbResults ? ProductSchema.parse(product) : product
    }
  }
}
