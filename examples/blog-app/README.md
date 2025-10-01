# Blog Application Example

A complete blog application demonstrating Kysera's core features:

- Repository pattern with validation
- Soft delete functionality
- Pagination (offset and cursor)
- Health checks
- Transaction management
- Error handling

## Features Demonstrated

### 1. Repository Pattern
- User repository with Zod validation
- Type-safe CRUD operations
- Custom query methods

### 2. Soft Delete Plugin
- Soft delete users without permanent removal
- Restore deleted users
- Automatic filtering of deleted records

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
    updated_at: Generated<Date>
    deleted_at: Date | null
  }
  posts: {
    id: Generated<number>
    user_id: number
    title: string
    content: string
    published: Generated<boolean>
    created_at: Generated<Date>
    updated_at: Generated<Date>
  }
  comments: {
    id: Generated<number>
    post_id: number
    user_id: number
    content: string
    created_at: Generated<Date>
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

### 1. Creating a Repository

```typescript
import { createRepository } from '@kysera/repository'
import { withSoftDelete } from '@kysera/soft-delete'
import { z } from 'zod'

const userSchemas = {
  entity: z.object({
    id: z.number(),
    email: z.string().email(),
    name: z.string(),
    created_at: z.date(),
    updated_at: z.date(),
    deleted_at: z.date().nullable()
  }),
  create: z.object({
    email: z.string().email(),
    name: z.string().min(1)
  }),
  update: z.object({
    email: z.string().email().optional(),
    name: z.string().min(1).optional()
  })
}

export function createUserRepository(db: Kysely<Database>) {
  const baseRepo = createRepository(db, 'users', {
    schemas: userSchemas
  })

  return withSoftDelete(baseRepo)
}
```

### 2. Using the Repository

```typescript
// Create
const user = await userRepo.create({
  email: 'john@example.com',
  name: 'John Doe'
})

// Read
const found = await userRepo.findById(user.id)
const byEmail = await userRepo.findByEmail('john@example.com')

// Update
const updated = await userRepo.update(user.id, {
  name: 'John Updated'
})

// Soft Delete
await userRepo.softDelete(user.id)

// Restore
await userRepo.restore(user.id)

// Hard Delete
await userRepo.delete(user.id)
```

### 3. Pagination

```typescript
import { paginate, paginateCursor } from '@kysera/core'

// Offset pagination
const result = await paginate(
  db.selectFrom('users').selectAll(),
  { page: 1, limit: 10 }
)

console.log(result.data) // users
console.log(result.pagination.totalPages)

// Cursor pagination
const cursorResult = await paginateCursor(
  db.selectFrom('users').selectAll(),
  {
    limit: 20,
    orderBy: [{ column: 'created_at', direction: 'desc' }]
  }
)

console.log(cursorResult.data)
console.log(cursorResult.pagination.nextCursor)
```

### 4. Health Checks

```typescript
import { checkDatabaseHealth } from '@kysera/core'

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

1. **Repository Pattern**: Encapsulates data access logic
2. **Soft Delete**: Non-destructive deletion with restore capability
3. **Validation**: Zod schemas ensure data integrity
4. **Type Safety**: Full TypeScript support throughout
5. **Health Monitoring**: Production-ready health checks
6. **Pagination**: Both strategies supported (offset and cursor)

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
