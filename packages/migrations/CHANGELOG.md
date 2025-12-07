# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2025-12-07

### Changed
- Aligned with `@kysera/core` and `@kysera/repository` patterns
- Consistent error handling using `@kysera/core` error classes

### Fixed
- Proper integration with the kysera ecosystem patterns

## [0.5.0] - 2025-12-07

### Added
- `@kysera/core` integration with typed `MigrationError` class
- Minimalist API: `defineMigrations()`, `runMigrations()`, `rollbackMigrations()`
- `getMigrationStatus()` helper for migration state inspection
- Plugin system with `MigrationPlugin` interface
- Built-in plugins: `createLoggingPlugin()`, `createMetricsPlugin()`
- `MigrationWithMeta` functional with metadata logging
- Duplicate migration name validation
- `useTransactions` and `stopOnError` options
- Expanded test coverage from 24 to 35 tests
- Comprehensive API documentation in README

### Fixed
- Inconsistent dry run behavior in `reset()` and `upTo()`
- TypeScript errors and type safety improvements

## [0.4.1] - 2025-10-17

### Fixed
- Linting issues across the package

## [0.4.0] - 2025-10-15

### Added
- Initial release of @kysera/migrations
- Version-controlled schema changes
- Up/down migration support
- Migration templating
- Status tracking
- Dry-run support for safe migration testing
- Flexible rollback capabilities
- Multi-database support (PostgreSQL, MySQL, SQLite)
