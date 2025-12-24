---
sidebar_position: 7
title: Migration Guide v0.7 → v0.8
description: Upgrading from Kysera v0.7 to v0.8
---

# Migration Guide: v0.7 → v0.8

This guide covers migrating from Kysera v0.7 to v0.8, which is a **major cleanup release** that removes deprecated APIs and standardizes naming conventions across the codebase.

## Overview

**Version 0.8** is a breaking change release focused on:

- **Secure-by-Default RLS** - `requireContext` now defaults to `true` for improved security
- **Removing Deprecated APIs** - All deprecated options and type aliases from v0.7 are now removed
- **Standardized Naming** - Consistent use of `Dialect` type across all packages
- **Cleaner API Surface** - Simplified imports and fewer legacy exports

:::warning Breaking Changes
v0.8 removes all deprecated APIs from v0.7. If you haven't migrated away from deprecated APIs yet, **review the v0.7 migration guide first**, then follow this guide to complete your upgrade to v0.8.
:::

## What's Changed in v0.8

### 1. RLS Plugin: `requireContext` Now Defaults to `true`

The RLS plugin now enforces context by default for improved security. Previously, queries without RLS context would run unfiltered, which could lead to accidental data leaks in multi-tenant applications.

**Impact:** If your application has code paths that run without RLS context (e.g., background jobs, system operations), you must either:
- Wrap them in `rlsContext.asSystemAsync()` (recommended)
- Or explicitly set `requireContext: false` in the plugin options

### 2. RLS Plugin: `skipTables` Option Removed

The deprecated `skipTables` option in the RLS plugin has been completely removed. This option was deprecated in v0.7.x in favor of the more descriptive `excludeTables` option.

**Impact:** If you're still using `skipTables`, your code will break in v0.8.

### 3. `DatabaseDialect` Type Alias Removed

The `DatabaseDialect` type alias has been removed from multiple packages:
- `@kysera/dialects`
- `@kysera/testing`
- Other packages that re-exported it

**Impact:** If you're importing `DatabaseDialect` instead of `Dialect`, TypeScript will report errors.

### 4. Cleaner Package Exports

v0.8 removes legacy re-exports and standardizes the public API surface across all packages.

**Impact:** Some undocumented or internal imports may no longer work.

## Breaking Changes

:::danger Required Action
All deprecated APIs from v0.7 have been removed. You must update your code before upgrading to v0.8.
:::

### 1. RLS Plugin: `requireContext` Now Defaults to `true`

**What Changed:**
The `requireContext` option now defaults to `true` instead of `false`. This is a security improvement that prevents accidental data leaks.

**Before (v0.7.x - permissive default):**
```typescript
// Queries without RLS context ran unfiltered (potential data leak!)
await orm.posts.findAll() // ⚠️ No context = no filtering
```

**After (v0.8.0 - secure default):**
```typescript
// Option 1: Always run within RLS context (recommended)
await rlsContext.runAsync(userContext, async () => {
  await orm.posts.findAll() // ✅ Properly filtered
})

// Option 2: Use system context for privileged operations
await rlsContext.asSystemAsync(async () => {
  await orm.posts.findAll() // ✅ Explicit bypass
})

// Option 3: Opt out of secure defaults (not recommended)
const executor = await createExecutor(db, [
  rlsPlugin({
    schema: rlsSchema,
    requireContext: false,       // Restore old behavior
    allowUnfilteredQueries: true // Allow unfiltered access
  })
])
```

**Migration Steps:**
1. Identify code paths that don't set RLS context (background jobs, cron tasks, system operations)
2. Wrap them in `rlsContext.asSystemAsync()` for explicit privileged access
3. Or set `requireContext: false` if you need the old behavior (not recommended)

### 2. RLS Plugin: `skipTables` Removed

**What Changed:**
The `skipTables` option is no longer available in the RLS plugin configuration.

**Before (v0.7.x with deprecation warning):**
```typescript
import { rlsPlugin } from '@kysera/rls'

const executor = await createExecutor(db, [
  rlsPlugin({
    schema: rlsSchema,
    skipTables: ['system_logs', 'audit_trail']  // ❌ Removed in v0.8
  })
])
```

**After (v0.8.0):**
```typescript
import { rlsPlugin } from '@kysera/rls'

const executor = await createExecutor(db, [
  rlsPlugin({
    schema: rlsSchema,
    excludeTables: ['system_logs', 'audit_trail']  // ✅ Use this instead
  })
])
```

**Migration Steps:**
1. Find all occurrences of `skipTables` in your codebase
2. Rename to `excludeTables` (the functionality is identical)
3. No other changes needed - the options work the same way

**Search Pattern:**
```bash
# Find all uses of skipTables
grep -r "skipTables" --include="*.ts" --include="*.js"
```

### 3. `DatabaseDialect` Type Alias Removed

**What Changed:**
The `DatabaseDialect` type alias has been removed. Use `Dialect` from `@kysera/core` instead.

**Before (v0.7.x with deprecation notice):**
```typescript
import { DatabaseDialect } from '@kysera/dialects'  // ❌ Removed in v0.8
import { DatabaseDialect } from '@kysera/testing'   // ❌ Removed in v0.8

function query(dialect: DatabaseDialect) {
  // ...
}
```

**After (v0.8.0):**
```typescript
import { Dialect } from '@kysera/core'  // ✅ Use this instead

// Or use the re-exported version for convenience
import { Dialect } from '@kysera/dialects'  // ✅ Re-exported from @kysera/core
import { Dialect } from '@kysera/testing'   // ✅ Re-exported from @kysera/core

function query(dialect: Dialect) {
  // ...
}
```

**Migration Steps:**
1. Find all imports of `DatabaseDialect`
2. Replace with `Dialect` from the same package (now re-exported from `@kysera/core`)
3. Or import directly from `@kysera/core` if preferred

**TypeScript Migration Pattern:**
```typescript
// Use TypeScript's rename feature in VS Code:
// 1. Place cursor on "DatabaseDialect"
// 2. Press F2 (Rename Symbol)
// 3. Type "Dialect"
// 4. Press Enter

// Or use find-and-replace:
// Find:    import { DatabaseDialect } from
// Replace: import { Dialect } from
```

**Search Pattern:**
```bash
# Find all uses of DatabaseDialect
grep -r "DatabaseDialect" --include="*.ts" --include="*.d.ts"
```

## Migration Steps

### Step 1: Review v0.7 Deprecations

Before upgrading to v0.8, ensure you've migrated away from all v0.7 deprecations:

**Check for deprecated APIs:**
```bash
# Check for skipTables
grep -r "skipTables" --include="*.ts" --include="*.js"

# Check for DatabaseDialect
grep -r "DatabaseDialect" --include="*.ts" --include="*.d.ts"
```

If you find any occurrences, follow the migration steps in the **Breaking Changes** section above.

### Step 2: Update Dependencies

Update all Kysera packages to v0.8.x:

```bash
# Update all packages
pnpm add @kysera/core@^0.8.0 \
         @kysera/executor@^0.8.0 \
         @kysera/repository@^0.8.0 \
         @kysera/dal@^0.8.0 \
         @kysera/soft-delete@^0.8.0 \
         @kysera/rls@^0.8.0 \
         @kysera/audit@^0.8.0 \
         @kysera/timestamps@^0.8.0 \
         @kysera/dialects@^0.8.0 \
         @kysera/testing@^0.8.0
```

**Peer Dependencies:**
Ensure peer dependencies are up to date:

```bash
# Kysely (unchanged - still >=0.28.9)
pnpm add kysely@latest

# Zod (if using Repository validation)
pnpm add zod@latest
```

### Step 3: Update RLS Plugin Configuration

Replace all `skipTables` options with `excludeTables`:

**Before (v0.7.x):**
```typescript
import { createExecutor } from '@kysera/executor'
import { rlsPlugin } from '@kysera/rls'
import type { RLSSchema } from '@kysera/rls'

const rlsSchema: RLSSchema = {
  users: {
    tenant: { column: 'tenant_id' }
  }
}

const executor = await createExecutor(db, [
  rlsPlugin({
    schema: rlsSchema,
    skipTables: ['system_logs', 'migrations', 'audit_trail']  // ❌ Old option
  })
])
```

**After (v0.8.0):**
```typescript
import { createExecutor } from '@kysera/executor'
import { rlsPlugin } from '@kysera/rls'
import type { RLSSchema } from '@kysera/rls'

const rlsSchema: RLSSchema = {
  users: {
    tenant: { column: 'tenant_id' }
  }
}

const executor = await createExecutor(db, [
  rlsPlugin({
    schema: rlsSchema,
    excludeTables: ['system_logs', 'migrations', 'audit_trail']  // ✅ New option
  })
])
```

**Automated Migration:**
```bash
# Find and replace in all TypeScript files
find . -name "*.ts" -exec sed -i '' 's/skipTables:/excludeTables:/g' {} +
```

### Step 4: Update Type Imports

Replace `DatabaseDialect` with `Dialect`:

**Before (v0.7.x):**
```typescript
import { DatabaseDialect } from '@kysera/dialects'
import type { DatabaseDialect as TestDialect } from '@kysera/testing'

function createAdapter(dialect: DatabaseDialect) {
  // ...
}

function setupTest(dialect: TestDialect) {
  // ...
}
```

**After (v0.8.0):**
```typescript
import { Dialect } from '@kysera/dialects'
import type { Dialect as TestDialect } from '@kysera/testing'

function createAdapter(dialect: Dialect) {
  // ...
}

function setupTest(dialect: TestDialect) {
  // ...
}
```

**Or import from @kysera/core directly:**
```typescript
import type { Dialect } from '@kysera/core'

function createAdapter(dialect: Dialect) {
  // ...
}

function setupTest(dialect: Dialect) {
  // ...
}
```

**Automated Migration:**
```bash
# Find and replace DatabaseDialect imports
find . -name "*.ts" -exec sed -i '' 's/DatabaseDialect/Dialect/g' {} +
```

### Step 5: Run Type Checking

After updating imports and options, verify there are no type errors:

```bash
# Run TypeScript compiler
pnpm typecheck

# Or if using Turborepo
turbo typecheck
```

**Common Type Errors:**

1. **Missing excludeTables:**
   ```
   Error: Property 'skipTables' does not exist on type 'RLSPluginConfig'
   ```
   **Fix:** Replace `skipTables` with `excludeTables`

2. **Unknown type DatabaseDialect:**
   ```
   Error: Cannot find name 'DatabaseDialect'
   ```
   **Fix:** Import `Dialect` instead

### Step 6: Update Tests

If your tests reference deprecated APIs, update them:

**Before (v0.7.x):**
```typescript
import { createExecutor } from '@kysera/executor'
import { rlsPlugin } from '@kysera/rls'
import type { DatabaseDialect } from '@kysera/testing'

describe('RLS Tests', () => {
  const testDialect: DatabaseDialect = 'postgres'

  it('excludes system tables', async () => {
    const executor = await createExecutor(db, [
      rlsPlugin({
        schema: { users: { tenant: { column: 'tenant_id' } } },
        skipTables: ['system_logs']  // ❌ Old option
      })
    ])

    // Test code...
  })
})
```

**After (v0.8.0):**
```typescript
import { createExecutor } from '@kysera/executor'
import { rlsPlugin } from '@kysera/rls'
import type { Dialect } from '@kysera/testing'

describe('RLS Tests', () => {
  const testDialect: Dialect = 'postgres'

  it('excludes system tables', async () => {
    const executor = await createExecutor(db, [
      rlsPlugin({
        schema: { users: { tenant: { column: 'tenant_id' } } },
        excludeTables: ['system_logs']  // ✅ New option
      })
    ])

    // Test code...
  })
})
```

### Step 7: Run Full Test Suite

Verify all tests pass with v0.8:

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Test against all databases
pnpm test:multi-db
```

### Step 8: Update Documentation (If Applicable)

If you maintain internal documentation or code examples:

1. Update all references to `skipTables` → `excludeTables`
2. Update all references to `DatabaseDialect` → `Dialect`
3. Update version numbers in examples to v0.8.x

## Complete Migration Example

Here's a full example showing all changes together:

**Before (v0.7.x):**
```typescript
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { rlsPlugin } from '@kysera/rls'
import { softDeletePlugin } from '@kysera/soft-delete'
import type { DatabaseDialect } from '@kysera/dialects'  // ❌ Old type
import type { RLSSchema } from '@kysera/rls'

const dialect: DatabaseDialect = 'postgres'  // ❌ Old type

const rlsSchema: RLSSchema = {
  users: {
    tenant: { column: 'tenant_id' },
    user: { column: 'created_by' }
  },
  posts: {
    tenant: { column: 'tenant_id' }
  }
}

async function setupDatabase() {
  const executor = await createExecutor(db, [
    softDeletePlugin(),
    rlsPlugin({
      schema: rlsSchema,
      skipTables: ['migrations', 'system_logs']  // ❌ Old option
    })
  ])

  const orm = await createORM(executor, [])
  return { executor, orm }
}
```

**After (v0.8.0):**
```typescript
import { createExecutor } from '@kysera/executor'
import { createORM } from '@kysera/repository'
import { rlsPlugin } from '@kysera/rls'
import { softDeletePlugin } from '@kysera/soft-delete'
import type { Dialect } from '@kysera/dialects'  // ✅ New type
import type { RLSSchema } from '@kysera/rls'

const dialect: Dialect = 'postgres'  // ✅ New type

const rlsSchema: RLSSchema = {
  users: {
    tenant: { column: 'tenant_id' },
    user: { column: 'created_by' }
  },
  posts: {
    tenant: { column: 'tenant_id' }
  }
}

async function setupDatabase() {
  const executor = await createExecutor(db, [
    softDeletePlugin(),
    rlsPlugin({
      schema: rlsSchema,
      excludeTables: ['migrations', 'system_logs']  // ✅ New option
    })
  ])

  const orm = await createORM(executor, [])
  return { executor, orm }
}
```

## Breaking Changes Summary

This is the complete list of breaking changes in v0.8.0:

### @kysera/rls

| Change                           | Previous Behavior         | New Behavior                                      |
| -------------------------------- | ------------------------- | ------------------------------------------------- |
| `requireContext` default         | `false` (permissive)      | `true` (secure-by-default)                        |
| `skipTables` option              | Deprecated but available  | **Removed** - use `excludeTables`                 |

### Type Aliases

| Removed Type        | Replacement | Package              |
| ------------------- | ----------- | -------------------- |
| `DatabaseDialect`   | `Dialect`   | `@kysera/dialects`   |
| `DatabaseDialect`   | `Dialect`   | `@kysera/testing`    |

**Note:** `Dialect` is exported from `@kysera/core` and re-exported by `@kysera/dialects` and `@kysera/testing` for convenience.

## Troubleshooting

### Issue: "RLSContextError: RLS context required"

**Full Error:**
```
RLSContextError: RLS context required but not found.
Ensure code runs within rlsContext.runAsync() or use rlsContext.asSystemAsync() for system operations.
```

**Cause:** Running queries without RLS context after upgrading to v0.8.0 (which defaults to `requireContext: true`).

**Solutions:**

```typescript
// Solution 1: Wrap in RLS context (for user operations)
await rlsContext.runAsync(
  { auth: { userId: user.id, tenantId: user.tenantId, roles: user.roles }, timestamp: new Date() },
  async () => {
    await orm.posts.findAll()
  }
)

// Solution 2: Use system context (for background jobs)
await rlsContext.asSystemAsync(async () => {
  await orm.posts.findAll()
})

// Solution 3: Opt out of secure defaults (not recommended)
rlsPlugin({
  schema: rlsSchema,
  requireContext: false,
  allowUnfilteredQueries: true
})
```

### Issue: "Property 'skipTables' does not exist"

**Full Error:**
```
Property 'skipTables' does not exist on type 'RLSPluginConfig'.
Did you mean 'excludeTables'?
```

**Cause:** Using removed `skipTables` option.

**Solution:** Replace with `excludeTables`:

```typescript
// Before
rlsPlugin({ schema, skipTables: ['logs'] })

// After
rlsPlugin({ schema, excludeTables: ['logs'] })
```

### Issue: "Cannot find name 'DatabaseDialect'"

**Full Error:**
```
Cannot find name 'DatabaseDialect'. Did you mean 'Dialect'?
```

**Cause:** Importing removed `DatabaseDialect` type.

**Solution:** Import `Dialect` instead:

```typescript
// Before
import type { DatabaseDialect } from '@kysera/dialects'

// After
import type { Dialect } from '@kysera/dialects'
// Or
import type { Dialect } from '@kysera/core'
```

### Issue: Build Fails After Upgrade

**Cause:** Outdated type definitions or cached builds.

**Solution:** Clear caches and rebuild:

```bash
# Clear Turborepo cache
turbo daemon clean

# Clear node_modules and reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Rebuild all packages
pnpm build

# Run type checking
pnpm typecheck
```

### Issue: Tests Fail After Migration

**Cause:** Test utilities or mocks using deprecated APIs.

**Solution:** Search for deprecated APIs in test files:

```bash
# Find deprecated APIs in tests
grep -r "skipTables" test/ --include="*.ts"
grep -r "DatabaseDialect" test/ --include="*.ts"
```

Then update according to the migration steps above.

### Issue: Third-Party Plugins Don't Work

**Cause:** Third-party plugins may still use deprecated APIs.

**Solution:**
1. Check if the plugin has a v0.8-compatible version
2. Contact the plugin author to update for v0.8
3. If the plugin is unmaintained, consider forking and updating

**Temporary Workaround:**
Stay on v0.7.x until plugins are updated, or migrate to official Kysera plugins.

## Migration Checklist

Use this checklist to ensure complete migration:

- [ ] **Update package.json** - All Kysera packages to ^0.8.0
- [ ] **Handle RLS context** - Ensure all queries run within `rlsContext.runAsync()` or use `asSystemAsync()` for system operations
- [ ] **Replace skipTables** - All occurrences replaced with `excludeTables`
- [ ] **Replace DatabaseDialect** - All occurrences replaced with `Dialect`
- [ ] **Update imports** - Import `Dialect` from correct package
- [ ] **Run typecheck** - No TypeScript errors
- [ ] **Update tests** - All test files migrated (check for RLSContextError in tests)
- [ ] **Run test suite** - All tests pass
- [ ] **Update docs** - Internal documentation updated (if applicable)
- [ ] **Review changelog** - Check for any package-specific changes

## Automated Migration Script

Use this bash script to automate most of the migration:

```bash
#!/bin/bash

# kysera-v08-migrate.sh - Automated migration to v0.8.0

echo "🔄 Migrating to Kysera v0.8.0..."

# 1. Replace skipTables with excludeTables
echo "📝 Replacing skipTables with excludeTables..."
find . -name "*.ts" -not -path "*/node_modules/*" -exec sed -i '' 's/skipTables:/excludeTables:/g' {} +

# 2. Replace DatabaseDialect with Dialect
echo "📝 Replacing DatabaseDialect with Dialect..."
find . -name "*.ts" -not -path "*/node_modules/*" -exec sed -i '' 's/DatabaseDialect/Dialect/g' {} +

# 3. Update package.json
echo "📦 Updating dependencies..."
pnpm add @kysera/core@^0.8.0 \
         @kysera/executor@^0.8.0 \
         @kysera/repository@^0.8.0 \
         @kysera/dal@^0.8.0 \
         @kysera/soft-delete@^0.8.0 \
         @kysera/rls@^0.8.0 \
         @kysera/audit@^0.8.0 \
         @kysera/timestamps@^0.8.0 \
         @kysera/dialects@^0.8.0 \
         @kysera/testing@^0.8.0

# 4. Clear cache and rebuild
echo "🧹 Clearing cache..."
turbo daemon clean
rm -rf node_modules/.cache

# 5. Run type checking
echo "🔍 Running type check..."
pnpm typecheck

# 6. Run tests
echo "🧪 Running tests..."
pnpm test

echo "✅ Migration complete!"
echo ""
echo "⚠️  Please review the changes and verify all tests pass."
echo "📚 See migration guide: https://kysera.dev/docs/guides/migration-v08"
```

**Usage:**
```bash
# Make script executable
chmod +x kysera-v08-migrate.sh

# Run migration
./kysera-v08-migrate.sh
```

**Note:** Always review automated changes before committing!

## Next Steps

After successfully migrating to v0.8:

1. **Review the Changelog:** [v0.8.0 Release Notes](https://github.com/kysera/kysera/releases/tag/v0.8.0)
2. **Check for v1.0 Roadmap:** [Kysera v1.0 Planning](https://github.com/kysera/kysera/discussions)
3. **Update CI/CD:** Ensure deployment pipelines use v0.8.x
4. **Monitor for Issues:** Watch for edge cases in production
5. **Plan for v1.0:** v0.8 is the last major release before v1.0

## Getting Help

If you encounter issues during migration:

- **Documentation:** Check the [API Reference](/docs/api/overview)
- **GitHub Issues:** [Report a bug](https://github.com/kysera/kysera/issues)
- **Discussions:** [Ask questions](https://github.com/kysera/kysera/discussions)
- **Discord:** Join our [community Discord](https://discord.gg/kysera)

## See Also

- [Migration Guide v0.6 → v0.7](/docs/guides/migration-v07) - Previous migration guide
- [RLS Plugin](/docs/plugins/rls) - Row-Level Security documentation
- [Dialects API](/docs/api/dialects) - Database dialect support
- [Testing Guide](/docs/guides/testing) - Testing best practices
- [Best Practices](/docs/guides/best-practices) - Production patterns
- [Changelog](https://github.com/kysera/kysera/blob/main/CHANGELOG.md) - Full changelog
