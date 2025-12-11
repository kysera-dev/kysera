# Vertical Slice Architecture with Kysera

This guide explains how to structure your application using Vertical Slice Architecture with Kysera and enforce module boundaries using ESLint.

## Overview

Vertical Slice Architecture organizes code by features/modules rather than by technical layers. Each "slice" contains everything needed for a feature: queries, validation, business logic, and API contracts.

### Benefits

- **High cohesion**: Related code lives together
- **Low coupling**: Modules are independent
- **Easy to understand**: Each module is self-contained
- **Easy to delete**: Remove a folder, remove a feature
- **Scalable teams**: Teams can own modules independently

## Recommended Project Structure

```
src/
├── shared/                      # Infrastructure layer
│   ├── db/
│   │   ├── client.ts            # Kysely instance
│   │   ├── types.ts             # Generated DB types
│   │   └── context.ts           # DbContext from @kysera/dal
│   └── lib/
│       └── errors.ts            # Application errors
│
├── modules/                     # Business modules (Vertical Slices)
│   ├── users/
│   │   ├── api/                 # PUBLIC INTERFACE
│   │   │   ├── index.ts         # Public exports
│   │   │   └── types.ts         # Public types
│   │   ├── internal/            # PRIVATE IMPLEMENTATION
│   │   │   ├── queries/         # Query functions (Functional DAL)
│   │   │   │   ├── find-user.ts
│   │   │   │   ├── create-user.ts
│   │   │   │   └── index.ts
│   │   │   ├── domain/          # Business logic + validation
│   │   │   │   └── user.schema.ts
│   │   │   └── use-cases/       # Orchestration
│   │   │       ├── register-user.ts
│   │   │       └── update-profile.ts
│   │   └── index.ts             # Module barrel (re-exports api/)
│   │
│   └── billing/
│       ├── api/ ...
│       ├── internal/ ...
│       └── index.ts
│
└── app/                         # Application layer
    ├── server.ts
    └── routes.ts
```

## Module Structure

### Public API (`api/`)

The `api/` folder contains the public interface of a module:

```typescript
// src/modules/users/api/index.ts
export { registerUser } from '../internal/use-cases/register-user.js';
export { updateProfile } from '../internal/use-cases/update-profile.js';
export type { RegisterUserInput, UserProfile } from './types.js';
```

### Internal Implementation (`internal/`)

The `internal/` folder contains private implementation details:

```typescript
// src/modules/users/internal/queries/find-user.ts
import { createQuery, type DbContext } from '@kysera/dal';

export const findUserById = createQuery(
  (ctx: DbContext, id: number) =>
    ctx.db
      .selectFrom('users')
      .select(['id', 'email', 'name', 'created_at'])
      .where('id', '=', id)
      .executeTakeFirst()
);

export const findUserByEmail = createQuery(
  (ctx: DbContext, email: string) =>
    ctx.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst()
);
```

### Use Cases

Use cases orchestrate queries and business logic:

```typescript
// src/modules/users/internal/use-cases/register-user.ts
import { withTransaction, type DbContext } from '@kysera/dal';
import { findUserByEmail } from '../queries/find-user.js';
import { insertUser } from '../queries/create-user.js';
import { RegisterUserSchema } from '../domain/user.schema.js';
import { db } from '@/shared/db/client.js';

export interface RegisterUserInput {
  email: string;
  name: string;
  password: string;
}

export const registerUser = async (input: RegisterUserInput) => {
  // 1. Validate input
  const validated = RegisterUserSchema.parse(input);

  // 2. Execute in transaction
  return withTransaction(db, async (ctx) => {
    // 3. Check for existing user
    const existing = await findUserByEmail(ctx, validated.email);
    if (existing) {
      throw new Error('Email already registered');
    }

    // 4. Create user
    const user = await insertUser(ctx, {
      email: validated.email,
      name: validated.name,
      password_hash: await hashPassword(validated.password),
    });

    return { id: user.id, email: user.email };
  });
};
```

## ESLint Boundaries Configuration

To enforce module boundaries, use `eslint-plugin-boundaries`:

### Installation

```bash
npm install -D eslint-plugin-boundaries
# or
pnpm add -D eslint-plugin-boundaries
```

### Configuration

```javascript
// eslint.config.js
import boundaries from 'eslint-plugin-boundaries';

export default [
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared/**' },
        { type: 'module-api', pattern: 'src/modules/*/api/**' },
        { type: 'module-internal', pattern: 'src/modules/*/internal/**' },
        { type: 'app', pattern: 'src/app/**' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // shared can only import from shared
            { from: 'shared', allow: ['shared'] },

            // module-internal can import shared and its own api
            { from: 'module-internal', allow: ['shared', 'module-api'] },

            // module-api can import shared only
            { from: 'module-api', allow: ['shared'] },

            // app can import shared and module-api (NOT module-internal!)
            { from: 'app', allow: ['shared', 'module-api'] },

            // FORBIDDEN: importing internal from other modules
            // ❌ import { ... } from '@/modules/users/internal/queries'
          ],
        },
      ],
      'boundaries/no-private': [
        'error',
        {
          allowUncles: false, // Forbid accessing internal of sibling modules
        },
      ],
    },
  },
];
```

## Using @kysera/dal with Vertical Slices

The Functional DAL pattern from `@kysera/dal` is ideal for Vertical Slice Architecture:

### Query Functions in Modules

```typescript
// src/modules/billing/internal/queries/get-invoice.ts
import { createQuery } from '@kysera/dal';

export const getInvoiceById = createQuery((ctx, id: number) =>
  ctx.db
    .selectFrom('invoices')
    .select(['id', 'amount', 'status', 'created_at'])
    .where('id', '=', id)
    .executeTakeFirst()
);

export const getInvoicesByUserId = createQuery((ctx, userId: number) =>
  ctx.db
    .selectFrom('invoices')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .execute()
);
```

### Cross-Module Communication

When modules need to communicate, use the public API:

```typescript
// src/modules/billing/internal/use-cases/create-invoice.ts
import { withTransaction } from '@kysera/dal';
import { getUserById } from '@/modules/users'; // Import from public API
import { insertInvoice } from '../queries/create-invoice.js';
import { db } from '@/shared/db/client.js';

export const createInvoice = async (userId: number, amount: number) => {
  return withTransaction(db, async (ctx) => {
    // Use users module's public API
    const user = await getUserById(ctx, userId);
    if (!user) {
      throw new Error('User not found');
    }

    return insertInvoice(ctx, {
      user_id: userId,
      amount,
      status: 'pending',
    });
  });
};
```

## Validation with ValidationSchema

Use validation adapters within your modules:

```typescript
// src/modules/users/internal/domain/user.schema.ts
import { z } from 'zod';
import { zodAdapter } from '@kysera/repository';

export const RegisterUserSchema = zodAdapter(
  z.object({
    email: z.string().email(),
    name: z.string().min(1).max(100),
    password: z.string().min(8),
  })
);

export const UpdateProfileSchema = zodAdapter(
  z.object({
    name: z.string().min(1).max(100).optional(),
    bio: z.string().max(500).optional(),
  })
);
```

## Testing Modules

Each module can be tested in isolation:

```typescript
// src/modules/users/internal/use-cases/__tests__/register-user.test.ts
import { describe, it, expect } from 'vitest';
import { testInTransaction } from '@kysera/testing';
import { registerUser } from '../register-user.js';
import { db } from '@/shared/db/client.js';

describe('registerUser', () => {
  it('should create a new user', async () => {
    await testInTransaction(db, async () => {
      const result = await registerUser({
        email: 'test@example.com',
        name: 'Test User',
        password: 'password123',
      });

      expect(result.email).toBe('test@example.com');
    });
  });

  it('should reject duplicate email', async () => {
    await testInTransaction(db, async () => {
      await registerUser({
        email: 'test@example.com',
        name: 'User 1',
        password: 'password123',
      });

      await expect(
        registerUser({
          email: 'test@example.com',
          name: 'User 2',
          password: 'password456',
        })
      ).rejects.toThrow('Email already registered');
    });
  });
});
```

## Best Practices

### DO

- ✅ Export only use-cases and types from `api/`
- ✅ Keep queries in `internal/queries/`
- ✅ Keep validation schemas in `internal/domain/`
- ✅ Use `withTransaction` for operations that modify multiple tables
- ✅ Import from `@/modules/x` (public API) when accessing other modules
- ✅ Use `createQuery` for type-safe query functions

### DON'T

- ❌ Import from `@/modules/x/internal/...` from outside the module
- ❌ Export queries directly from module's public API
- ❌ Put business logic in queries (keep them pure data access)
- ❌ Access database directly in use-cases (use query functions)
- ❌ Create circular dependencies between modules

## Migration from Traditional Architecture

1. **Identify features** - Group related functionality into modules
2. **Create module structure** - Set up `api/` and `internal/` folders
3. **Move queries** - Convert repository methods to query functions
4. **Extract use-cases** - Create orchestration functions
5. **Update imports** - Use module public APIs
6. **Add ESLint rules** - Enforce boundaries
7. **Test modules** - Verify isolation works

## Related Packages

- `@kysera/dal` - Functional DAL with `createQuery`, `withTransaction`
- `@kysera/repository` - Repository pattern with `ValidationSchema`
- `@kysera/testing` - Testing utilities (`testInTransaction`)
- `@kysera/core` - Core utilities (pagination, errors)
