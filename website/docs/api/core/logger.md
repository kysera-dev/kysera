---
sidebar_position: 7
title: Logger
---

# Logger

Shared logging interface for the Kysera ecosystem. All packages can optionally accept this logger for consistent logging across your application.

## Installation

```bash
npm install @kysera/core
```

## API Reference

### KyseraLogger Interface

```typescript
interface KyseraLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
```

A simple interface that any logging library can implement.

### consoleLogger

```typescript
import { consoleLogger } from '@kysera/core'

consoleLogger.debug('Fetching user', { id: 1 })
// Output: [kysera:debug] Fetching user { id: 1 }

consoleLogger.info('User created')
// Output: [kysera:info] User created

consoleLogger.warn('Deprecated method used')
// Output: [kysera:warn] Deprecated method used

consoleLogger.error('Failed to connect', error)
// Output: [kysera:error] Failed to connect Error: ...
```

Built-in console logger with `[kysera:level]` prefixes.

### silentLogger

```typescript
import { silentLogger } from '@kysera/core'

// No output - useful for testing or disabling logging
silentLogger.debug('This will not print')
silentLogger.info('Neither will this')
```

No-op logger for silent operation. Useful for:
- Unit tests where logging output is noise
- Production environments where you want to disable verbose logging
- Performance-critical code paths

### createPrefixedLogger

```typescript
import { createPrefixedLogger, consoleLogger } from '@kysera/core'

const userLogger = createPrefixedLogger('UserService', consoleLogger)

userLogger.info('Creating user')
// Output: [kysera:info] [UserService] Creating user

userLogger.error('User not found', { id: 123 })
// Output: [kysera:error] [UserService] User not found { id: 123 }
```

**Parameters:**
- `prefix` - String prefix to add to all messages
- `baseLogger` - Base logger to wrap (defaults to `consoleLogger`)

**Returns:** `KyseraLogger` - A new logger with the prefix applied

## Integration Examples

### With Debug Module

```typescript
import { withDebug } from '@kysera/core'

const debugDb = withDebug(db, {
  logger: createPrefixedLogger('SQL')
})
```

### With Health Monitor

```typescript
import { HealthMonitor, createPrefixedLogger } from '@kysera/core'

const monitor = new HealthMonitor({
  interval: 30_000,
  logger: createPrefixedLogger('HealthCheck')
})
```

### Custom Logger Implementation

Integrate with your preferred logging library:

```typescript
import pino from 'pino'
import type { KyseraLogger } from '@kysera/core'

const pinoLogger = pino({ level: 'debug' })

const kyseraLogger: KyseraLogger = {
  debug: (msg, ...args) => pinoLogger.debug({ args }, msg),
  info: (msg, ...args) => pinoLogger.info({ args }, msg),
  warn: (msg, ...args) => pinoLogger.warn({ args }, msg),
  error: (msg, ...args) => pinoLogger.error({ args }, msg),
}
```

### Winston Integration

```typescript
import winston from 'winston'
import type { KyseraLogger } from '@kysera/core'

const winstonLogger = winston.createLogger({
  level: 'debug',
  transports: [new winston.transports.Console()]
})

const kyseraLogger: KyseraLogger = {
  debug: (msg, ...args) => winstonLogger.debug(msg, ...args),
  info: (msg, ...args) => winstonLogger.info(msg, ...args),
  warn: (msg, ...args) => winstonLogger.warn(msg, ...args),
  error: (msg, ...args) => winstonLogger.error(msg, ...args),
}
```

## Best Practices

### 1. Use Prefixed Loggers for Services

```typescript
class UserService {
  private logger = createPrefixedLogger('UserService')

  async getUser(id: string) {
    this.logger.debug('Fetching user', { id })
    // ...
  }
}
```

### 2. Use Silent Logger in Tests

```typescript
import { silentLogger } from '@kysera/core'

const service = new MyService({
  logger: silentLogger
})
```

### 3. Environment-Based Logging

```typescript
import { consoleLogger, silentLogger } from '@kysera/core'

const logger = process.env.NODE_ENV === 'test'
  ? silentLogger
  : consoleLogger
```

## Related

- [Debug Module](/docs/api/core/debug) - Query profiling with logging
- [Health Module](/docs/api/core/health) - Health monitoring with logging
