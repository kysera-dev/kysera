---
sidebar_position: 2
title: Validation
description: Validation utilities API reference
---

# Validation

Utilities for input and output validation with support for multiple validation libraries.

## Validation Adapters

Kysera supports multiple validation libraries through adapters:

{/* doc-snippet: skip */}
```typescript
import { zodAdapter, valibotAdapter, typeboxAdapter, nativeAdapter } from '@kysera/repository'

// With Zod
const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    create: zodAdapter(CreateUserSchema),
    update: zodAdapter(UpdateUserSchema)
  }
})

// With Valibot — pass the valibot module as the second argument
import * as v from 'valibot'
const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    create: valibotAdapter(v.object({ email: v.string(), name: v.string() }), v)
  }
})

// With TypeBox — pass the Value module as the second argument
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    create: typeboxAdapter(Type.Object({ email: Type.String(), name: Type.String() }), Value)
  }
})

// Native TypeScript (no runtime validation)
const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    create: nativeAdapter<CreateUserInput>()
  }
})
```

:::warning No auto-wrapping
The factory never wraps raw validator schemas: `schemas` entries must implement
the `ValidationSchema` interface (`parse` + `safeParse`), so wrap Zod schemas
with `zodAdapter()` explicitly. The exported `normalizeSchema()` helper can wrap
a Zod-like schema for you, but it is never called automatically.
:::

### isValidationSchema

Type guard for the `ValidationSchema` interface — checks that a value has
callable `parse` and `safeParse`:

{/* doc-snippet: skip */}
```typescript
function isValidationSchema(value: unknown): value is ValidationSchema
```

```typescript
import { isValidationSchema, zodAdapter } from '@kysera/repository'

isValidationSchema(zodAdapter(UserSchema)) // true
isValidationSchema({ parse: () => ({}) }) // false — safeParse missing
```

## getValidationMode

Get the current validation mode from environment.

{/* doc-snippet: skip */}
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

{/* doc-snippet: skip */}
```typescript
function shouldValidate(options?: ValidationOptions): boolean

interface ValidationOptions {
  validateDbResults?: boolean // Validate database results
  validateInputs?: boolean // Always validate inputs
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

Create a validation wrapper with multiple methods. Works with any `ValidationSchema`-compatible validator.

{/* doc-snippet: skip */}
```typescript
function createValidator<T>(schema: ValidationSchema<T>, options?: ValidationOptions): {
  validate(data: unknown): T          // Throws on error
  validateSafe(data: unknown): T | null // Returns null on error
  isValid(data: unknown): boolean      // Returns boolean
  validateConditional(data: unknown): T // Uses mode setting
}
```

### Example

{/* doc-snippet: skip */}
```typescript
import { createValidator, zodAdapter } from '@kysera/repository'
import { z } from 'zod'

const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string()
})

const userValidator = createValidator(zodAdapter(UserSchema))

// Throws on failure (uses schema.parse internally)
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

Safe parsing with optional error handling. Works with any `ValidationSchema`-compatible validator.

{/* doc-snippet: skip */}
```typescript
function safeParse<T>(
  schema: ValidationSchema<T>,
  data: unknown,
  options?: {
    throwOnError?: boolean
    logErrors?: boolean
    logger?: KyseraLogger
  }
): T | null
```

### Example

{/* doc-snippet: skip */}
```typescript
import { safeParse, zodAdapter } from '@kysera/repository'

const schema = zodAdapter(UserSchema)

// Silent failure
const result = safeParse(schema, data)
if (result) {
  // Use validated data
}

// Log errors
const result = safeParse(schema, data, { logErrors: true })

// Throw on error
try {
  const result = safeParse(schema, data, { throwOnError: true })
} catch (error) {
  // Handle validation error
}
```

## Validation in Repositories

### Input Validation (On by Default)

{/* doc-snippet: skip */}
```typescript
import { zodAdapter } from '@kysera/repository'

const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    create: zodAdapter(z.object({
      email: z.string().email(),
      name: z.string().min(1)
    }))
  }
})

// Input is validated by default (validationStrategy: 'strict')
await userRepo.create({ email: 'invalid' }) // Throws!
```

Input validation **can** be disabled with `validationStrategy: 'none'` — inputs
are then passed to the database unvalidated. Keep the default `'strict'` unless
the data is already validated at another trust boundary, and never disable it
for untrusted input.

### Output Validation (Configurable)

{/* doc-snippet: skip */}
```typescript
import { zodAdapter } from '@kysera/repository'

const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: {
    entity: zodAdapter(UserSchema), // For output validation
    create: zodAdapter(CreateUserSchema)
  }
  // Output validation controlled by the validateDbResults option
  // (default: NODE_ENV === 'development' at repository creation)
})
```

## Validation Modes

The `KYSERA_VALIDATION_MODE` environment variable (values: `always`, `never`,
`development`, `production`; falls back to `NODE_ENV`) drives **only** the
standalone helpers `shouldValidate()` and
`createValidator().validateConditional()`, which resolve it to a single
boolean:

| Mode          | `shouldValidate()` returns       |
| ------------- | -------------------------------- |
| `always`      | `true`                           |
| `never`       | `false`                          |
| `development` | `true` if `NODE_ENV=development` |
| `production`  | `false`                          |

Repositories created through the factory **never read this variable**. Their
behavior is set per repository: `validationStrategy` (`'strict'` default \|
`'none'`) controls input validation, and `validateDbResults` (default:
`NODE_ENV === 'development'`) controls output validation against
`schemas.entity`.

## Error Handling

Adapters re-throw the underlying library's error from `parse()` — with
`zodAdapter` that is a `ZodError`:

```typescript
try {
  await userRepo.create(invalidData)
} catch (error) {
  if (error instanceof z.ZodError) {
    // Validation failed
    console.log(error.issues)
    /*
    [
      { code: 'invalid_format', path: ['email'], message: 'Invalid email address' },
      { code: 'invalid_type', path: ['name'], message: 'Invalid input: expected string, received undefined' }
    ]
    */
  }
}
```

For non-throwing flows, `safeParse()` returns a normalized error shape. Both
types live in `@kysera/repository` (not `@kysera/core`, which only exports
`ValidationErrorCodes`), and `ValidationError` is an interface — it cannot be
used with `instanceof`:

{/* doc-snippet: skip */}
```typescript
import type { ValidationError, ValidationIssue } from '@kysera/repository'

interface ValidationError {
  message: string // Primary error message
  path?: (string | number)[] // Path to the first invalid field
  issues?: ValidationIssue[] // All validation issues
}

interface ValidationIssue {
  code: string // Error code (library-specific)
  message: string // Human-readable error message
  path: (string | number)[] // Path to the invalid field
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

### 3. Configure Validation Where It Applies

For repositories, use per-repository options — environment variables have no
effect on them:

{/* doc-snippet: skip */}
```typescript
const userRepo = factory.create({
  tableName: 'users',
  mapRow: row => row,
  schemas: { entity: zodAdapter(UserSchema), create: zodAdapter(CreateUserSchema) },
  validateDbResults: process.env['NODE_ENV'] !== 'production' // explicit beats implicit
})
```

Reserve `KYSERA_VALIDATION_MODE` for code built on the standalone helpers
(`shouldValidate()`, `createValidator().validateConditional()`):

```bash
# .env.development — validateConditional() always parses
KYSERA_VALIDATION_MODE=always

# .env.production — validateConditional() skips parsing
KYSERA_VALIDATION_MODE=production
```
