---
sidebar_position: 2
title: Blog Application
description: Basic CRUD example with Kysera
---

# Blog Application

A foundational example demonstrating core Kysera patterns for a blog platform.

## Features

- Repository pattern with Zod validation
- Soft delete with restore capability
- Pagination (offset and cursor-based)
- Health checks integration
- Transaction management
- Error handling

## Database Schema

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  content TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## Repository Implementation

### User Repository

```typescript
import { createRepositoryFactory, Executor } from '@kysera/repository'
import { z } from 'zod'

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100)
})

const UpdateUserSchema = CreateUserSchema.partial()

export function createUserRepository(executor: Executor<Database>) {
  const factory = createRepositoryFactory(executor)

  return factory.create({
    tableName: 'users' as const,
    mapRow: (row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.created_at,
      deletedAt: row.deleted_at
    }),
    schemas: {
      create: CreateUserSchema,
      update: UpdateUserSchema
    }
  })
}
```

### Post Repository

```typescript
const CreatePostSchema = z.object({
  user_id: z.number(),
  title: z.string().min(1).max(255),
  content: z.string().optional(),
  status: z.enum(['draft', 'published']).default('draft')
})

export function createPostRepository(executor: Executor<Database>) {
  const factory = createRepositoryFactory(executor)

  return factory.create({
    tableName: 'posts' as const,
    mapRow: (row) => ({
      id: row.id,
      userId: row.user_id,
      title: row.title,
      content: row.content,
      status: row.status,
      createdAt: row.created_at
    }),
    schemas: {
      create: CreatePostSchema,
      update: CreatePostSchema.partial()
    }
  })
}
```

## Using with Plugins

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { timestampsPlugin } from '@kysera/timestamps'

const orm = await createORM(db, [
  softDeletePlugin({ deletedAtColumn: 'deleted_at' }),
  timestampsPlugin()
])

const userRepo = orm.createRepository(createUserRepository)
const postRepo = orm.createRepository(createPostRepository)

// Soft delete
await userRepo.softDelete(userId)

// Find only active users
const activeUsers = await userRepo.findAll()

// Find with deleted
const allUsers = await userRepo.findAllWithDeleted()

// Restore
await userRepo.restore(userId)
```

## API Routes

```typescript
import express from 'express'

const app = express()
app.use(express.json())

// Create user
app.post('/users', async (req, res) => {
  try {
    const user = await userRepo.create(req.body)
    res.status(201).json(user)
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      return res.status(409).json({ error: 'Email already exists' })
    }
    throw error
  }
})

// Get user posts
app.get('/users/:id/posts', async (req, res) => {
  const userId = parseInt(req.params.id)
  const posts = await postRepo.find({ where: { user_id: userId } })
  res.json(posts)
})

// Create post with user validation
app.post('/posts', async (req, res) => {
  const user = await userRepo.findById(req.body.user_id)
  if (!user) {
    return res.status(400).json({ error: 'User not found' })
  }

  const post = await postRepo.create(req.body)
  res.status(201).json(post)
})

// Pagination
app.get('/posts', async (req, res) => {
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 20

  const result = await paginate(
    db.selectFrom('posts')
      .where('status', '=', 'published')
      .selectAll(),
    { page, limit }
  )

  res.json(result)
})
```

## Transaction Example

```typescript
// Create user with initial post
app.post('/users/with-post', async (req, res) => {
  const { user: userData, post: postData } = req.body

  const result = await db.transaction().execute(async (trx) => {
    const repos = createRepositories(trx)

    const user = await repos.users.create(userData)
    const post = await repos.posts.create({
      ...postData,
      user_id: user.id
    })

    return { user, post }
  })

  res.status(201).json(result)
})
```

## Health Check Endpoint

```typescript
import { checkDatabaseHealth, createMetricsPool } from '@kysera/core'

const metricsPool = createMetricsPool(pool)

app.get('/health', async (req, res) => {
  const health = await checkDatabaseHealth(db, metricsPool)

  const statusCode = health.status === 'unhealthy' ? 503 : 200
  res.status(statusCode).json(health)
})
```

## Key Patterns

1. **Repository per entity** - Clean separation of data access
2. **Factory pattern** - Easy DI and transaction support
3. **Zod validation** - Type-safe input validation
4. **Soft delete** - Safe deletion with restore
5. **Pagination** - Efficient data loading
6. **Health checks** - Production monitoring
