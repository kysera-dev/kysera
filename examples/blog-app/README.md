# Blog Application Example

A complete blog application demonstrating Kysera's core features:

- Repository pattern with validation
- Manual soft delete implementation
- Pagination (offset and cursor)
- Health checks
- Transaction management
- Error handling

## Features Demonstrated

### 1. Repository Pattern
- User repository with Zod validation
- Type-safe CRUD operations
- Custom query methods

### 2. Manual Soft Delete Implementation
- Soft delete users without permanent removal (sets `deleted_at` timestamp)
- Restore deleted users (clears `deleted_at` timestamp)
- Manual filtering of deleted records with `.where('deleted_at', 'is', null)`

### 3. Pagination
- Offset-based pagination for user lists
- Cursor-based pagination for infinite scroll

### 4. Health Checks
- Database connection health monitoring
- Pool status tracking

### 5. Error Handling
- Typed database errors
- Unique constraint violations
- Not found errors

## Database Schema

```typescript
interface Database {
  users: {
    id: Generated<number>
    email: string
    name: string
    created_at: Generated<Date>
    deleted_at: Date | null
  }
  posts: {
    id: Generated<number>
    user_id: number
    title: string
    content: string
    published: boolean
    created_at: Generated<Date>
    updated_at: Date | null
    deleted_at: Date | null
  }
  comments: {
    id: Generated<number>
    post_id: number
    user_id: number
    content: string
    created_at: Generated<Date>
    deleted_at: Date | null
  }
}
```

## Setup

```bash
# Install dependencies
pnpm install

# Set up PostgreSQL database
createdb blog_example

# Set environment variables
export DATABASE_URL="postgresql://localhost/blog_example"

# Run migrations (if any)
pnpm migrate

# Build
pnpm build

# Run the example
pnpm start
```

## Running the Example

```bash
pnpm start
```

This will:
1. Check database health
2. Create a user
3. Find user by email
4. Update user
5. List users with pagination
6. Soft delete user
7. Restore user
8. Clean up

## Code Walkthrough

### 1. Database Connection Setup

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { gracefulShutdown, createMetricsPool } from '@kysera/infra'
import { withDebug } from '@kysera/debug'

// Create base pool
const basePool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

// Create pool with metrics (for health checks)
export const pool = createMetricsPool(basePool)

// Create Kysely instance
const baseDb = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: basePool }),
  log: process.env['NODE_ENV'] === 'development'
    ? ['query', 'error']
    : ['error']
})

// Add debug wrapper in development
const debugDb = withDebug(baseDb, {
  logQuery: process.env['NODE_ENV'] === 'development',
  logParams: false,
  slowQueryThreshold: 100,
  onSlowQuery: (sql, duration) => {
    console.warn(`Slow query (${duration}ms):`, sql)
  }
})

export const db: Kysely<Database> = debugDb

// Setup graceful shutdown (for production use)
export async function setupShutdownHandlers() {
  if (process.env['NODE_ENV'] === 'production') {
    await gracefulShutdown(baseDb, {
      onShutdown: async () => {
        console.log('Closing database connections...')
      }
    })
  }
}
```

### 2. Creating a Repository

This example uses a hand-rolled repository pattern with explicit Kysely queries and manual soft-delete logic:

```typescript
import type { Executor } from '@kysera/core'
import type { Database, UsersTable } from '../db/schema.js'
import { z } from 'zod'

// Validation schemas
export const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  created_at: z.date(),
  deleted_at: z.date().nullable(),
})

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
})

export const UpdateUserSchema = CreateUserSchema.partial()

// Repository function
export function createUserRepository(executor: Executor<Database>) {
  const validateDbResults = process.env['NODE_ENV'] === 'development'

  return {
    async findById(id: number): Promise<User | null> {
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)  // Manual soft-delete filtering
        .executeTakeFirst()

      if (!row) return null

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async create(input: unknown): Promise<User> {
      const validated = CreateUserSchema.parse(input)

      const row = await executor
        .insertInto('users')
        .values({
          ...validated,
          deleted_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async softDelete(id: number): Promise<void> {
      await executor
        .updateTable('users')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute()
    },

    async restore(id: number): Promise<void> {
      await executor
        .updateTable('users')
        .set({ deleted_at: null })
        .where('id', '=', id)
        .execute()
    }
  }
}
```

### 3. Using the Repository

```typescript
// Create repository instance
const userRepo = createUserRepository(db)

// Create
const user = await userRepo.create({
  email: 'john@example.com',
  name: 'John Doe'
})

// Read
const found = await userRepo.findById(user.id)
const byEmail = await userRepo.findByEmail('john@example.com')
const allUsers = await userRepo.findAll()

// Update
const updated = await userRepo.update(user.id, {
  name: 'John Updated'
})

// Soft Delete
await userRepo.softDelete(user.id)

// Restore
await userRepo.restore(user.id)
```

### 4. Pagination

```typescript
import { paginate } from '@kysera/core'

// Offset pagination with soft-delete filtering
const query = db
  .selectFrom('users')
  .selectAll()
  .where('deleted_at', 'is', null)
  .orderBy('created_at', 'desc')

const paginatedUsers = await paginate(query, { page: 1, limit: 10 })

console.log(paginatedUsers.data) // users
console.log(paginatedUsers.pagination.totalPages)
console.log(paginatedUsers.pagination.hasNextPage)
```

### 5. Health Checks

```typescript
import { checkDatabaseHealth } from '@kysera/infra'
import { db, pool } from './db/connection.js'

const health = await checkDatabaseHealth(db, pool)

if (health.status === 'healthy') {
  console.log('Database is healthy')
  console.log('Latency:', health.checks.database.latency)
  console.log('Pool connections:', health.checks.pool.totalConnections)
}
```

## Project Structure

```
blog-app/
├── src/
│   ├── db/
│   │   ├── connection.ts    # Database connection setup
│   │   ├── schema.ts        # TypeScript schema definition
│   │   ├── migrations.ts    # Migration functions
│   │   └── migrate.ts       # Migration runner
│   ├── repositories/
│   │   └── user.repository.ts  # User repository
│   └── index.ts             # Main example runner
├── package.json
├── tsconfig.json
└── README.md
```

## Key Takeaways

1. **Hand-Rolled Repositories**: This example demonstrates building repositories with explicit Kysely queries rather than using wrapper functions
2. **Manual Soft Delete**: Soft delete is implemented manually by setting `deleted_at` and filtering with `.where('deleted_at', 'is', null)`
3. **Validation**: Zod schemas validate input data and optionally output data in development mode
4. **Type Safety**: Full TypeScript support throughout with Kysely's type-safe query builder
5. **Health Monitoring**: Production-ready health checks using `@kysera/infra`
6. **Debug Wrapper**: Query logging and slow query detection using `@kysera/debug`
7. **Metrics Pool**: Connection pool metrics for health monitoring

## Next Steps

- Add posts and comments repositories
- Implement audit logging
- Add timestamp plugin
- Create API endpoints
- Add authentication

## Learn More

- [Kysera Documentation](../../README.md)
- [Getting Started Guide](../../GETTING_STARTED.md)
- [Best Practices](../../BEST_PRACTICES.md)
