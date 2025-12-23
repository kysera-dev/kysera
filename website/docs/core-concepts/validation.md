---
sidebar_position: 5
title: Validation
description: Validation strategies in Kysera
---

# Validation

Kysera uses a smart validation strategy that balances type safety with performance.

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
  // Output validation controlled via KYSERA_VALIDATION_MODE or NODE_ENV
})
```

## Validation Modes

Control validation behavior via environment variables:

```bash
# Full validation (development)
KYSERA_VALIDATION_MODE=always

# Input only (production)
KYSERA_VALIDATION_MODE=production

# No validation (testing/performance)
KYSERA_VALIDATION_MODE=never

# Default behavior based on NODE_ENV
KYSERA_VALIDATION_MODE=development
```

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
    res.status(500).json({ error: error.message }) // Leaks internal errors
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

```typescript
const CreateUserSchema = z
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

### ValidationError

```typescript
import { ValidationError } from '@kysera/core'

try {
  await userRepo.create(invalidData)
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.errors) // Zod error details
    // Return 400 Bad Request with error details
  }
}
```

### Formatting Validation Errors

```typescript
const formatValidationError = (error: ValidationError) => {
  return {
    message: 'Validation failed',
    errors: error.errors.map(e => ({
      field: e.path.join('.'),
      message: e.message
    }))
  }
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
