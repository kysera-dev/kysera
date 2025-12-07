# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2025-12-07

### Changed
- Proper `@kysera/repository` import instead of relative dist imports
- Added `@kysera/core` dependency for consistent patterns

### Fixed
- Fixed relative import from dist to proper `@kysera/repository` import

## [0.5.0] - 2025-12-06

### Added
- Batch operations: `createMany()`, `updateMany()`, `touchMany()`
- Configurable `primaryKeyColumn` option for UUID/custom PK support
- 51 new tests for batch operations, edge cases, and date formats

### Changed
- Improved type safety with documented type assertions

## [0.4.1] - 2025-10-17

### Fixed
- Linting issues across the package

## [0.4.0] - 2025-10-15

### Added
- Initial release of @kysera/timestamps
- Automatic `created_at`/`updated_at` field management
- Automatic updates on insert/update operations
- Configurable column names
- Type-safe implementation
- Integration with repository pattern
- Multi-database support (PostgreSQL, MySQL, SQLite)
