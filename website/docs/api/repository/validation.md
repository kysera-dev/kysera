---
sidebar_position: 2
title: Validation
description: Validation utilities API reference
---

# Validation

Utilities for input and output validation with support for multiple validation libraries.

## Validation Adapters

Kysera supports multiple validation libraries through adapters:

```typescript
import { zodAdapter, valibotAdapter, typeboxAdapter, nativeAdapter } from '@kysera/repository'

// With Zod (default)
const userRepo = factory.create({
  schemas: {
    create: zodAdapter(CreateUserSchema),
    update: zodAdapter(UpdateUserSchema)
  }
})

// With Valibot
import * as v from 'valibot'
const userRepo = factory.create({
  schemas: {
    create: valibotAdapter(v.object({ email: v.string(), name: v.string() }))
  }
})

// With TypeBox
import { Type } from '@sinclair/typebox'
const userRepo = factory.create({
  schemas: {
    create: typeboxAdapter(Type.Object({ email: Type.String(), name: Type.String() }))
  }
})

// Native TypeScript (no runtime validation)
const userRepo = factory.create({
  schemas: {
    create: nativeAdapter<CreateUserInput>()
  }
})
```

:::info Auto-detection
When using Zod schemas directly without an adapter, Kysera automatically wraps them for backward compatibility.
:::

## getValidationMode

Get the current validation mode from environment.

```typescript
function getValidationMode(): ValidationMode

type ValidationMode = 'always' | 'never' | 'development' | 'production'
```

### Environment Variables

1. `KYSERA_VALIDATION_MODE` - Set to `'always'`, `'never'`, `'development'`, or `'production'`
2. `NODE_ENV` - Used as fallback when `KYSERA_VALIDATION_MODE` is not set

### Example

```typescript
import { getValidationMode } from '@kysera/repository'

const mode = getValidationMode()
// Returns: 'always' | 'never' | 'development' | 'production'
```

## shouldValidate

Determine if validation should be enabled.

```typescript
function shouldValidate(options?: ValidationOptions): boolean

interface ValidationOptions {
  validateDbResults?: boolean    // Validate database results
  validateInputs?: boolean       // Always validate inputs
  mode?: 'development' | 'production' | 'always' | 'never'
  logger?: KyseraLogger
}
```

### Example

```typescript
import { shouldValidate } from '@kysera/repository'

if (shouldValidate({ mode: 'development' })) {
  // Validate data
}

// Always validate with 'always' mode
if (shouldValidate({ mode: 'always' })) {
  // Always validates
}
```

## createValidator

Create a validation wrapper with multiple methods.

```typescript
function createValidator<T>(
  schema: z.ZodType<T>,
  options?: ValidationOptions
): Validator<T>

interface Validator<T> {
  validate(data: unknown): T              // Throws on error
  validateSafe(data: unknown): T | null   // Returns null on error
  isValid(data: unknown): boolean          // Returns boolean
  validateConditional(data: unknown): T   // Uses mode setting
}
```

### Example

```typescript
import { createValidator } from '@kysera/repository'
import { z } from 'zod'

const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string()
})

const userValidator = createValidator(UserSchema)

// Throws ZodError on failure
const user = userValidator.validate(data)

// Returns null on failure
const user = userValidator.validateSafe(data)

// Returns boolean
if (userValidator.isValid(data)) {
  // Type-safe usage
}

// Uses environment-based mode
const user = userValidator.validateConditional(data)
```

## safeParse

Safe parsing with optional error handling.

```typescript
function safeParse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  options?: {
    logErrors?: boolean
    throwOnError?: boolean
    logger?: KyseraLogger
  }
): T | null
```

### Example

```typescript
import { safeParse } from '@kysera/repository'

// Silent failure
const result = safeParse(UserSchema, data)
if (result) {
  // Use validated data
}

// Log errors
const result = safeParse(UserSchema, data, { logErrors: true })

// Throw on error
try {
  const result = safeParse(UserSchema, data, { throwOnError: true })
} catch (error) {
  // Handle validation error
}
```

## Validation in Repositories

### Input Validation (Always On)

```typescript
const userRepo = factory.create({
  schemas: {
    create: z.object({
      email: z.string().email(),
      name: z.string().min(1)
    })
  }
})

// Input is ALWAYS validated
await userRepo.create({ email: 'invalid' })  // Throws!
```

### Output Validation (Configurable)

```typescript
const userRepo = factory.create({
  schemas: {
    entity: UserSchema  // For output validation
  }
  // Controlled via KYSERA_VALIDATION_MODE or NODE_ENV
})
```

## Validation Modes

| Mode | Input Validation | Output Validation |
|------|------------------|-------------------|
| `always` | Yes | Yes |
| `never` | Yes* | No |
| `development` | Yes | If NODE_ENV=development |
| `production` | Yes | No |

\* Input validation cannot be disabled for security

## Error Handling

```typescript
import { ValidationError } from '@kysera/core'

try {
  await userRepo.create(invalidData)
} catch (error) {
  if (error instanceof z.ZodError) {
    // Validation failed
    console.log(error.errors)
    /*
    [
      { path: ['email'], message: 'Invalid email' },
      { path: ['name'], message: 'Required' }
    ]
    */
  }
}
```

## Best Practices

### 1. Separate Schemas

```typescript
// Entity schema (full record)
const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.date()
})

// Create schema (without auto-generated fields)
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1)
})

// Update schema (all optional)
const UpdateUserSchema = CreateUserSchema.partial()
```

### 2. Validate at Boundaries

```typescript
// API endpoint
app.post('/users', async (req, res) => {
  // Validate at API boundary
  const input = CreateUserSchema.parse(req.body)

  // Repository validates again (defense in depth)
  const user = await userRepo.create(input)

  res.json(user)
})
```

### 3. Use Environment-Based Validation

```typescript
// .env.development
KYSERA_VALIDATION_MODE=always

// .env.production
KYSERA_VALIDATION_MODE=production
```
