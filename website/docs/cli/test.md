---
sidebar_position: 7
title: test
description: Test environment commands
---

# kysera test

Test environment setup and management.

## Commands

### setup

Set up test environment.

```bash
kysera test setup
```

**Options:**
```
-e, --environment <env>   Environment (test/ci/local, default: test)
-d, --database <name>     Test database name
--clean                   Drop existing test database
--migrate                 Run migrations (default: true)
--seed                    Run seeders
--fixtures <files...>     Load specific fixtures
--parallel                Enable parallel test execution
--isolation <type>        Isolation strategy (default: transaction)
-v, --verbose             Verbose output
--json                    Output as JSON
--config <path>           Path to configuration file
```

**Isolation Strategies:**
- `transaction` - Use transactions (fastest)
- `schema` - Separate schema per test
- `database` - Separate database per test

**Examples:**
```bash
# Basic setup
kysera test setup

# Clean setup with seeding
kysera test setup --clean --migrate --seed

# CI environment
kysera test setup -e ci --clean

# Load fixtures
kysera test setup --fixtures users posts
```

### seed

Seed test database.

```bash
kysera test seed
```

**Options:**
```
--strategy <type>         Data generation (realistic/random/sequential)
--count <number>          Records per table
--table <name>            Specific table
--fixtures <files...>     Load fixtures
--async                   Parallel seeding
```

**Examples:**
```bash
# Seed with realistic data
kysera test seed --strategy realistic --count 100

# Seed specific table
kysera test seed --table users --count 50

# Load fixtures
kysera test seed --fixtures users admin-users
```

### fixtures

Manage test fixtures.

```bash
kysera test fixtures
```

**Options:**
```
--load <files...>         Load specific fixtures
--generate                Generate fixture templates
--validate                Validate fixture files
--format <type>           Format: json, yaml, ts
```

### teardown

Clean up test environment.

```bash
kysera test teardown
```

**Options:**
```
-e, --environment <env>   Environment (default: test)
--keep-data               Keep data, only clear migrations
--force                   Skip confirmation
-v, --verbose             Verbose output
```

## Fixture Format

### JSON Fixtures

```json
// fixtures/users.json
{
  "users": [
    { "email": "admin@test.com", "name": "Admin", "role": "admin" },
    { "email": "user@test.com", "name": "User", "role": "user" }
  ]
}
```

### TypeScript Fixtures

```typescript
// fixtures/users.ts
import { Fixture } from '@kysera/cli'

export default {
  table: 'users',
  data: [
    { email: 'admin@test.com', name: 'Admin', role: 'admin' },
    { email: 'user@test.com', name: 'User', role: 'user' }
  ]
} satisfies Fixture
```

## Workflow Examples

### Basic Test Setup

```bash
# Before tests
kysera test setup --clean --migrate --seed

# Run tests
npm test

# After tests
kysera test teardown
```

### CI/CD Pipeline

```yaml
# .github/workflows/test.yml
jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - name: Setup test database
        run: kysera test setup --clean --migrate
      - name: Run tests
        run: npm test
      - name: Teardown
        run: kysera test teardown --force
        if: always()
```

### Parallel Testing

```bash
# Setup with parallel support
kysera test setup --parallel --isolation schema

# Tests can run in parallel using separate schemas
npm test -- --parallel
```

## Best Practices

### 1. Use Transaction Isolation

```bash
kysera test setup --isolation transaction
```

Fastest option - each test runs in a transaction that rolls back.

### 2. Keep Fixtures Minimal

Only essential data for tests. Use factories for test-specific data.

### 3. Clean Before Test Runs

```bash
kysera test setup --clean
```

Ensures consistent starting state.

### 4. Separate Test Database

```bash
kysera test setup -d myapp_test
```

Never test against production or development databases.
