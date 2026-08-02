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
-f, --force               Skip confirmation when dropping an existing database
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
-t, --tables <names...>   Specific tables to seed
-c, --count <n>           Records per table (default: 100)
--clean                   Clean tables before seeding
-s, --strategy <type>     Seeding strategy (default: realistic)
--relationships           Create related records (default: true)
--locale <locale>         Faker locale (default: en)
--seed <number>           Random seed for reproducibility
--custom <file>           Custom seeder file
-v, --verbose             Verbose output
--json                    Output as JSON
--config <path>           Path to configuration file
```

**Examples:**

```bash
# Seed with realistic data
kysera test seed --strategy realistic --count 100

# Seed specific tables
kysera test seed --tables users posts --count 50

# Reproducible data from a fixed random seed
kysera test seed --seed 42

# Use a custom seeder file
kysera test seed --custom ./tests/seeders/custom.ts
```

### fixtures

Manage test fixtures.

```bash
kysera test fixtures
```

**Options:**

```
-l, --load <files...>     Load specific fixture files
-d, --directory <path>    Fixtures directory (default: tests/fixtures)
-f, --format <type>       Format: json, yaml, sql, js, auto (default: auto)
-s, --save <name>         Save current data as fixture
--list                    List available fixtures
--validate                Validate fixtures without loading
--dependencies            Load fixture dependencies (default: true)
--checksum                Verify fixture checksums
--tags <tags...>          Filter by tags
-v, --verbose             Verbose output
--json                    Output as JSON
--config <path>           Path to configuration file
```

**Examples:**

```bash
# List available fixtures
kysera test fixtures --list

# Load specific fixtures
kysera test fixtures --load users posts

# Snapshot current data as a fixture
kysera test fixtures --save baseline

# Validate without loading
kysera test fixtures --validate
```

### teardown

Clean up test environment.

```bash
kysera test teardown
```

**Options:**

```
-e, --environment <env>   Environment to clean (default: test)
-d, --database <name>     Specific database to clean
-f, --force               Skip confirmation
--keep-data               Keep test data (truncate instead of drop)
--preserve-logs           Preserve test execution logs
--clean-artifacts         Clean test artifacts (default: true)
--pattern <pattern>       Database name pattern to match
-v, --verbose             Verbose output
--json                    Output as JSON
--config <path>           Path to configuration file
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

### JavaScript/TypeScript Fixtures

A fixture module default-exports an object with the target `table` and its `data` rows (`@kysera/cli` is binary-only, so there is no importable `Fixture` type):

```typescript
// fixtures/users.ts
export default {
  table: 'users',
  data: [
    { email: 'admin@test.com', name: 'Admin', role: 'admin' },
    { email: 'user@test.com', name: 'User', role: 'user' }
  ]
}
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
