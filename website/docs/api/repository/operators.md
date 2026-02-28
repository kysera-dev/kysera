---
sidebar_position: 4
title: 'Query Operators'
description: MongoDB-style query operators for type-safe, expressive filtering
---

# Query Operators

Kysera Repository provides MongoDB-style query operators for type-safe, expressive filtering. These operators enable complex queries while maintaining full TypeScript type safety.

## Overview

Instead of writing raw SQL conditions, you can use intuitive operators:

```typescript
// Without operators (simple equality only)
const users = await repo.find({ where: { status: 'active' } })

// With operators (full flexibility)
const users = await repo.find({
  where: {
    age: { $gte: 18, $lte: 65 },
    status: { $in: ['active', 'verified'] },
    email: { $like: '%@company.com' }
  },
  orderBy: 'createdAt',
  orderDirection: 'desc',
  limit: 10
})
```

## FindOptions Interface

```typescript
interface FindOptions<Entity, Cols extends keyof Entity = keyof Entity> {
  /** Filter conditions with operator support */
  where?: WhereClause<Entity>
  /** Column to sort by (single column shorthand) */
  orderBy?: keyof Entity
  /** Sort direction (used with orderBy) */
  orderDirection?: 'asc' | 'desc'
  /** Multiple sort specifications */
  sort?: Array<{ column: keyof Entity; direction: 'asc' | 'desc' }>
  /** Columns to select (type-safe column selection) */
  select?: Cols[]
  /** Maximum number of results */
  limit?: number
  /** Number of results to skip */
  offset?: number
}
```

## Supported Operators

### Comparison Operators

| Operator | SQL Equivalent | Description |
|----------|---------------|-------------|
| `$eq` | `=` | Equal to (explicit form) |
| `$ne` | `<>` or `IS NOT` | Not equal to |
| `$gt` | `>` | Greater than |
| `$gte` | `>=` | Greater than or equal |
| `$lt` | `<` | Less than |
| `$lte` | `<=` | Less than or equal |

```typescript
// Explicit equality
const user = await repo.find({ where: { id: { $eq: 5 } } })

// Not equal
const nonAdmins = await repo.find({ where: { role: { $ne: 'admin' } } })

// Range comparison
const adults = await repo.find({
  where: {
    age: { $gte: 18 }
  }
})

// Combined range (implicit AND)
const workingAge = await repo.find({
  where: {
    age: { $gte: 18, $lte: 65 }
  }
})
```

### Array Operators

| Operator | SQL Equivalent | Description |
|----------|---------------|-------------|
| `$in` | `IN (...)` | Value is in array |
| `$nin` | `NOT IN (...)` | Value is not in array |

```typescript
// Find users with specific statuses
const activeUsers = await repo.find({
  where: {
    status: { $in: ['active', 'verified', 'premium'] }
  }
})

// Exclude certain roles
const regularUsers = await repo.find({
  where: {
    role: { $nin: ['admin', 'superadmin', 'moderator'] }
  }
})

// Empty array handling
const noMatch = await repo.find({
  where: { status: { $in: [] } }  // Returns empty array
})

const allMatch = await repo.find({
  where: { status: { $nin: [] } }  // Returns all records
})
```

### String Operators

| Operator | SQL Equivalent | Description |
|----------|---------------|-------------|
| `$like` | `LIKE` | SQL LIKE pattern (use `%` for wildcards) |
| `$ilike` | `ILIKE` | Case-insensitive LIKE (PostgreSQL only) |
| `$contains` | `LIKE '%...%' ESCAPE '\'` | Contains substring (auto-escaped) |
| `$startsWith` | `LIKE '...%' ESCAPE '\'` | Starts with value (auto-escaped) |
| `$endsWith` | `LIKE '%...' ESCAPE '\'` | Ends with value (auto-escaped) |

**LIKE Escaping:**

The `$contains`, `$startsWith`, and `$endsWith` operators automatically escape special LIKE characters (`%`, `_`, `\`) in the provided value. This prevents user input from being interpreted as wildcard patterns. The generated SQL uses an `ESCAPE '\'` clause.

For example, `{ title: { $contains: '100%' } }` will match the literal string `100%` rather than treating `%` as a wildcard.

The `$like` and `$ilike` operators do **not** escape special characters, allowing you to use `%` and `_` as wildcards intentionally.

```typescript
// LIKE pattern (no escaping - wildcards work)
const gmailUsers = await repo.find({
  where: {
    email: { $like: '%@gmail.com' }
  }
})

// Case-insensitive search (PostgreSQL only, no escaping)
const johns = await repo.find({
  where: {
    name: { $ilike: '%john%' }
  }
})

// Contains substring (special characters are escaped)
const searchResults = await repo.find({
  where: {
    title: { $contains: 'typescript' }
  }
})

// Starts with (special characters are escaped)
const prefixedCodes = await repo.find({
  where: {
    code: { $startsWith: 'PRE_' }
    // Matches literal 'PRE_...', does NOT treat _ as wildcard
  }
})

// Ends with (special characters are escaped)
const pdfFiles = await repo.find({
  where: {
    filename: { $endsWith: '.pdf' }
  }
})
```

### Null Operators

| Operator | SQL Equivalent | Description |
|----------|---------------|-------------|
| `$isNull` | `IS NULL` / `IS NOT NULL` | Check if value is NULL |
| `$isNotNull` | `IS NOT NULL` / `IS NULL` | Check if value is NOT NULL |

```typescript
// Find records with NULL value
const unverified = await repo.find({
  where: {
    verifiedAt: { $isNull: true }
  }
})

// Find records with non-NULL value
const verified = await repo.find({
  where: {
    verifiedAt: { $isNotNull: true }
  }
})

// Alternative: $isNull: false is equivalent to $isNotNull: true
const alsoVerified = await repo.find({
  where: {
    verifiedAt: { $isNull: false }
  }
})

// Direct null comparison (simple equality)
const nullMiddleName = await repo.find({
  where: { middleName: null }  // Uses IS NULL
})
```

### Range Operator

| Operator | SQL Equivalent | Description |
|----------|---------------|-------------|
| `$between` | `>= AND <=` | Value is between range (inclusive) |

```typescript
// Price range
const affordableProducts = await repo.find({
  where: {
    price: { $between: [10, 100] }
  }
})

// Date range
const thisMonthOrders = await repo.find({
  where: {
    createdAt: { $between: [startOfMonth, endOfMonth] }
  }
})

// ID range
const batchRecords = await repo.find({
  where: {
    id: { $between: [1000, 2000] }
  }
})
```

### Logical Operators

| Operator | SQL Equivalent | Description |
|----------|---------------|-------------|
| `$or` | `OR` | Matches if any condition is true |
| `$and` | `AND` | Matches if all conditions are true |

```typescript
// OR conditions
const priorityUsers = await repo.find({
  where: {
    $or: [
      { role: 'admin' },
      { role: 'moderator' },
      { isPremium: true }
    ]
  }
})

// AND conditions (explicit)
const qualifiedApplicants = await repo.find({
  where: {
    $and: [
      { age: { $gte: 18 } },
      { hasLicense: true },
      { experienceYears: { $gte: 2 } }
    ]
  }
})

// Nested logical operators
const complexQuery = await repo.find({
  where: {
    status: 'active',
    $or: [
      { role: 'admin' },
      {
        $and: [
          { role: 'user' },
          { verifiedAt: { $isNotNull: true } }
        ]
      }
    ]
  }
})
```

## Combining Operators

### Multiple Operators on Same Field

You can apply multiple operators to the same field:

```typescript
// Age range with explicit operators
const targetAudience = await repo.find({
  where: {
    age: { $gte: 25, $lte: 45 }
  }
})

// Exclude specific values from range
const filteredProducts = await repo.find({
  where: {
    price: { $gte: 10, $lte: 100 },
    category: { $nin: ['discontinued', 'draft'] }
  }
})
```

### Mixing Simple and Operator Conditions

Simple equality and operators can be mixed:

```typescript
const results = await repo.find({
  where: {
    status: 'active',  // Simple equality
    role: { $in: ['user', 'member'] },  // Operator
    age: { $gte: 18 }  // Operator
  }
})
```

### Complex Nested Queries

```typescript
const advancedSearch = await repo.find({
  where: {
    // Implicit AND between top-level conditions
    deletedAt: { $isNull: true },
    $or: [
      // Premium users
      { tier: 'premium' },
      // Or verified users created recently
      {
        $and: [
          { verifiedAt: { $isNotNull: true } },
          { createdAt: { $gte: thirtyDaysAgo } }
        ]
      },
      // Or admins
      { role: 'admin' }
    ]
  }
})
```

## Sorting

### Single Column Sort

```typescript
const recentUsers = await repo.find({
  where: { status: 'active' },
  orderBy: 'createdAt',
  orderDirection: 'desc'
})
```

### Multi-Column Sort

```typescript
const sortedUsers = await repo.find({
  where: { status: 'active' },
  sort: [
    { column: 'lastName', direction: 'asc' },
    { column: 'firstName', direction: 'asc' },
    { column: 'createdAt', direction: 'desc' }
  ]
})
```

## Pagination

### Limit and Offset

```typescript
// First page
const page1 = await repo.find({
  where: { status: 'active' },
  orderBy: 'id',
  limit: 20,
  offset: 0
})

// Second page
const page2 = await repo.find({
  where: { status: 'active' },
  orderBy: 'id',
  limit: 20,
  offset: 20
})
```

### With findAndCount

For pagination UI that needs total count:

```typescript
const { items, total } = await repo.findAndCount({
  where: { status: 'active' },
  orderBy: 'createdAt',
  orderDirection: 'desc',
  limit: 10,
  offset: 0
})

const totalPages = Math.ceil(total / 10)
console.log(`Showing ${items.length} of ${total} results (${totalPages} pages)`)
```

## Column Selection

Select specific columns for better performance:

```typescript
// Select only needed columns
const userEmails = await repo.find({
  where: { status: 'active' },
  select: ['id', 'email', 'name']
})
// Returns: Pick<User, 'id' | 'email' | 'name'>[]

// Combine with operators and sorting
const lightweightList = await repo.find({
  where: {
    role: { $in: ['user', 'member'] },
    deletedAt: { $isNull: true }
  },
  select: ['id', 'name', 'avatarUrl'],
  orderBy: 'name',
  limit: 100
})
```

## Methods with Operator Support

### find()

Returns an array of matching entities:

```typescript
const users = await repo.find({
  where: { status: { $in: ['active', 'pending'] } },
  orderBy: 'createdAt',
  limit: 50
})
```

### findOne()

Returns a single entity or null:

```typescript
const user = await repo.findOne({
  where: {
    email: { $like: 'admin%' },
    status: 'active'
  },
  orderBy: 'createdAt',
  orderDirection: 'desc'  // Gets the most recent match
})
```

### count()

Returns the count of matching records:

```typescript
const activeCount = await repo.count({
  where: {
    status: 'active',
    deletedAt: { $isNull: true }
  }
})
```

### exists()

Returns true if any matching record exists:

```typescript
const hasAdmins = await repo.exists({
  where: {
    role: 'admin',
    status: 'active'
  }
})
```

### findAndCount()

Returns both items and total count (useful for pagination):

```typescript
const { items, total } = await repo.findAndCount({
  where: {
    category: { $in: ['electronics', 'books'] },
    price: { $lte: 100 }
  },
  orderBy: 'price',
  orderDirection: 'asc',
  limit: 20,
  offset: 0
})
```

## Database Compatibility

| Operator | PostgreSQL | MySQL | SQLite | MSSQL |
|----------|------------|-------|--------|-------|
| `$eq` | ✓ | ✓ | ✓ | ✓ |
| `$ne` | ✓ | ✓ | ✓ | ✓ |
| `$gt` | ✓ | ✓ | ✓ | ✓ |
| `$gte` | ✓ | ✓ | ✓ | ✓ |
| `$lt` | ✓ | ✓ | ✓ | ✓ |
| `$lte` | ✓ | ✓ | ✓ | ✓ |
| `$in` | ✓ | ✓ | ✓ | ✓ |
| `$nin` | ✓ | ✓ | ✓ | ✓ |
| `$like` | ✓ | ✓ | ✓ | ✓ |
| `$ilike` | ✓ | ✗ | ✗ | ✗ |
| `$contains` | ✓ | ✓ | ✓ | ✓ |
| `$startsWith` | ✓ | ✓ | ✓ | ✓ |
| `$endsWith` | ✓ | ✓ | ✓ | ✓ |
| `$between` | ✓ | ✓ | ✓ | ✓ |
| `$isNull` | ✓ | ✓ | ✓ | ✓ |
| `$isNotNull` | ✓ | ✓ | ✓ | ✓ |
| `$or` | ✓ | ✓ | ✓ | ✓ |
| `$and` | ✓ | ✓ | ✓ | ✓ |

:::warning PostgreSQL Only
The `$ilike` operator (case-insensitive LIKE) is only supported in PostgreSQL. For other databases, use `$like` with appropriate case handling in your application logic.
:::

## Type Definitions

### WhereClause

```typescript
type WhereClause<Entity> = {
  [K in keyof Entity]?: ConditionValue<Entity[K]>
} & {
  $or?: WhereClause<Entity>[]
  $and?: WhereClause<Entity>[]
}
```

### ConditionValue

```typescript
type ConditionValue<T> =
  | T  // Direct value (equality shorthand)
  | ComparisonOperators<T>
  & ArrayOperators<T>
  & (T extends string ? StringOperators : object)
  & NullOperators
  & RangeOperator<T>
```

### Operator Interfaces

```typescript
interface ComparisonOperators<T> {
  $eq?: T
  $ne?: T
  $gt?: T
  $gte?: T
  $lt?: T
  $lte?: T
}

interface ArrayOperators<T> {
  $in?: T[]
  $nin?: T[]
}

interface StringOperators {
  $like?: string
  $ilike?: string
  $contains?: string
  $startsWith?: string
  $endsWith?: string
}

interface NullOperators {
  $isNull?: boolean
  $isNotNull?: boolean
}

interface RangeOperator<T> {
  $between?: [T, T]
}
```

## Error Handling

### InvalidOperatorError

Thrown when an invalid operator is used:

```typescript
import { InvalidOperatorError } from '@kysera/repository'

try {
  await repo.find({
    where: {
      status: { $regex: '.*active.*' }  // Invalid operator!
    }
  })
} catch (error) {
  if (error instanceof InvalidOperatorError) {
    console.log(error.operator)  // '$regex'
    console.log(error.field)     // 'status'
    console.log(error.message)   // 'Invalid operator "$regex" for field "status". Valid operators: $eq, $ne, ...'
  }
}
```

### Validation Helpers

```typescript
import {
  isOperatorObject,
  isValidOperator,
  isLogicalOperator,
  hasOperators,
  validateOperators
} from '@kysera/repository'

// Check if value is an operator object
isOperatorObject({ $eq: 5 })  // true
isOperatorObject('active')    // false

// Check if operator is valid
isValidOperator('$gte')       // true
isValidOperator('$regex')     // false

// Check if key is a logical operator
isLogicalOperator('$or')      // true
isLogicalOperator('$eq')      // false

// Check if where clause uses any operators
hasOperators({ status: 'active' })           // false
hasOperators({ status: { $eq: 'active' } })  // true

// Validate all operators in a where clause (throws on invalid)
validateOperators({ age: { $gte: 18, $invalid: 5 } })  // throws InvalidOperatorError
```

## Best Practices

### 1. Use Type-Safe Operators

```typescript
// Type-safe where clause
const where: WhereClause<User> = {
  age: { $gte: 18 },  // TypeScript knows 'age' exists on User
  status: { $in: ['active', 'pending'] }
}
```

### 2. Prefer Specific Operators Over Raw LIKE

```typescript
// Good: Clear intent
const results = await repo.find({
  where: { email: { $endsWith: '@company.com' } }
})

// Less clear: Manual pattern
const results = await repo.find({
  where: { email: { $like: '%@company.com' } }
})
```

### 3. Use Column Selection for Performance

```typescript
// Good: Only fetch needed columns
const ids = await repo.find({
  where: { status: 'active' },
  select: ['id']
})

// Avoid: Fetching all columns when not needed
const users = await repo.find({
  where: { status: 'active' }
})
const ids = users.map(u => u.id)
```

### 4. Combine with Indexes

Ensure your database has appropriate indexes for columns used in operators:

```sql
-- Index for status lookups
CREATE INDEX idx_users_status ON users(status);

-- Composite index for common query patterns
CREATE INDEX idx_users_status_created ON users(status, created_at DESC);
```

## See Also

- [Repository API Reference](/docs/api/repository) - Full repository documentation
- [Pagination Guide](/docs/guides/pagination) - Pagination patterns
- [DAL vs Repository](/docs/guides/dal-vs-repository) - When to use each pattern
