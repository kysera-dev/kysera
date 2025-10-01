import type { Selectable } from 'kysely'
import { z } from 'zod'
import type { Executor } from '@kysera/core'
import type { Database, OrdersTable, OrderStatus } from '../db/schema'

// Domain types
export type Order = Selectable<OrdersTable>

// Custom errors
export class InvalidStatusTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Invalid status transition from ${from} to ${to}`)
    this.name = 'InvalidStatusTransitionError'
  }
}

// Validation schemas
export const OrderSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']),
  total_amount: z.number().positive(),
  created_at: z.date(),
  updated_at: z.date().nullable(),
})

export const CreateOrderSchema = z.object({
  user_id: z.number(),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']).optional(),
  total_amount: z.number().positive(),
})

export const UpdateOrderSchema = z.object({
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']).optional(),
  total_amount: z.number().positive().optional(),
})

// State machine for order status transitions
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: []
}

// Mapper function
function mapOrderRow(row: Selectable<OrdersTable>): Order {
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    total_amount: row.total_amount,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

// Repository
export function createOrderRepository(executor: Executor<Database>) {
  const validateDbResults = process.env['NODE_ENV'] === 'development'

  return {
    async findById(id: number): Promise<Order | null> {
      const row = await executor
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()

      if (!row) return null

      const order = mapOrderRow(row)
      return validateDbResults ? OrderSchema.parse(order) : order
    },

    async findByUserId(userId: number): Promise<Order[]> {
      const rows = await executor
        .selectFrom('orders')
        .selectAll()
        .where('user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .execute()

      const orders = rows.map(mapOrderRow)
      return validateDbResults
        ? orders.map(o => OrderSchema.parse(o))
        : orders
    },

    async findByStatus(status: OrderStatus): Promise<Order[]> {
      const rows = await executor
        .selectFrom('orders')
        .selectAll()
        .where('status', '=', status)
        .orderBy('created_at', 'desc')
        .execute()

      const orders = rows.map(mapOrderRow)
      return validateDbResults
        ? orders.map(o => OrderSchema.parse(o))
        : orders
    },

    async create(input: unknown): Promise<Order> {
      const validated = CreateOrderSchema.parse(input)

      const row = await executor
        .insertInto('orders')
        .values({
          ...validated,
          status: validated.status || 'pending',
          updated_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const order = mapOrderRow(row)
      return validateDbResults ? OrderSchema.parse(order) : order
    },

    async update(id: number, input: unknown): Promise<Order> {
      const validated = UpdateOrderSchema.parse(input)

      const row = await executor
        .updateTable('orders')
        .set({
          ...validated,
          updated_at: new Date()
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow()

      const order = mapOrderRow(row)
      return validateDbResults ? OrderSchema.parse(order) : order
    },

    /**
     * Validate state transitions using state machine
     */
    isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
      return VALID_TRANSITIONS[from]?.includes(to) ?? false
    },

    /**
     * Update order status with state machine validation
     */
    async updateStatus(orderId: number, newStatus: OrderStatus): Promise<Order> {
      const order = await this.findById(orderId)
      if (!order) {
        throw new Error(`Order ${orderId} not found`)
      }

      if (!this.isValidTransition(order.status, newStatus)) {
        throw new InvalidStatusTransitionError(order.status, newStatus)
      }

      return this.update(orderId, { status: newStatus })
    },

    async cancel(orderId: number): Promise<Order> {
      const order = await this.findById(orderId)
      if (!order) {
        throw new Error(`Order ${orderId} not found`)
      }

      if (order.status === 'delivered') {
        throw new Error('Cannot cancel delivered order')
      }

      if (order.status === 'cancelled') {
        throw new Error('Order is already cancelled')
      }

      return this.update(orderId, { status: 'cancelled' })
    }
  }
}
