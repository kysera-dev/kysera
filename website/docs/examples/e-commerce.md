---
sidebar_position: 3
title: E-Commerce
description: Complex transaction patterns for e-commerce
---

# E-Commerce Application

Advanced patterns for production e-commerce systems with complex transactions.

## Features

- Complex ACID transactions
- Inventory management with pessimistic locking
- Shopping cart operations
- Order lifecycle (state machine)
- Stock validation
- Audit trail

## Database Schema

```sql
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cart_items (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, product_id)
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  total DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  price DECIMAL(10, 2) NOT NULL
);

CREATE TABLE inventory_movements (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  reason VARCHAR(50) NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## Order State Machine

```typescript
type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: []
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Cannot transition from ${from} to ${to}`)
  }
}

function validateTransition(from: OrderStatus, to: OrderStatus): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new InvalidStatusTransitionError(from, to)
  }
}
```

## Checkout Transaction

The most critical operation - must be atomic:

```typescript
interface CheckoutResult {
  order: Order
  items: OrderItem[]
}

async function checkout(
  db: Kysely<Database>,
  userId: number
): Promise<CheckoutResult> {
  return db.transaction().execute(async (trx) => {
    // 1. Get cart items with product info (with lock)
    const cartItems = await trx
      .selectFrom('cart_items')
      .innerJoin('products', 'products.id', 'cart_items.product_id')
      .where('cart_items.user_id', '=', userId)
      .select([
        'cart_items.id',
        'cart_items.product_id',
        'cart_items.quantity',
        'products.name',
        'products.price',
        'products.stock'
      ])
      .forUpdate()  // Lock rows
      .execute()

    if (cartItems.length === 0) {
      throw new Error('Cart is empty')
    }

    // 2. Validate stock
    for (const item of cartItems) {
      if (item.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${item.name}`)
      }
    }

    // 3. Calculate total
    const total = cartItems.reduce(
      (sum, item) => sum + (item.price * item.quantity),
      0
    )

    // 4. Create order
    const order = await trx
      .insertInto('orders')
      .values({
        user_id: userId,
        status: 'pending',
        total
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    // 5. Create order items
    const orderItems = await trx
      .insertInto('order_items')
      .values(cartItems.map(item => ({
        order_id: order.id,
        product_id: item.product_id,
        quantity: item.quantity,
        price: item.price
      })))
      .returningAll()
      .execute()

    // 6. Decrease stock
    for (const item of cartItems) {
      const result = await trx
        .updateTable('products')
        .set({ stock: sql`stock - ${item.quantity}` })
        .where('id', '=', item.product_id)
        .where('stock', '>=', item.quantity)  // Double-check
        .returningAll()
        .executeTakeFirst()

      if (!result) {
        throw new Error(`Stock changed for ${item.name}`)
      }

      // 7. Record inventory movement
      await trx
        .insertInto('inventory_movements')
        .values({
          product_id: item.product_id,
          quantity: -item.quantity,
          reason: 'sale',
          order_id: order.id
        })
        .execute()
    }

    // 8. Clear cart
    await trx
      .deleteFrom('cart_items')
      .where('user_id', '=', userId)
      .execute()

    return { order, items: orderItems }
  })
}
```

## Update Order Status

```typescript
async function updateOrderStatus(
  db: Kysely<Database>,
  orderId: number,
  newStatus: OrderStatus,
  userId: number
): Promise<Order> {
  return db.transaction().execute(async (trx) => {
    // Get current order with lock
    const order = await trx
      .selectFrom('orders')
      .where('id', '=', orderId)
      .where('user_id', '=', userId)  // Security check
      .selectAll()
      .forUpdate()
      .executeTakeFirst()

    if (!order) {
      throw new NotFoundError('Order not found')
    }

    // Validate transition
    validateTransition(order.status as OrderStatus, newStatus)

    // Update status
    const updated = await trx
      .updateTable('orders')
      .set({ status: newStatus })
      .where('id', '=', orderId)
      .returningAll()
      .executeTakeFirstOrThrow()

    return updated
  })
}
```

## Cancel Order (Restore Stock)

```typescript
async function cancelOrder(
  db: Kysely<Database>,
  orderId: number
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    // Get order and items
    const order = await trx
      .selectFrom('orders')
      .where('id', '=', orderId)
      .selectAll()
      .forUpdate()
      .executeTakeFirstOrThrow()

    validateTransition(order.status as OrderStatus, 'cancelled')

    const items = await trx
      .selectFrom('order_items')
      .where('order_id', '=', orderId)
      .selectAll()
      .execute()

    // Restore stock
    for (const item of items) {
      await trx
        .updateTable('products')
        .set({ stock: sql`stock + ${item.quantity}` })
        .where('id', '=', item.product_id)
        .execute()

      await trx
        .insertInto('inventory_movements')
        .values({
          product_id: item.product_id,
          quantity: item.quantity,
          reason: 'order_cancelled',
          order_id: orderId
        })
        .execute()
    }

    // Update order
    await trx
      .updateTable('orders')
      .set({ status: 'cancelled' })
      .where('id', '=', orderId)
      .execute()
  })
}
```

## Key Patterns

1. **Pessimistic Locking** - `forUpdate()` prevents race conditions
2. **Stock Validation** - Double-check in UPDATE WHERE clause
3. **State Machine** - Explicit valid transitions
4. **Inventory Audit** - Track all stock changes
5. **Atomic Checkout** - All-or-nothing order creation
6. **Security Checks** - User ownership validation
