# E-Commerce Application Example

A complete e-commerce application demonstrating advanced Kysera patterns:

- **Complex Transactions**: Multi-step order processing with ACID guarantees
- **Inventory Management**: Stock tracking with optimistic locking to prevent overselling
- **Cart Operations**: Session-based shopping cart with product joins
- **Order Processing**: State machine-based order lifecycle management
- **Product Catalog**: Product search with text filtering
- **Stock Validation**: Atomic stock decrease with race condition prevention

## Features Demonstrated

### 1. Complex Transactions

Multi-table operations with ACID guarantees. The checkout process demonstrates a complete transaction that creates an order, decreases inventory, and clears the cart atomically:

```typescript
const order = await db.transaction().execute(async trx => {
  const transactionalProductRepo = createProductRepository(trx)
  const transactionalCartRepo = createCartRepository(trx)
  const transactionalOrderRepo = createOrderRepository(trx)

  // Get cart items with product details
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

  // Decrease stock for each product (with optimistic locking)
  for (const item of cartItems) {
    await transactionalProductRepo.decreaseStock(item.product_id, item.quantity)
  }

  // Clear cart
  await transactionalCartRepo.clear(userId)

  // If any step fails, entire transaction rolls back
  return newOrder
})
```

### 2. Inventory Management

Prevent overselling with database-level locking:

```typescript
// Optimistic locking approach
async decreaseStock(productId: number, quantity: number) {
  const result = await this.db
    .updateTable('products')
    .set({ stock: sql`stock - ${quantity}` })
    .where('id', '=', productId)
    .where('stock', '>=', quantity) // Prevents negative stock
    .returning(['id', 'stock'])
    .executeTakeFirst()

  if (!result) {
    throw new InsufficientStockError('Not enough stock available')
  }

  return result
}
```

### 3. Shopping Cart

Session-based cart with automatic quantity updates and calculated subtotals:

```typescript
// Add to cart (automatically increments if product already in cart)
await cartRepo.addItem({
  user_id: userId,
  product_id: productId,
  quantity: 1
})

// Update quantity
await cartRepo.updateQuantity(cartItemId, { quantity: 3 })

// Get cart with product details and calculated subtotals
const cart = await cartRepo.getCartWithProducts(userId)
// Returns: Array<{
//   id: number
//   user_id: number
//   product_id: number
//   product_name: string
//   price: number
//   quantity: number
//   subtotal: number (calculated: price * quantity)
//   created_at: Date
// }>

// Get cart total
const total = await cartRepo.getTotal(userId)
```

### 4. Order Processing

Complete order lifecycle with state machine validation. Orders can only transition through valid states:

```typescript
// Valid transitions:
// pending -> processing, cancelled
// processing -> shipped, cancelled
// shipped -> delivered
// delivered -> (terminal state)
// cancelled -> (terminal state)

// Update order status with automatic validation
const updatedOrder = await orderRepo.updateStatus(orderId, 'processing')
// Throws InvalidStatusTransitionError if transition is invalid

// Check if a transition is valid before attempting
const isValid = orderRepo.isValidTransition('pending', 'processing') // true
const isInvalid = orderRepo.isValidTransition('delivered', 'pending') // false

// Cancel an order (with validation)
const cancelledOrder = await orderRepo.cancel(orderId)
// Throws error if order is already delivered or cancelled
```

### 5. Product Search

Case-insensitive text search across product names and descriptions:

```typescript
// Search products by text query
const results = await productRepo.search('gaming')
// Searches both name and description fields
// Only returns active products with stock > 0

// Find products by category
const categoryProducts = await productRepo.findByCategory(categoryId)
// Only returns active products with available stock

// Get all active products
const allProducts = await productRepo.findAll()
// Returns all active products, ordered by creation date
```

## Database Schema

```typescript
interface Database {
  // Product catalog
  categories: {
    id: Generated<number>
    name: string
    slug: string
    parent_id: number | null
    created_at: Generated<Date>
  }

  products: {
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

  // Shopping cart (NO price field - calculated via join with products)
  cart_items: {
    id: Generated<number>
    user_id: number
    product_id: number
    quantity: number
    created_at: Generated<Date>
  }

  // Orders
  orders: {
    id: Generated<number>
    user_id: number
    status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'
    total_amount: number
    created_at: Generated<Date>
    updated_at: Date | null
  }

  order_items: {
    id: Generated<number>
    order_id: number
    product_id: number
    quantity: number
    price: number // Price at time of order
    created_at: Generated<Date>
  }

  // Inventory tracking
  inventory_movements: {
    id: Generated<number>
    product_id: number
    quantity_change: number
    reason: string
    created_at: Generated<Date>
  }
}
```

## Using Unified Execution Layer (v0.7)

**New in Kysera v0.7**: The example can leverage `@kysera/executor` for automatic plugin integration, eliminating the need for manual timestamp and audit logging boilerplate.

### Automatic Timestamps and Audit Logging

Instead of manually managing `created_at`, `updated_at`, and audit trails, you can use the Unified Execution Layer with plugins:

```typescript
import { createExecutor } from '@kysera/executor'
import { auditPlugin } from '@kysera/audit'
import { timestampsPlugin } from '@kysera/timestamps'

// Create executor with automatic plugins
const executor = await createExecutor(db, [
  auditPlugin({
    userId: () => getCurrentUserId(),
    tables: ['products', 'orders', 'cart_items']
  }),
  timestampsPlugin({
    createdAtColumn: 'created_at',
    updatedAtColumn: 'updated_at'
  })
])

// All repositories now get automatic timestamps and audit logging
const productRepo = createProductRepository(executor)
const orderRepo = createOrderRepository(executor)

// Every insert automatically gets created_at timestamp
await productRepo.create({
  category_id: 1,
  name: 'Gaming Mouse',
  description: 'RGB gaming mouse',
  price: 59.99,
  stock: 100
  // created_at, updated_at automatically added!
})

// Every update automatically:
// 1. Updates updated_at timestamp
// 2. Records audit trail with user_id, table, operation, old/new values
await productRepo.update(productId, { price: 49.99 })
```

### Benefits for E-Commerce

1. **Automatic Audit Trail**
   - Every order status change is automatically logged
   - Stock changes are tracked with user attribution
   - Price changes have full audit history
   - No manual audit logging code needed

2. **Automatic Timestamps**
   - `created_at` automatically set on all inserts
   - `updated_at` automatically updated on modifications
   - Consistent timestamp handling across all tables
   - No manual `new Date()` calls needed

3. **Transaction Safety Preserved**
   - Plugins work seamlessly within transactions
   - Audit logs are part of the transaction (rollback if order creation fails)
   - No additional complexity in transaction code

4. **Cleaner Repository Code**
   - Remove all manual timestamp management
   - Remove all manual audit logging
   - Focus on business logic only
   - Plugins handle cross-cutting concerns

### Example: Before vs After

**Before (v0.6 - Manual):**

```typescript
async decreaseStock(productId: number, quantity: number): Promise<Product> {
  const result = await this.db
    .updateTable('products')
    .set({
      stock: sql`stock - ${quantity}`,
      updated_at: new Date() // Manual timestamp
    })
    .where('id', '=', productId)
    .where('stock', '>=', quantity)
    .returningAll()
    .executeTakeFirst()

  // Manual audit logging
  await this.db
    .insertInto('audit_log')
    .values({
      table_name: 'products',
      operation: 'update',
      record_id: productId,
      user_id: getCurrentUserId(),
      changes: { stock: -quantity },
      created_at: new Date()
    })
    .execute()

  if (!result) {
    throw new InsufficientStockError(productId)
  }

  return result
}
```

**After (v0.7 - With Plugins):**

```typescript
async decreaseStock(productId: number, quantity: number): Promise<Product> {
  const result = await this.executor // Uses executor with plugins
    .updateTable('products')
    .set({
      stock: sql`stock - ${quantity}`
      // updated_at automatically added by timestampsPlugin!
      // audit log automatically created by auditPlugin!
    })
    .where('id', '=', productId)
    .where('stock', '>=', quantity)
    .returningAll()
    .executeTakeFirst()

  if (!result) {
    throw new InsufficientStockError(productId)
  }

  return result
}
```

### Migration Path

To upgrade this example to use v0.7 plugins:

1. Install new packages:
```bash
pnpm add @kysera/executor @kysera/audit @kysera/timestamps
```

2. Create executor with plugins (in `db/connection.ts`):
```typescript
import { createExecutor } from '@kysera/executor'
import { auditPlugin } from '@kysera/audit'
import { timestampsPlugin } from '@kysera/timestamps'

const db = new Kysely<Database>({ /* ... */ })

export const executor = await createExecutor(db, [
  auditPlugin({ userId: () => getCurrentUserId() }),
  timestampsPlugin()
])
```

3. Update repositories to use `executor` instead of `db`
4. Remove all manual timestamp and audit logging code
5. Enjoy cleaner, more maintainable code!

## Multi-Database Support

This example uses **PostgreSQL**, but Kysera v0.7 supports multiple database backends with minimal code changes:

### Supported Databases

- **PostgreSQL** (default) - Recommended for production e-commerce
- **MySQL** - Fully supported with schema adjustments
- **SQLite** - Supported for development/testing
- **MSSQL** - Supported with appropriate dialect

### Database-Specific Considerations

#### PostgreSQL (Current Implementation)

```typescript
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'

const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new Pool({ connectionString }) })
})
```

**Advantages:**
- Full-text search with `to_tsvector()` and GIN indexes
- JSONB support for flexible data
- Advanced transaction isolation levels
- Mature ecosystem

**Schema Notes:**
- Uses `SERIAL` or `GENERATED ALWAYS AS IDENTITY` for auto-increment
- Supports array types, JSONB, and advanced data types

#### MySQL

```typescript
import { MysqlDialect } from 'kysely'
import { createPool } from 'mysql2'

const db = new Kysely<Database>({
  dialect: new MysqlDialect({ pool: createPool(connectionString) })
})
```

**Schema Adjustments:**
- Use `AUTO_INCREMENT` instead of `SERIAL`
- Use `DATETIME` instead of `TIMESTAMP WITH TIME ZONE`
- Text search requires `FULLTEXT` indexes
- JSON support (not JSONB)

#### SQLite

```typescript
import { SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'

const db = new Kysely<Database>({
  dialect: new SqliteDialect({ database: new Database('ecommerce.db') })
})
```

**Schema Adjustments:**
- Use `INTEGER PRIMARY KEY AUTOINCREMENT` for auto-increment
- No native `BOOLEAN` type (use `INTEGER` with 0/1)
- Limited text search capabilities (use `LIKE` or FTS5 extension)
- No `TIMESTAMP WITH TIME ZONE` (use `TEXT` or `INTEGER` for Unix timestamps)

**Use Cases:**
- Development and testing
- Embedded applications
- Small-scale deployments

#### MSSQL

```typescript
import { MssqlDialect } from 'kysely'
import { Pool } from 'tarn'
import * as Tedious from 'tedious'

const db = new Kysely<Database>({
  dialect: new MssqlDialect({ /* ... */ })
})
```

**Schema Adjustments:**
- Use `IDENTITY` for auto-increment
- Use `NVARCHAR` for Unicode strings
- Full-text search with `CONTAINS()` and fulltext indexes
- Date handling differences

### Cross-Database Query Patterns

The e-commerce example uses **database-agnostic patterns** that work across all supported databases:

**✅ Works everywhere:**
```typescript
// Standard WHERE clauses
.where('id', '=', productId)
.where('stock', '>=', quantity)

// Standard JOINs
.innerJoin('products', 'products.id', 'cart_items.product_id')

// Standard aggregates
.select(({ fn }) => fn.sum('price').as('total'))

// Atomic updates with WHERE conditions (optimistic locking)
.updateTable('products')
.set({ stock: sql`stock - ${quantity}` })
.where('stock', '>=', quantity)
```

**⚠️ Database-specific (use with caution):**
```typescript
// PostgreSQL-specific full-text search
.where(sql`to_tsvector('english', name || ' ' || description) @@ to_tsquery('gaming')`)

// MySQL-specific
.where(sql`MATCH(name, description) AGAINST('gaming' IN NATURAL LANGUAGE MODE)`)

// SQLite-specific
.where(sql`name LIKE ${'%gaming%'} OR description LIKE ${'%gaming%'}`)
```

### Recommendation

For production e-commerce systems, **PostgreSQL is recommended** due to:
- Superior transaction isolation
- Advanced indexing (GIN, GIST)
- Full-text search capabilities
- JSONB for flexible schemas
- Proven scalability

For development/testing, **SQLite** provides a lightweight alternative with zero configuration.

## Setup

```bash
cd examples/e-commerce
pnpm install

# PostgreSQL (default)
createdb ecommerce_example
export DATABASE_URL="postgresql://localhost/ecommerce_example"

# Or MySQL
export DATABASE_URL="mysql://user:password@localhost/ecommerce_example"

# Or SQLite (adjust connection in db/connection.ts)
# No database creation needed, file will be auto-created

pnpm build
pnpm start
```

## Running the Example

```bash
pnpm start
```

The example demonstrates:

1. Creating products with initial stock
2. Searching products by text query
3. Adding items to cart with automatic quantity aggregation
4. Viewing cart with product details and calculated subtotals
5. Checkout process with transactional integrity
6. Atomic stock decrease with optimistic locking
7. Order status transitions with state machine validation
8. Viewing order history

## Implemented Patterns

### 1. Optimistic Locking for Inventory

The example uses optimistic locking to prevent race conditions when decreasing stock:

```typescript
// From product.repository.ts
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

  return result
}
```

This approach:

- Uses a WHERE clause to ensure stock doesn't go negative
- Returns null if stock is insufficient, preventing overselling
- Atomic operation - no race conditions between read and update
- Works even with concurrent requests

### 2. State Machine for Order Status

Order status transitions are validated using a predefined state machine:

```typescript
// From order.repository.ts
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: []
}

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

### 3. Cart Price Security

Cart items do NOT store prices. Prices are always fetched from the products table via JOIN:

```typescript
// From cart.repository.ts
async getCartWithProducts(userId: number): Promise<CartItemWithProduct[]> {
  const rows = await executor
    .selectFrom('cart_items')
    .innerJoin('products', 'products.id', 'cart_items.product_id')
    .select([
      'cart_items.id',
      'cart_items.user_id',
      'cart_items.product_id',
      'products.name as product_name',
      'products.price',  // ✅ Always use current price from products table
      'cart_items.quantity',
      sql<number>`products.price * cart_items.quantity`.as('subtotal'),
      'cart_items.created_at'
    ])
    .where('cart_items.user_id', '=', userId)
    .execute()

  return rows as CartItemWithProduct[]
}
```

This prevents price tampering since cart items never store prices directly.

## Recommended Patterns (Not Implemented)

The following patterns are recommended for production e-commerce systems but are NOT implemented in this example:

### Row-Level Locking with `forUpdate()`

For stricter isolation, you could add pessimistic locking:

```typescript
// NOT IMPLEMENTED - Recommended pattern
const cart = await trx
  .selectFrom('cart_items')
  .selectAll()
  .where('user_id', '=', userId)
  .forUpdate() // Lock rows to prevent concurrent modifications
  .execute()
```

### Inventory Movement Tracking

Track all stock changes for audit purposes:

```typescript
// NOT IMPLEMENTED - Recommended pattern
await trx
  .insertInto('inventory_movements')
  .values({
    product_id: item.product_id,
    quantity_change: -item.quantity,
    reason: 'order',
    created_at: new Date()
  })
  .execute()
```

### Inventory Reconciliation

Verify stock levels match movement records:

```typescript
// NOT IMPLEMENTED - Recommended pattern
async function reconcileInventory() {
  const products = await db.selectFrom('products').select(['id', 'stock']).execute()

  for (const product of products) {
    const movements = await db
      .selectFrom('inventory_movements')
      .select(({ fn }) => fn.sum('quantity_change').as('total'))
      .where('product_id', '=', product.id)
      .executeTakeFirst()

    const calculatedStock = movements?.total ?? 0

    if (calculatedStock !== product.stock) {
      console.warn(`Stock mismatch for product ${product.id}`)
      // Create adjustment movement
    }
  }
}
```

## Security Considerations

### Price Validation (Implemented)

The example demonstrates proper price security by:

1. **NOT storing prices in cart_items table** - Cart items only store `user_id`, `product_id`, and `quantity`
2. **Always fetching prices via JOIN** - The `getCartWithProducts()` method joins with the products table to get current prices
3. **Never trusting client-provided prices** - All price calculations use server-side data

```typescript
// ✅ IMPLEMENTED - Cart items don't store prices
interface CartItemsTable {
  id: Generated<number>
  user_id: number
  product_id: number
  quantity: number // Only store quantity
  created_at: Generated<Date>
  // NO price field!
}

// Prices are calculated at checkout time from products table
const cartItems = await transactionalCartRepo.getCartWithProducts(userId)
const total = cartItems.reduce((sum, item) => sum + item.subtotal, 0)
```

### Input Validation (Implemented)

All repository methods use Zod schemas for validation:

```typescript
// ✅ IMPLEMENTED - From cart.repository.ts
export const AddToCartSchema = z.object({
  user_id: z.number(),
  product_id: z.number(),
  quantity: z.number().int().positive(),  // Must be positive integer
})

async addItem(input: unknown): Promise<CartItem> {
  const validated = AddToCartSchema.parse(input)  // Throws on invalid input
  // ... rest of implementation
}
```

### Recommended: User Ownership Validation

For production systems, validate that users can only access their own resources:

```typescript
// NOT IMPLEMENTED - Recommended pattern
async function getOrder(orderId: number, userId: number) {
  const order = await orderRepo.findById(orderId)

  if (!order) {
    throw new NotFoundError('Order not found')
  }

  if (order.user_id !== userId) {
    throw new UnauthorizedError('Access denied')
  }

  return order
}
```

## Performance Optimizations

### Query Optimization (Implemented)

The example uses efficient JOIN queries to minimize database round-trips:

```typescript
// ✅ IMPLEMENTED - Single query to get cart with product details
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

// ✅ IMPLEMENTED - Efficient cart total calculation
async getTotal(userId: number): Promise<number> {
  const result = await executor
    .selectFrom('cart_items')
    .innerJoin('products', 'products.id', 'cart_items.product_id')
    .select(sql<number>`SUM(products.price * cart_items.quantity)`.as('total'))
    .where('cart_items.user_id', '=', userId)
    .executeTakeFirst()

  return result?.total ?? 0
}
```

### Recommended: Database Indexes

For production deployments, add these indexes:

```sql
-- NOT IMPLEMENTED - Recommended indexes

-- Product search
CREATE INDEX idx_products_category ON products(category_id) WHERE is_active = true;
CREATE INDEX idx_products_active_stock ON products(is_active, stock) WHERE stock > 0;

-- Cart queries
CREATE INDEX idx_cart_user ON cart_items(user_id);
CREATE INDEX idx_cart_user_product ON cart_items(user_id, product_id);

-- Order queries
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);

-- For text search (PostgreSQL)
CREATE INDEX idx_products_search ON products USING gin(to_tsvector('english', name || ' ' || description));
```

## Project Structure

```
e-commerce/
├── src/
│   ├── db/
│   │   ├── schema.ts           # Database schema types
│   │   └── connection.ts       # Database connection setup
│   ├── repositories/
│   │   ├── product.repository.ts  # Product CRUD + stock management
│   │   ├── cart.repository.ts     # Cart operations with JOINs
│   │   └── order.repository.ts    # Order management + state machine
│   └── index.ts                # Main example demonstrating all features
├── package.json
├── tsconfig.json
└── README.md
```

**Note:** There is NO `services/` directory in this example. All business logic is demonstrated directly in `src/index.ts` using the repository pattern.

## Key Takeaways

### What This Example Demonstrates

1. **✅ Complex Transactions** - Multi-step checkout with ACID guarantees
2. **✅ Optimistic Locking** - Prevent race conditions with WHERE clauses
3. **✅ State Machine** - Enforce valid order status transitions
4. **✅ Price Security** - Never store prices in cart, always JOIN with products
5. **✅ Input Validation** - Zod schemas for all user input
6. **✅ Query Optimization** - Efficient JOINs to minimize round-trips
7. **✅ Type Safety** - Full TypeScript typing with Kysely and Zod

### What's NOT Implemented (But Recommended for Production)

1. **Pessimistic Locking** - Row-level locks with `forUpdate()`
2. **Audit Trail** - Inventory movement tracking
3. **Reconciliation** - Daily stock verification
4. **User Authorization** - Verify resource ownership
5. **Database Indexes** - Performance indexes for queries
6. **Order Items Creation** - Detailed order line items (currently only in transaction comments)

## Repository Pattern Benefits

This example demonstrates the repository pattern with:

- **Clean separation** - Database logic isolated in repositories
- **Transaction support** - Repositories accept `Executor<Database>` (works with both `Kysely` and `Transaction`)
- **Validation** - Input/output validation with Zod schemas
- **Type safety** - Fully typed with TypeScript
- **Testability** - Easy to mock for unit tests
- **Reusability** - Same repositories work in transactions and regular queries
