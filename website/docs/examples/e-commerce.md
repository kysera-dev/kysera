---
sidebar_position: 3
title: E-Commerce
description: Complex transaction patterns for e-commerce
---

# E-Commerce Application

Advanced patterns for production e-commerce systems with complex transactions.

## Features

- Complex ACID transactions
- Inventory management with optimistic locking
- Shopping cart operations
- Order lifecycle (state machine)
- Stock validation
- Repository pattern with Zod validation

## Database Schema

```typescript
// TypeScript schema types (from examples/e-commerce/src/db/schema.ts)

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
  quantity_change: number  // Note: actual field name is quantity_change
  reason: string
  created_at: Generated<Date>
}
```

## Order State Machine

The order repository implements a state machine for order status transitions:

```typescript
// From examples/e-commerce/src/repositories/order.repository.ts

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'

// State machine for order status transitions
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: []
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Invalid status transition from ${from} to ${to}`)
    this.name = 'InvalidStatusTransitionError'
  }
}
```

## Checkout Transaction

The most critical operation - must be atomic. This example uses optimistic locking to prevent overselling. Here's the actual implementation from the example:

```typescript
// From examples/e-commerce/src/index.ts (lines 88-122)

const order = await db.transaction().execute(async (trx) => {
  const transactionalProductRepo = createProductRepository(trx)
  const transactionalCartRepo = createCartRepository(trx)
  const transactionalOrderRepo = createOrderRepository(trx)

  // Get cart items
  const cartItems = await transactionalCartRepo.getCartWithProducts(userId)

  if (cartItems.length === 0) {
    throw new Error('Cart is empty')
  }

  // Calculate total
  const total = cartItems.reduce((sum, item) => sum + item.subtotal, 0)

  // Create order
  const newOrder = await transactionalOrderRepo.create({
    user_id: userId,
    total_amount: total,
    status: 'pending'
  })

  // Decrease stock for each product
  for (const item of cartItems) {
    await transactionalProductRepo.decreaseStock(item.product_id, item.quantity)
  }

  // Clear cart
  await transactionalCartRepo.clear(userId)

  return newOrder
})
```

### Alternative: With Plugins (v0.7+)

For automatic audit logging or soft-delete support:

```typescript
import { createExecutor } from '@kysera/executor'
import { auditPlugin } from '@kysera/audit'
import { withTransaction } from '@kysera/dal'

// Create executor with plugins
const executor = await createExecutor(db, [
  auditPlugin({
    getUserId: () => getCurrentUserId(),
    metadata: () => ({ ip: getCurrentRequest().ip })
  })
])

// Use withTransaction with executor (plugins propagated)
const order = await withTransaction(executor, async (ctx) => {
  const transactionalProductRepo = createProductRepository(ctx.db)
  const transactionalCartRepo = createCartRepository(ctx.db)
  const transactionalOrderRepo = createOrderRepository(ctx.db)

  // All changes automatically logged via audit plugin
  const cartItems = await transactionalCartRepo.getCartWithProducts(userId)
  const total = cartItems.reduce((sum, item) => sum + item.subtotal, 0)

  const newOrder = await transactionalOrderRepo.create({
    user_id: userId,
    total_amount: total,
    status: 'pending'
  })

  for (const item of cartItems) {
    await transactionalProductRepo.decreaseStock(item.product_id, item.quantity)
  }

  await transactionalCartRepo.clear(userId)

  return newOrder
})
```

### Stock Management with Optimistic Locking

The `decreaseStock` method uses optimistic locking to prevent race conditions. This is the actual implementation:

```typescript
// From examples/e-commerce/src/repositories/product.repository.ts (lines 162-180)
// Note: validateDbResults = shouldValidate() from '@kysera/repository'

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
    .where('stock', '>=', quantity)  // Prevents negative stock
    .returningAll()
    .executeTakeFirst()

  if (!result) {
    throw new InsufficientStockError(productId)
  }

  const product = mapProductRow(result)
  return validateDbResults ? ProductSchema.parse(product) : product
}
```

**Key Points:**
- **No explicit locking** (`forUpdate()`) is used - this is optimistic locking
- The `WHERE stock >= quantity` clause ensures atomicity
- If stock is insufficient, the UPDATE affects 0 rows
- The method throws `InsufficientStockError` when stock is insufficient
- Database-level constraint prevents overselling
- Simpler and often more performant than pessimistic locking

## Update Order Status

The order repository provides state machine validation for status transitions:

```typescript
// From examples/e-commerce/src/repositories/order.repository.ts (lines 142-160)

/**
 * Validate state transitions using state machine
 */
isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

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

  return await this.update(orderId, { status: newStatus })
}
```

**Usage from the example:**

```typescript
// From examples/e-commerce/src/index.ts (lines 130-151)

// Valid transitions
console.log('Processing order...')
const processingOrder = await orderRepo.updateStatus(order.id, 'processing')
console.log(`Order status: ${processingOrder.status}`)

console.log('Shipping order...')
const shippedOrder = await orderRepo.updateStatus(order.id, 'shipped')
console.log(`Order status: ${shippedOrder.status}`)

console.log('Delivering order...')
const deliveredOrder = await orderRepo.updateStatus(order.id, 'delivered')
console.log(`Order status: ${deliveredOrder.status}`)

// Try invalid transition (should fail)
try {
  await orderRepo.updateStatus(order.id, 'pending')  // delivered → pending ❌
  console.log('ERROR: Should have failed!')
} catch (error) {
  console.log(`✓ Correctly rejected invalid transition: ${(error as Error).message}`)
}
```

## Shopping Cart Operations

The cart repository handles adding, updating, and managing cart items. Here are the key methods:

### Add Item to Cart

```typescript
// From examples/e-commerce/src/repositories/cart.repository.ts (lines 92-125)
// Note: validateDbResults = shouldValidate() from '@kysera/repository'

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
}
```

### Get Cart with Product Details

Note: The cart items don't store price - prices are fetched via JOIN with products table:

```typescript
// From examples/e-commerce/src/repositories/cart.repository.ts (lines 72-90)

export interface CartItemWithProduct {
  id: number
  user_id: number
  product_id: number
  product_name: string
  price: number           // From products table, not cart_items
  quantity: number
  subtotal: number        // Calculated as price * quantity
  created_at: Date
}

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
}
```

**Key Points:**
- Cart items only store `product_id` and `quantity`
- Prices are always fetched from the products table via JOIN
- Subtotals are calculated at query time: `products.price * cart_items.quantity`
- This ensures cart always reflects current product prices

## Key Patterns Demonstrated

This example demonstrates the following production-ready patterns:

1. **Optimistic Locking** - `WHERE stock >= quantity` prevents overselling without explicit locks
2. **Repository Pattern** - Clean separation of data access logic with Zod validation
3. **State Machine** - Explicit valid transitions for order lifecycle with validation
4. **Atomic Transactions** - All-or-nothing checkout process using Kysely transactions
5. **Type Safety** - Full TypeScript types with runtime validation via Zod
6. **Price Consistency** - Cart prices are always fetched via JOIN, never stored
7. **Error Handling** - Custom error types like `InsufficientStockError` and `InvalidStatusTransitionError`

### v0.7 Enhancements

With v0.7, you can enhance this example with:

- **Automatic Audit Logging** - Use `@kysera/audit` plugin to automatically log all inventory changes
- **Soft Delete Support** - Use `@kysera/soft-delete` plugin for cart items or archived products
- **Plugin-Aware Transactions** - Use `withTransaction(executor)` from `@kysera/dal` to propagate plugins
- **CQRS-lite Pattern** - Combine Repository for writes with DAL queries for complex analytics

## Additional Patterns to Consider

The example includes the `inventory_movements` table in the schema but doesn't currently use it. For production systems, you may want to consider these additional patterns:

### Pessimistic Locking with `forUpdate()`

**Note: The current example does NOT use pessimistic locking.** However, for high-contention scenarios where optimistic locking leads to frequent retries, you could implement:

```typescript
// ⚠️ This is NOT in the example - it's an alternative approach
async function checkoutWithPessimisticLocking(userId: number): Promise<Order> {
  return db.transaction().execute(async (trx) => {
    // Lock cart items and products to prevent concurrent modifications
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
      .forUpdate()  // ⚠️ Locks selected rows
      .execute()

    // ... rest of checkout logic
  })
}
```

**Trade-offs:**
- ✅ Guarantees no concurrent modifications
- ✅ No retry logic needed
- ❌ Can cause lock contention under high load
- ❌ May impact throughput
- ❌ Risk of deadlocks if not careful

### Inventory Movement Tracking

**Note: The example defines `inventory_movements` table but doesn't use it yet.** For audit trails and inventory reconciliation, you would add:

```typescript
// Track every stock change
await trx
  .insertInto('inventory_movements')
  .values({
    product_id: item.product_id,
    quantity_change: -item.quantity,  // Negative for sales
    reason: 'sale'
  })
  .execute()
```

This would provide a complete audit trail of all inventory changes for reconciliation and debugging.

## Running the Example

To run this example:

```bash
cd examples/e-commerce
pnpm install
pnpm dev
```

## Dependencies

This example uses the following packages:

**Kysera packages (actively used):**
- `@kysera/core` - Core types, `Executor` type, and error handling
- `@kysera/infra` - Health checks via `checkDatabaseHealth()`

**Kysera packages (listed but not currently used):**
- `@kysera/repository` - Not used (example uses custom repository pattern)
- `@kysera/audit` - Not used yet (planned)
- `@kysera/timestamps` - Not used yet (planned)
- `@kysera/debug` - Not used yet (planned)

**Other dependencies:**
- `kysely` - SQL query builder
- `pg` - PostgreSQL driver
- `zod` - Runtime validation

## Repository Structure

```
examples/e-commerce/src/
├── db/
│   ├── schema.ts          # TypeScript schema types
│   └── connection.ts       # Database connection
├── repositories/
│   ├── product.repository.ts   # Product CRUD + stock management
│   ├── cart.repository.ts      # Shopping cart operations
│   └── order.repository.ts     # Order management + state machine
└── index.ts               # Main example demonstrating all features
```
