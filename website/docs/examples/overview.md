---
sidebar_position: 1
title: Examples Overview
description: Production-ready example applications
---

# Examples

Production-ready example applications demonstrating Kysera patterns.

:::info Documentation vs Source Code
This documentation shows **recommended production patterns** using the full Kysera API including plugins. The actual example applications in `/examples/` are **simplified demonstrations** that may not use all features shown here. Use these docs as a guide for building production applications.
:::

## Available Examples

### [Blog Application](/docs/examples/blog-app)

Foundational example demonstrating core Kysera features.

**Features:**
- Repository pattern with Zod validation
- Soft delete with restore
- Pagination (offset and cursor)
- Health checks integration
- Transaction management

**Best for:** Learning the basics, simple CRUD applications.

### [E-Commerce Application](/docs/examples/e-commerce)

Advanced patterns for production e-commerce systems.

**Features:**
- Complex ACID transactions
- Inventory management with locking
- Shopping cart operations
- Order lifecycle (state machine)
- Stock validation

**Best for:** Understanding transactions, complex business logic.

### [Multi-Tenant SaaS](/docs/examples/multi-tenant-saas)

Enterprise multi-tenant architecture patterns.

**Features:**
- Tenant isolation (discriminator column)
- Automatic tenant filtering
- Request-scoped context
- Cross-tenant protection
- Per-tenant audit logging

**Best for:** SaaS applications, enterprise systems.

## Learning Path

1. **Start with Blog App** - Learn repository pattern, validation, basic CRUD
2. **Move to E-Commerce** - Understand transactions, state machines, locking
3. **Explore Multi-Tenant** - Master tenant isolation, RLS, context management

## Common Patterns

### Repository Factory

All examples use the factory pattern:

```typescript
export function createUserRepository(executor: Executor<Database>) {
  const factory = createRepositoryFactory(executor)

  return factory.create({
    tableName: 'users' as const,
    mapRow: (row) => row,
    schemas: {
      create: CreateUserSchema,
      update: UpdateUserSchema
    }
  })
}

export const createRepositories = createRepositoriesFactory({
  users: createUserRepository,
  posts: createPostRepository
})
```

### Transaction Usage

```typescript
await db.transaction().execute(async (trx) => {
  const repos = createRepositories(trx)

  const user = await repos.users.create({ ... })
  await repos.posts.create({ user_id: user.id, ... })

  // Both succeed or both fail
})
```

### Validation Strategy

```typescript
// Zod schemas for validation
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1)
})

// Row mapper for domain types
const mapUserRow = (row: Selectable<UsersTable>): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  createdAt: row.created_at
})
```

## Running Examples

```bash
# Clone repository
git clone https://github.com/kysera-dev/kysera.git
cd kysera

# Install dependencies
pnpm install

# Navigate to example
cd examples/blog-app

# Set up database
createdb blog_example
cp .env.example .env

# Run migrations
pnpm migrate

# Start example
pnpm dev
```
