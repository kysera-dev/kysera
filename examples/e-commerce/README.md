# E-Commerce Application Example

A complete e-commerce application demonstrating advanced Kysera patterns:

- **Complex Transactions**: Multi-step order processing
- **Inventory Management**: Stock tracking with race condition prevention
- **Cart Operations**: Session-based shopping cart
- **Order Processing**: Order lifecycle management
- **Product Catalog**: Category browsing and search
- **Audit Trail**: Complete order history

## Features Demonstrated

### 1. Complex Transactions

Multi-table operations with ACID guarantees:

```typescript
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(trx)

  // 1. Create order
  const order = await repos.orders.create({
    user_id: userId,
    status: 'pending',
    total_amount: cartTotal
  })

  // 2. Move cart items to order items
  for (const item of cartItems) {
    await repos.orderItems.create({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      price: item.price
    })

    // 3. Decrease inventory
    await repos.products.decreaseStock(item.product_id, item.quantity)
  }

  // 4. Clear cart
  await repos.cart.clear(userId)

  // If any step fails, entire transaction rolls back
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

Session-based cart with expiration:

```typescript
// Add to cart
await repos.cart.addItem({
  user_id: userId,
  product_id: productId,
  quantity: 1
})

// Update quantity
await repos.cart.updateQuantity(cartItemId, 3)

// Get cart with product details
const cart = await db
  .selectFrom('cart_items')
  .innerJoin('products', 'products.id', 'cart_items.product_id')
  .select([
    'cart_items.id',
    'products.name',
    'products.price',
    'cart_items.quantity',
    sql`products.price * cart_items.quantity`.as('subtotal')
  ])
  .where('cart_items.user_id', '=', userId)
  .execute()
```

### 4. Order Processing

Complete order lifecycle with state machine:

```typescript
// Order states: pending -> processing -> shipped -> delivered
type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'

// Validate state transitions
async updateOrderStatus(orderId: number, newStatus: OrderStatus) {
  const order = await this.findById(orderId)

  if (!this.isValidTransition(order.status, newStatus)) {
    throw new InvalidStatusTransitionError()
  }

  return this.update(orderId, { status: newStatus })
}
```

### 5. Product Search

Full-text search and filtering:

```typescript
// Search products
const results = await db
  .selectFrom('products')
  .selectAll()
  .where((eb) =>
    eb.or([
      eb('name', 'ilike', `%${query}%`),
      eb('description', 'ilike', `%${query}%`)
    ])
  )
  .where('category_id', '=', categoryId)
  .where('stock', '>', 0)
  .where('is_active', '=', true)
  .orderBy('created_at', 'desc')
  .execute()
```

## Database Schema

```typescript
interface Database {
  // Product catalog
  categories: {
    id, name, slug, parent_id
  }

  products: {
    id, category_id, name, description, price, stock, is_active
  }

  // Shopping cart
  cart_items: {
    id, user_id, product_id, quantity, created_at
  }

  // Orders
  orders: {
    id, user_id, status, total_amount, created_at
  }

  order_items: {
    id, order_id, product_id, quantity, price
  }

  // Inventory tracking
  inventory_movements: {
    id, product_id, quantity_change, reason, created_at
  }
}
```

## Setup

```bash
cd examples/e-commerce
pnpm install

createdb ecommerce_example
export DATABASE_URL="postgresql://localhost/ecommerce_example"

pnpm build
pnpm start
```

## Running the Example

```bash
pnpm start
```

Demonstrates:
1. Product catalog browsing
2. Adding items to cart
3. Checkout process with transactions
4. Inventory management
5. Order status updates
6. Stock validation
7. Audit trail

## Key Patterns

### 1. Transaction-Safe Checkout

```typescript
export async function checkout(
  db: Kysely<Database>,
  userId: number
): Promise<Order> {
  return await db.transaction().execute(async (trx) => {
    // Lock cart items to prevent modifications
    const cart = await trx
      .selectFrom('cart_items')
      .selectAll()
      .where('user_id', '=', userId)
      .forUpdate() // Row-level lock
      .execute()

    if (cart.length === 0) {
      throw new EmptyCartError()
    }

    // Validate stock availability
    for (const item of cart) {
      const product = await trx
        .selectFrom('products')
        .select(['id', 'stock'])
        .where('id', '=', item.product_id)
        .forUpdate()
        .executeTakeFirstOrThrow()

      if (product.stock < item.quantity) {
        throw new InsufficientStockError(product.id)
      }
    }

    // Calculate total
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)

    // Create order
    const order = await trx
      .insertInto('orders')
      .values({
        user_id: userId,
        status: 'pending',
        total_amount: total
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    // Create order items and update inventory
    for (const item of cart) {
      await trx.insertInto('order_items').values({
        order_id: order.id,
        product_id: item.product_id,
        quantity: item.quantity,
        price: item.price
      }).execute()

      await trx
        .updateTable('products')
        .set({ stock: sql`stock - ${item.quantity}` })
        .where('id', '=', item.product_id)
        .execute()

      await trx.insertInto('inventory_movements').values({
        product_id: item.product_id,
        quantity_change: -item.quantity,
        reason: 'order',
        reference_id: order.id
      }).execute()
    }

    // Clear cart
    await trx
      .deleteFrom('cart_items')
      .where('user_id', '=', userId)
      .execute()

    return order
  })
}
```

### 2. Inventory Reconciliation

```typescript
// Daily inventory check
async function reconcileInventory() {
  const products = await db
    .selectFrom('products')
    .select(['id', 'stock'])
    .execute()

  for (const product of products) {
    const movements = await db
      .selectFrom('inventory_movements')
      .select(({ fn }) => fn.sum('quantity_change').as('total'))
      .where('product_id', '=', product.id)
      .executeTakeFirst()

    const calculatedStock = movements?.total ?? 0

    if (calculatedStock !== product.stock) {
      console.warn(`Stock mismatch for product ${product.id}`)
      // Log discrepancy, create adjustment movement
    }
  }
}
```

### 3. Product Availability

```typescript
// Check if product can be ordered
async function checkAvailability(
  productId: number,
  quantity: number
): Promise<boolean> {
  const product = await db
    .selectFrom('products')
    .select(['stock', 'is_active'])
    .where('id', '=', productId)
    .executeTakeFirst()

  if (!product || !product.is_active) {
    return false
  }

  return product.stock >= quantity
}
```

## Security Considerations

### Price Validation

```typescript
// NEVER trust prices from client
async addToCart(userId: number, productId: number, quantity: number) {
  // Fetch current price from database
  const product = await db
    .selectFrom('products')
    .select('price')
    .where('id', '=', productId)
    .executeTakeFirstOrThrow()

  // Use database price, not client-provided
  await db.insertInto('cart_items').values({
    user_id: userId,
    product_id: productId,
    quantity,
    price: product.price // ✅ Use server price
  }).execute()
}
```

### Order Tampering Prevention

```typescript
// Validate order belongs to user
async function getOrder(orderId: number, userId: number) {
  const order = await db
    .selectFrom('orders')
    .selectAll()
    .where('id', '=', orderId)
    .where('user_id', '=', userId) // ✅ Verify ownership
    .executeTakeFirst()

  if (!order) {
    throw new NotFoundError('Order not found')
  }

  return order
}
```

## Performance Optimizations

### Database Indexes

```sql
-- Product search
CREATE INDEX idx_products_category ON products(category_id) WHERE is_active = true;
CREATE INDEX idx_products_search ON products USING gin(to_tsvector('english', name || ' ' || description));

-- Cart queries
CREATE INDEX idx_cart_user ON cart_items(user_id);

-- Order queries
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);

-- Inventory
CREATE INDEX idx_inventory_product ON inventory_movements(product_id, created_at DESC);
```

### Query Optimization

```typescript
// Get cart with product details in single query
const cartWithDetails = await db
  .selectFrom('cart_items as c')
  .innerJoin('products as p', 'p.id', 'c.product_id')
  .select([
    'c.id',
    'c.quantity',
    'p.id as product_id',
    'p.name',
    'p.price',
    'p.stock',
    sql<number>`p.price * c.quantity`.as('subtotal')
  ])
  .where('c.user_id', '=', userId)
  .execute()
```

## Project Structure

```
e-commerce/
├── src/
│   ├── db/
│   │   ├── schema.ts
│   │   └── connection.ts
│   ├── repositories/
│   │   ├── product.repository.ts
│   │   ├── cart.repository.ts
│   │   └── order.repository.ts
│   ├── services/
│   │   ├── checkout.service.ts
│   │   └── inventory.service.ts
│   └── index.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Key Takeaways

1. **Transactions**: Critical for order processing
2. **Locking**: Prevents race conditions in inventory
3. **Validation**: Never trust client prices
4. **Audit Trail**: Track all inventory changes
5. **Performance**: Proper indexes for fast queries
6. **Security**: Verify user owns resources

## Learn More

- [Transaction Best Practices](../../BEST_PRACTICES.md#transaction-management)
- [Error Handling](../../BEST_PRACTICES.md#error-handling)
- [Performance Tips](../../BEST_PRACTICES.md#performance)
