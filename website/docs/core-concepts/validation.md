---
sidebar_position: 5
title: Validation
description: Validation strategies in Kysera
---

# Validation


Kysera uses a smart validation strategy that balances type safety with performance. Validation is integrated at the data access layer and works seamlessly with the executor-based architecture.

## Validation Strategy

### Input Validation (Always Enabled)

All external inputs are validated using validation adapters:

```typescript
import { z } from 'zod'
import { createRepositoryFactory, zodAdapter } from '@kysera/repository'

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100)
})

const factory = createRepositoryFactory(db)
const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    create: zodAdapter(CreateUserSchema), // Always validated
    update: zodAdapter(CreateUserSchema.partial()) // Always validated
  }
})

// Input is validated before database operation
await userRepo.create({
  email: 'invalid-email', // Throws validation error
  name: 'John'
})
```

### Output Validation (Configurable)

Database results can optionally be validated:

<!-- doc-snippet: skip -->
```typescript
import { zodAdapter } from '@kysera/repository'

const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string(),
  created_at: z.date(),
  updated_at: z.date().nullable()
})

const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    entity: zodAdapter(UserSchema), // Optional - validates DB results
    create: zodAdapter(CreateUserSchema)
  }
  // Output validation controlled via validateDbResults (default: NODE_ENV === 'development')
})
```

## Validation Modes

The `KYSERA_VALIDATION_MODE` environment variable controls the **standalone validation helpers** — `getValidationMode()`, `shouldValidate()`, and `createValidator().validateConditional()`. It does **not** affect repository validation:

- Repository **input** validation is controlled by the `validationStrategy` config option (`'strict'` by default, `'none'` to disable)
- Repository **output** validation is controlled by the `validateDbResults` config option (default: `NODE_ENV === 'development'`)

```bash
# Always validate, in every environment
KYSERA_VALIDATION_MODE=always

# Never validate
KYSERA_VALIDATION_MODE=never

# Validate only when NODE_ENV=development
KYSERA_VALIDATION_MODE=development

# Never validate (production preset)
KYSERA_VALIDATION_MODE=production
```

When the variable is not set, the mode falls back to `NODE_ENV` (`development` when `NODE_ENV=development`, otherwise `production`).

### Using getValidationMode

```typescript
import { getValidationMode, shouldValidate } from '@kysera/repository'

// Get current mode
const mode = getValidationMode() // 'always' | 'never' | 'development' | 'production'

// Check if validation should run
if (shouldValidate({ mode: 'development' })) {
  // Validate data
}
```

## Defining Schemas

### Entity Schema

Represents the full entity as stored in the database:

```typescript
const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string(),
  created_at: z.date(),
  updated_at: z.date().nullable()
})
```

### Create Schema

For insert operations (excludes auto-generated fields):

```typescript
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['user', 'admin']).default('user')
})
```

### Update Schema

For update operations (partial of create schema):

<!-- doc-snippet: skip -->
```typescript
const UpdateUserSchema = CreateUserSchema.partial()

// Or with specific requirements
const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).max(100).optional()
  // role cannot be updated
})
```

## Custom Validators

### Using createValidator

<!-- doc-snippet: skip -->
```typescript
import { createValidator } from '@kysera/repository'
import { zodAdapter } from '@kysera/repository'

const userValidator = createValidator(zodAdapter(UserSchema), {
  mode: 'development'
})

// Different validation methods
const user = userValidator.validate(data) // Throws on error
const user = userValidator.validateSafe(data) // Returns null on error
const isValid = userValidator.isValid(data) // Returns boolean
const user = userValidator.validateConditional(data) // Validates based on mode
```

### Safe Parsing

```typescript
import { safeParse } from '@kysera/repository'
import { zodAdapter } from '@kysera/repository'

const result = safeParse(zodAdapter(UserSchema), data, {
  throwOnError: false,
  logErrors: true
})

if (result) {
  // Use validated data
}
```

## Validation at API Boundaries

Always validate at the API layer, not just in repositories:

```typescript
// Good: Validate at API boundary
app.post('/users', async (req, res) => {
  // Validate request body first
  const input = CreateUserSchema.parse(req.body)

  // Repository receives validated data
  const user = await userRepo.create(input)
  res.json(user)
})

// Bad: Relying only on repository validation
app.post('/users', async (req, res) => {
  try {
    const user = await userRepo.create(req.body) // Unvalidated!
    res.json(user)
  } catch (error) {
    res.status(500).json({ error: String(error) }) // Leaks internal errors
  }
})
```

## Complex Validation Rules

### Cross-Field Validation

```typescript
const CreateOrderSchema = z
  .object({
    items: z
      .array(
        z.object({
          productId: z.number(),
          quantity: z.number().min(1)
        })
      )
      .min(1),
    shippingAddress: z.object({
      street: z.string(),
      city: z.string(),
      country: z.string()
    }),
    paymentMethod: z.enum(['card', 'bank_transfer'])
  })
  .refine(data => data.items.reduce((sum, item) => sum + item.quantity, 0) <= 100, {
    message: 'Maximum 100 items per order'
  })
```

### Async Validation

Async refinements are for **standalone validation only** — repositories parse synchronously, and Zod throws if a synchronous `parse()` hits an async refinement. Do not pass an async-refined schema as a repository `create`/`update` schema; validate with `parseAsync()` at the API boundary instead:

```typescript
const CheckedEmailSchema = z
  .object({
    email: z.string().email(),
    name: z.string().min(1)
  })
  .refine(
    async data => {
      const existing = await userRepo.findByEmail(data.email)
      return !existing
    },
    { message: 'Email already exists' }
  )

// Standalone async validation with parseAsync()
const input = await CheckedEmailSchema.parseAsync(req.body)
const user = await userRepo.create(input)
```

### Conditional Validation

```typescript
const PaymentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('card'),
    cardNumber: z.string().length(16),
    expiryDate: z.string()
  }),
  z.object({
    type: z.literal('bank_transfer'),
    accountNumber: z.string(),
    routingNumber: z.string()
  })
])
```

## Error Handling

### Handling Validation Errors

Kysera uses safe parsing for validation error handling. The `ValidationError` is an interface (not a class), so you cannot use `instanceof` with it.

```typescript
import { createValidator, zodAdapter } from '@kysera/repository'
import { z } from 'zod'

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1)
})

// Method 1: Use safe validation (recommended)
const validator = createValidator(zodAdapter(CreateUserSchema))
const user = validator.validateSafe(userData)

if (!user) {
  // Validation failed - return 400 Bad Request
} else {
  await userRepo.create(user)
}

// Method 2: Use schema's safeParse directly
const parseResult = zodAdapter(CreateUserSchema).safeParse(userData)

if (!parseResult.success) {
  console.log(parseResult.error) // ValidationError interface
} else {
  await userRepo.create(parseResult.data)
}

// Method 3: Let validation errors throw (from underlying library)
try {
  await userRepo.create(invalidData)
} catch (error) {
  // This will be a ZodError (or error from your validation library)
  // Not a Kysera ValidationError class
  if (error instanceof z.ZodError) {
    console.log(error.issues)
  }
}
```

### Formatting Validation Errors

```typescript
import type { ValidationError } from '@kysera/repository'

const formatValidationError = (error: ValidationError) => {
  return {
    message: error.message,
    errors: error.issues?.map(issue => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code
    })) || []
  }
}

// Usage with the adapter's safeParse (validateSafe returns `T | null`,
// which carries no error details)
const result = zodAdapter(CreateUserSchema).safeParse(userData)
if (!result.success) {
  const formatted = formatValidationError(result.error)
  res.status(400).json(formatted)
}
```

## Performance Considerations

### When to Skip Result Validation

1. **Trusted internal queries**: Data from your own application
2. **High-throughput operations**: Bulk reads where validation overhead matters
3. **Production environments**: Use `KYSERA_VALIDATION_MODE=production`

### When to Keep Result Validation

1. **Development**: Catch type mismatches early
2. **External data sources**: Data from migrations or imports
3. **Schema changes**: After database migrations
4. **Critical paths**: Where data integrity is paramount
