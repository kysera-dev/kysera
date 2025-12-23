---
sidebar_position: 5
title: Retry (Moved)
description: Retry logic has been moved to @kysera/infra
---

# Retry Logic

:::warning Module Moved
Retry utilities and Circuit Breaker have been moved to **[@kysera/infra](/docs/api/infra)** for better separation of concerns and tree-shaking.

```bash
npm install @kysera/infra
```

```typescript
// Before (deprecated)
import { withRetry, CircuitBreaker, isTransientError } from '@kysera/core'

// After
import { withRetry, CircuitBreaker, isTransientError } from '@kysera/infra'
```

See the full documentation at **[@kysera/infra](/docs/api/infra)**.
:::

---

## Legacy Documentation

The following documentation is kept for reference. For current implementation, see [@kysera/infra](/docs/api/infra).

---

Retry operations with exponential backoff and circuit breaker pattern.

## withRetry

Retry an async operation with configurable options.

```typescript
async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>
```

### RetryOptions

```typescript
interface RetryOptions {
  maxAttempts?: number // Default: 3
  delayMs?: number // Initial delay (default: 1000)
  backoff?: boolean // Exponential backoff (default: true)
  shouldRetry?: (error: unknown) => boolean // Custom retry condition
  onRetry?: (attempt: number, error: unknown) => void
}
```

### Example

```typescript
import { withRetry } from '@kysera/core'

const result = await withRetry(
  async () => {
    return await db.selectFrom('users').selectAll().execute()
  },
  {
    maxAttempts: 3,
    delayMs: 1000,
    backoff: true,
    onRetry: (attempt, error) => {
      console.log(`Attempt ${attempt} failed:`, error)
    }
  }
)
```

### Backoff Schedule

With `backoff: true` and `delayMs: 1000`:

| Attempt | Delay  |
| ------- | ------ |
| 1       | 1000ms |
| 2       | 2000ms |
| 3       | 4000ms |
| 4       | 8000ms |

## isTransientError

Check if an error is transient (should be retried).

```typescript
function isTransientError(error: unknown): boolean
```

### Transient Error Codes

**Network:**

- `ECONNREFUSED`
- `ETIMEDOUT`
- `ECONNRESET`
- `EPIPE`

**PostgreSQL:**

- `57P03` - Cannot connect now
- `08006` - Connection failure
- `08001` - Unable to establish connection
- `40001` - Serialization failure
- `40P01` - Deadlock detected

**MySQL:**

- `ER_LOCK_DEADLOCK`
- `ER_LOCK_WAIT_TIMEOUT`
- `ER_CON_COUNT_ERROR`

**SQLite:**

- `SQLITE_BUSY`
- `SQLITE_LOCKED`

## createRetryWrapper

Create a reusable retry wrapper.

```typescript
function createRetryWrapper<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options?: RetryOptions
): T
```

### Example

```typescript
const retryableQuery = createRetryWrapper(
  async (id: number) => db.selectFrom('users').where('id', '=', id).executeTakeFirst(),
  { maxAttempts: 3 }
)

const user = await retryableQuery(1)
```

## CircuitBreaker

Prevent cascading failures with the circuit breaker pattern.

```typescript
class CircuitBreaker {
  constructor(
    threshold?: number, // Failures before opening (default: 5)
    resetTimeMs?: number // Time before half-open (default: 60000)
  )

  async execute<T>(fn: () => Promise<T>): Promise<T>
  reset(): void
  getState(): {
    state: 'closed' | 'open' | 'half-open'
    failures: number
    lastFailureTime?: number
  }
}
```

### States

| State         | Behavior                            |
| ------------- | ----------------------------------- |
| **closed**    | Normal operation, tracking failures |
| **open**      | Rejects all requests immediately    |
| **half-open** | Allows one test request             |

### Example

```typescript
import { CircuitBreaker } from '@kysera/core'

const breaker = new CircuitBreaker(5, 60000)

try {
  const result = await breaker.execute(async () => {
    return await externalService.call()
  })
} catch (error) {
  if (error.message === 'Circuit breaker is open') {
    // Service is unavailable, use fallback
    return fallbackData
  }
  throw error
}

// Check state
const state = breaker.getState()
console.log(`Circuit: ${state.state}, Failures: ${state.failures}`)

// Manual reset
breaker.reset()
```

### Flow

```
┌─────────┐  failure count >= threshold  ┌──────┐
│ CLOSED  │ ─────────────────────────────▶ OPEN │
└─────────┘                               └──────┘
     ▲                                        │
     │  success                               │ after resetTimeMs
     │                                        ▼
     │                                  ┌───────────┐
     └────────────────────────────────── HALF-OPEN │
              one successful request    └───────────┘
```

## Combining Retry and Circuit Breaker

```typescript
const breaker = new CircuitBreaker(5, 60000)

async function resilientQuery() {
  return breaker.execute(async () => {
    return withRetry(async () => db.selectFrom('users').execute(), { maxAttempts: 3 })
  })
}
```

## Best Practices

### 1. Only Retry Transient Errors

```typescript
await withRetry(operation, {
  shouldRetry: isTransientError // Default
})
```

### 2. Log Retries

```typescript
await withRetry(operation, {
  onRetry: (attempt, error) => {
    logger.warn(`Retry attempt ${attempt}`, { error })
  }
})
```

### 3. Use Circuit Breaker for External Services

```typescript
const externalServiceBreaker = new CircuitBreaker(3, 30000)

// Wrap all external service calls
const result = await externalServiceBreaker.execute(() => externalService.call())
```

### 4. Set Appropriate Timeouts

```typescript
await withRetry(operation, {
  maxAttempts: 3,
  delayMs: 500 // Shorter for user-facing requests
})
```
