---
sidebar_position: 3
title: 'Querying Data'
description: Guide to querying data with operators, sorting, and pagination
---

# Querying Data

This guide covers how to effectively query data using Kysera Repository's MongoDB-style operators, sorting, and pagination features.

## Basic Queries

### Simple Equality

The simplest form of querying uses direct equality:

```typescript
// Find all active users
const activeUsers = await userRepo.find({
  where: { status: 'active' }
})

// Find user by email
const user = await userRepo.findOne({
  where: { email: 'alice@example.com' }
})
```

### Multiple Conditions

Multiple conditions are combined with AND:

```typescript
// Find active premium users
const premiumUsers = await userRepo.find({
  where: {
    status: 'active',
    tier: 'premium',
    verified: true
  }
})
```

## Using Operators

### Comparison Queries

```typescript
// Users 18 and older
const adults = await userRepo.find({
  where: { age: { $gte: 18 } }
})

// Products under $50
const affordable = await productRepo.find({
  where: { price: { $lt: 50 } }
})

// Orders from the last 30 days
const recentOrders = await orderRepo.find({
  where: {
    createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
  }
})
```

### IN Queries

```typescript
// Find users with specific roles
const staffMembers = await userRepo.find({
  where: {
    role: { $in: ['admin', 'moderator', 'support'] }
  }
})

// Exclude certain statuses
const visiblePosts = await postRepo.find({
  where: {
    status: { $nin: ['draft', 'archived', 'deleted'] }
  }
})
```

### Text Search

```typescript
// Email domain search
const companyUsers = await userRepo.find({
  where: {
    email: { $endsWith: '@company.com' }
  }
})

// Title contains keyword
const searchResults = await postRepo.find({
  where: {
    title: { $contains: 'typescript' }
  }
})

// Case-insensitive search (PostgreSQL)
const nameSearch = await userRepo.find({
  where: {
    name: { $ilike: '%john%' }
  }
})
```

### NULL Checks

```typescript
// Users who haven't verified email
const unverified = await userRepo.find({
  where: {
    emailVerifiedAt: { $isNull: true }
  }
})

// Posts with featured image
const featuredPosts = await postRepo.find({
  where: {
    featuredImageUrl: { $isNotNull: true }
  }
})
```

### Range Queries

```typescript
// Products in price range
const midRange = await productRepo.find({
  where: {
    price: { $between: [25, 75] }
  }
})

// Events this week
const thisWeekEvents = await eventRepo.find({
  where: {
    startDate: { $between: [startOfWeek, endOfWeek] }
  }
})
```

## Complex Queries

### OR Conditions

```typescript
// Find admins or verified users
const privilegedUsers = await userRepo.find({
  where: {
    $or: [
      { role: 'admin' },
      { verified: true }
    ]
  }
})
```

### Nested Logic

```typescript
// Active users who are either admin OR (verified AND created recently)
const targetUsers = await userRepo.find({
  where: {
    status: 'active',
    $or: [
      { role: 'admin' },
      {
        $and: [
          { verified: true },
          { createdAt: { $gte: lastMonth } }
        ]
      }
    ]
  }
})
```

### Real-World Example: E-commerce Product Search

```typescript
interface ProductSearchParams {
  query?: string
  categories?: string[]
  minPrice?: number
  maxPrice?: number
  inStock?: boolean
  sortBy?: 'price' | 'rating' | 'newest'
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

async function searchProducts(params: ProductSearchParams) {
  const {
    query,
    categories,
    minPrice,
    maxPrice,
    inStock,
    sortBy = 'newest',
    sortDir = 'desc',
    page = 1,
    pageSize = 20
  } = params

  // Build where clause dynamically
  const where: WhereClause<Product> = {
    status: 'published',
    deletedAt: { $isNull: true }
  }

  if (query) {
    where.name = { $contains: query }
  }

  if (categories?.length) {
    where.category = { $in: categories }
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    where.price = {}
    if (minPrice !== undefined) where.price.$gte = minPrice
    if (maxPrice !== undefined) where.price.$lte = maxPrice
  }

  if (inStock) {
    where.stockQuantity = { $gt: 0 }
  }

  // Map sort field
  const orderByMap = {
    price: 'price',
    rating: 'averageRating',
    newest: 'createdAt'
  } as const

  return productRepo.findAndCount({
    where,
    orderBy: orderByMap[sortBy],
    orderDirection: sortDir,
    limit: pageSize,
    offset: (page - 1) * pageSize
  })
}
```

## Sorting

### Single Column

```typescript
// Newest first
const recentPosts = await postRepo.find({
  where: { status: 'published' },
  orderBy: 'createdAt',
  orderDirection: 'desc'
})

// Alphabetical
const sortedUsers = await userRepo.find({
  orderBy: 'name',
  orderDirection: 'asc'
})
```

### Multiple Columns

```typescript
// Sort by last name, then first name
const sortedContacts = await contactRepo.find({
  sort: [
    { column: 'lastName', direction: 'asc' },
    { column: 'firstName', direction: 'asc' }
  ]
})

// Sort by priority (desc), then date (asc)
const sortedTasks = await taskRepo.find({
  where: { status: 'pending' },
  sort: [
    { column: 'priority', direction: 'desc' },
    { column: 'dueDate', direction: 'asc' }
  ]
})
```

## Pagination

### Offset-Based Pagination

Best for: Admin panels, content management, smaller datasets.

```typescript
async function getPaginatedUsers(page: number, pageSize: number = 20) {
  const { items, total } = await userRepo.findAndCount({
    where: { status: 'active' },
    orderBy: 'createdAt',
    orderDirection: 'desc',
    limit: pageSize,
    offset: (page - 1) * pageSize
  })

  return {
    users: items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasNext: page * pageSize < total,
      hasPrev: page > 1
    }
  }
}
```

### Cursor-Based Pagination

Best for: Infinite scroll, real-time feeds, large datasets.

```typescript
async function getUserFeed(cursor?: { id: number; createdAt: Date }) {
  const result = await userRepo.paginateCursor({
    limit: 20,
    orderBy: 'createdAt',
    orderDirection: 'desc',
    cursor: cursor ? { value: cursor.createdAt, id: cursor.id } : null
  })

  return {
    users: result.items,
    nextCursor: result.nextCursor,
    hasMore: result.hasMore
  }
}

// Usage
const page1 = await getUserFeed()
// User scrolls down...
const page2 = await getUserFeed(page1.nextCursor)
```

## Column Selection

Select only the columns you need for better performance:

```typescript
// Get only IDs
const userIds = await userRepo.find({
  where: { status: 'active' },
  select: ['id']
})

// Get display info only
const userList = await userRepo.find({
  where: { status: 'active' },
  select: ['id', 'name', 'avatarUrl'],
  orderBy: 'name',
  limit: 100
})

// TypeScript knows the return type
// userList: Pick<User, 'id' | 'name' | 'avatarUrl'>[]
```

## Counting and Existence

### Count Records

```typescript
// Total active users
const totalActive = await userRepo.count({
  where: { status: 'active' }
})

// Pending orders
const pendingCount = await orderRepo.count({
  where: {
    status: 'pending',
    createdAt: { $gte: today }
  }
})
```

### Check Existence

```typescript
// Check if email is taken
const emailExists = await userRepo.exists({
  where: { email: 'test@example.com' }
})

if (emailExists) {
  throw new Error('Email already registered')
}

// Check if user has any orders
const hasOrders = await orderRepo.exists({
  where: { userId: user.id }
})
```

## Working with Transactions

Operators work seamlessly within transactions:

```typescript
await userRepo.transaction(async (trx) => {
  const txUserRepo = userRepo.withTransaction(trx)
  const txOrderRepo = orderRepo.withTransaction(trx)

  // Complex query within transaction
  const eligibleUsers = await txUserRepo.find({
    where: {
      status: 'active',
      balance: { $gte: 100 },
      lastLoginAt: { $gte: thirtyDaysAgo }
    }
  })

  for (const user of eligibleUsers) {
    await txOrderRepo.create({
      userId: user.id,
      type: 'bonus',
      amount: 10
    })
  }
})
```

## Performance Tips

### 1. Use Indexes

Ensure your database has indexes on columns used in `where`, `orderBy`, and `sort`:

```sql
-- Single column indexes
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_email ON users(email);

-- Composite index for common query patterns
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
CREATE INDEX idx_products_category_price ON products(category, price);
```

### 2. Limit Results

Always use `limit` when you don't need all records:

```typescript
// Good
const recent = await postRepo.find({
  where: { status: 'published' },
  orderBy: 'createdAt',
  orderDirection: 'desc',
  limit: 10
})

// Avoid (fetches all records)
const all = await postRepo.find({
  where: { status: 'published' }
})
const recent = all.slice(0, 10)
```

### 3. Select Only Needed Columns

```typescript
// Good - only fetch what you need
const list = await userRepo.find({
  select: ['id', 'name'],
  limit: 100
})

// Avoid - fetching all columns including large text fields
const list = await userRepo.find({ limit: 100 })
```

### 4. Use count() Instead of find().length

```typescript
// Good
const count = await userRepo.count({
  where: { status: 'active' }
})

// Avoid
const users = await userRepo.find({
  where: { status: 'active' }
})
const count = users.length
```

## See Also

- [Query Operators Reference](/docs/api/repository/operators) - Complete operator documentation
- [Pagination Guide](/docs/guides/pagination) - Pagination patterns in depth
- [Repository API](/docs/api/repository) - Full repository documentation
