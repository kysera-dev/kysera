# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.5] - 2026-02-07

### ✨ Features

- feat(repository): add MongoDB-style query operators for find()

### 📝 Other Changes

- docs(executor): fix schemaPlugin documentation and add tests


## [0.8.4] - 2026-02-05

### ✨ Features

- feat(cli): add PostgreSQL schema management commands and --schema option


## [0.8.3] - 2026-02-05

### ✨ Features

- feat: production-grade PostgreSQL schema support across all packages
- feat(rls): add advanced RLS features and PostgreSQL integration tests

### 📝 Other Changes

- chore(release): v0.8.2
- docs(rls): comprehensive documentation for all advanced features
- docs: comprehensive documentation audit and code-documentation sync
- docs: remove contributing sections from all README files
- docs: fix incorrect version references for requireContext breaking change


## [0.8.2] - 2026-01-07

### ✨ Features

- feat(rls): add advanced RLS features and PostgreSQL integration tests

### 📝 Other Changes

- docs(rls): comprehensive documentation for all advanced features
- docs: comprehensive documentation audit and code-documentation sync
- docs: remove contributing sections from all README files
- docs: fix incorrect version references for requireContext breaking change


## [0.8.1] - 2025-12-24

### ✨ Features

- feat: plugin schema validation, testing utilities, and documentation overhaul
- feat(examples): comprehensive examples overhaul with Docker and RLS plugin


## [0.8.0] - 2025-12-23

### Breaking Changes

- **RLS Plugin**: `requireContext` now defaults to `true` (secure-by-default). Applications that previously relied on queries without RLS context must now explicitly set `requireContext: false` or use `rlsContext.asSystemAsync()` for system operations.
- **RLS Plugin**: Removed deprecated `skipTables` option. Use `excludeTables` instead.
- **Types**: Removed deprecated `DatabaseDialect` type alias from `@kysera/core`, `@kysera/dialects`, and `@kysera/testing`. Use `Dialect` from `@kysera/core` instead.

### Changed

- All packages updated to version 0.8.0
- RLS plugin configuration simplified (only `excludeTables` supported)
- RLS plugin now enforces context by default for improved security
- Type exports consolidated to use canonical `Dialect` type from `@kysera/core`

### Migration

See the [v0.8 Migration Guide](/docs/guides/migration-v08) for detailed upgrade instructions.

## [0.7.4] - 2025-12-23

### ✨ Features

- feat: production-grade MSSQL pagination and cascade delete support
- feat: add MSSQL (SQL Server) support across Kysera packages
- feat(website): add local search and fix footer theme contrast

### 🐛 Bug Fixes

- fix: comprehensive security audit fixes and documentation updates
- fix: resolve all critical and high priority issues from code audit
- fix: resolve security issues and implement dynamic version injection

### 📝 Other Changes

- docs: comprehensive documentation consistency audit and fixes
- docs: add MSSQL support to website and main pages
- docs: comprehensive documentation update for v0.7.3
- test: comprehensive test audit and coverage improvements
- docs: comprehensive documentation update for v0.7.3
- docs: comprehensive documentation audit and CLI accuracy fixes
- docs: fix API documentation discrepancies and add missing content
- chore: remove changesets dependency


## [Unreleased]

### 🔒 Security Fixes

#### CRITICAL Severity
- **CRIT-1**: Fixed Zod import issue in @kysera/soft-delete - now properly optional via separate `/schema` export
  - Main package works WITHOUT Zod installed
  - Schema validation available via `@kysera/soft-delete/schema` import
  - Zero breaking changes - fully backward compatible

#### HIGH Severity
- **H-1**: Fixed repository executor type to include `KyseraExecutor<DB>` (was missing)
- **H-2**: Fixed `AnyExecutor` to properly reference `KyseraExecutorMarker` instead of hardcoding structure
- **H-6**: Improved context detection fallback check - now checks for `KyseraTransaction` marker before assuming Kysely internals
- **H-7**: Added column name validation in dynamic WHERE clauses (development mode by default)
  - Prevents SQL injection via malicious column names
  - Customizable whitelist support
  - Zero performance impact in production
- **H-8**: Added runtime type cast validation in development mode
  - Detects structural mismatches early
  - Zero performance impact in production
- **H-9**: Extracted duplicate primary key extraction logic to shared utility
  - DRY principle - single source of truth
  - Exported `extractPrimaryKey()` utility
- **H-12**: Fixed type signature mismatch in soft-delete plugin (now accepts `number | string` consistently)

#### MEDIUM Severity
- **M-1**: Documented dual transaction APIs with comprehensive guide (`TRANSACTION_GUIDE.md`)
- **M-2**: Extended `chain()` type safety from 3 to 8 transforms
- **M-3**: Added configurable rollback error handling modes (`log-only`, `throw`, `callback`)
- **M-4**: Fixed LRU cache undefined handling with sentinel pattern
- **M-5**: Standardized error message extraction across all dialects (nullish coalescing)
- **M-6**: Fixed health check timeout cleanup (prevents memory leaks)
- **M-7**: Replaced circuit breaker mutex with proper queue-based implementation
- **M-8**: Added audit table creation race condition protection with distributed locking
- **M-9**: Added `onDestroy` lifecycle hooks to all plugins for proper cleanup
- **M-10**: Standardized RLS plugin API - `excludeTables` replaces deprecated `skipTables`

#### LOW Severity
- **L-1**: Added clear migration paths to deprecated types (`Selectable`, `Insertable`, `Updateable`)
  - Deprecation warnings with timeline (v0.7.0 → removed in v1.0.0)
  - Code examples for migration
- **L-2**: Extracted magic numbers to named constants (`MAX_LIMIT`, `MIN_LIMIT`)
- **L-3**: Extended logger interface with `trace()` and `fatal()` levels (now 6 levels total)
  - Matches industry standards (syslog, log4j, winston)
  - Custom logger implementors must add new methods
- **L-4**: Documented duplicate type guards (`isCountResult`, `isGroupedCountRow`)
  - Explained semantic vs runtime difference
  - Prevents breaking refactors

### 🐛 Bug Fixes

- fix(core): proper type references for `KyseraExecutorMarker`
- fix(repository): column validation in dynamic queries
- fix(dal): context detection for wrapped executors
- fix(executor): LRU cache now correctly handles `undefined` values
- fix(infra): health check timeout cleanup
- fix(infra): circuit breaker mutex race conditions
- fix(audit): table creation race condition with distributed locking
- fix(soft-delete): Zod dependency now properly optional
- fix(soft-delete): type signatures accept both `number` and `string` IDs
- fix(rls): API naming consistency (`excludeTables` vs `skipTables`)

### 📝 Documentation

- docs: add comprehensive `TRANSACTION_GUIDE.md` (400+ lines)
- docs: clarify plugin lifecycle hooks (`onInit`, `onDestroy`)
- docs: document all security fixes with examples
- docs: add migration guide for deprecated types

### ⚠️ Deprecations

- **Deprecated**: `Selectable<T>`, `Insertable<T>`, `Updateable<T>` types (use Kysely's native types)
  - Will be removed in v1.0.0
  - Migration path documented
- **Deprecated**: RLS plugin `skipTables` option (use `excludeTables` instead)
  - Backward compatible with deprecation warning
  - Will be removed in v1.0.0

### 🔄 Migration Required

**For Custom Logger Implementors**:
```typescript
// Add trace() and fatal() methods to your logger:
const myLogger: KyseraLogger = {
  trace: (msg, ...args) => /* ... */,  // NEW
  debug: (msg, ...args) => /* ... */,
  info: (msg, ...args) => /* ... */,
  warn: (msg, ...args) => /* ... */,
  error: (msg, ...args) => /* ... */,
  fatal: (msg, ...args) => /* ... */   // NEW
}
```

**For RLS Plugin Users** (optional):
```typescript
// Update from deprecated skipTables to excludeTables:
const plugin = rlsPlugin({
  schema,
  excludeTables: ['system_logs', 'migrations'] // was: skipTables
})
```

### 🧪 Testing

- test: added 58 new tests for HIGH severity fixes
- test: added 30+ tests for MEDIUM severity fixes
- test: added comprehensive tests for LOW severity fixes
- test: all 179 soft-delete tests passing
- test: all 380 repository tests passing

### 📊 Security Audit Summary

**Total Issues Fixed**: 29 issues
- CRITICAL: 1 issue
- HIGH: 9 issues
- MEDIUM: 10 issues
- LOW: 4 issues (6 remaining - see audit.md)

**Remaining LOW Issues** (non-critical):
- L-5: Signed/encrypted cursors (security enhancement)
- L-6: Improved dialect detection
- L-7: Shared version utility
- L-8: Extract primary key config
- L-9: Shared table filter utility
- L-10: Plugin-specific error classes

**Impact**: 100% backward compatible, zero breaking changes, improved security and maintainability

## [0.7.3] - 2025-12-21

### ✨ Features

- feat(dialects): add @kysera/dialects package with dialect-specific utilities

## [0.7.2] - 2025-12-21

### ✨ Features

- feat(core,repository): add query helpers, context-aware repository, and upsert operations

### 📝 Other Changes

- docs: remove Package Information sections from README files

## [0.7.1] - 2025-12-16

### 📝 Other Changes

- chore(deps): upgrade Kysely to 0.28.9
- docs: clarify Kysera is not a traditional ORM
- docs: remove version numbers from README package tables
- docs(website): update homepage with accurate, stable metrics

## [0.7.0] - 2025-12-11

### ✨ Features

- feat(executor): add Unified Execution Layer for plugin-aware Kysely operations

### 📝 Other Changes

- test: fix flaky tests and improve executor coverage
- chore(deps): update dependencies and pnpm version
- docs(website): improve clarity and accuracy across all documentation
- docs: clarify Kysera is a data access toolkit, not an ORM
- docs: update CLAUDE.md to reflect v0.6.1 project state
- docs(website): add comprehensive DAL vs Repository guide and update plugin docs

## [0.6.1] - 2025-12-10

### ✨ Features

- feat(rls): add RLSPolicyEvaluationError for better error handling

### 📝 Other Changes

- docs(website): add complete API Reference for all plugin packages
- docs: update README.md for v0.6.0 release
- chore: update pnpm-lock.yaml

## [0.6.0] - 2025-12-10

### 🐛 Bug Fixes

- fix(cli): update health test mocks to use @kysera/infra
- fix(ci): fix npm/pnpm version issues in all workflows
- fix(ci): remove pnpm version conflict in deploy workflow

### 📝 Other Changes

- del specs
- feat!: major architectural refactoring with Vertical Slice Architecture
- docs: add comprehensive documentation website with Docusaurus

## [0.5.1] - 2025-12-08

### ✨ Features

- feat: add @kysera/rls package for row-level security
- feat: major update to v0.5.1 with comprehensive test coverage and security improvements

### 🐛 Bug Fixes

- fix: release script

### 📝 Other Changes

- chore: code style cleanup and version sync to v0.5.1
- update main package.json
- fix
- docs: update all README files to reflect v0.5.1 release

## [0.4.1] - 2025-10-03

### ✨ Features

- feat: complete CLI implementation (Phases 1-6) and unified release system
- feat(cli): implement Phase 1 - Core Infrastructure

### 🐛 Bug Fixes

- fix: enforce TypeScript strict mode compliance across CLI and add auto-fix tooling
- fix: resolve better-sqlite3 bindings error in GitHub Actions
- fix: correct health check test assertions to match API structure
- fix: resolve test execution errors in CI/CD
- fix: track pnpm-lock.yaml for GitHub Actions
- fix: use text instead of input from @xec-sh/kit
- fix: replace chalk/inquirer with @xec-sh/kit for consistency

### 📝 Other Changes

- chore(release): bump version to 0.4.0 and update dependencies
- chore: fix cli tests running
- docs(cli): enhance CLI specification with new commands and implementation plan
- docs: add comprehensive CLI specification for Kysera
- docs: add comprehensive README.md for @kysera/migrations package
- docs: add comprehensive README.md for @kysera/audit package
- docs: add comprehensive README.md for @kysera/soft-delete package
- docs: add comprehensive README.md for @kysera/timestamps package
- docs: add comprehensive README.md for @kysera/repository package
- docs: add comprehensive README.md for @kysera/core package
- docs: update README.md and specs/spec.md with Phase 3 completion
