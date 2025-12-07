# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2025-12-07

### Changed
- Use `NotFoundError` from `@kysera/core` for missing records
- Proper `@kysera/repository` import instead of relative dist imports

### Fixed
- Fixed relative import from dist to proper `@kysera/repository` import
- Fixed plugin version from 1.0.0 to 0.5.1
- Added `@kysera/core` dependency for consistent error classes

## [0.5.0] - 2025-12-06

### Added
- Batch operations: `softDeleteMany()`, `restoreMany()`, `hardDeleteMany()`
- Configurable `primaryKeyColumn` option for UUID/custom PK support
- 72 new tests for edge cases, custom keys, and batch operations

### Changed
- Improved type safety with documented type assertions

## [0.4.1] - 2025-10-17

### Fixed
- Linting issues across the package

## [0.4.0] - 2025-10-15

### Added
- Initial release of @kysera/soft-delete
- Automatic `deleted_at` timestamps
- Query filtering for non-deleted records
- Restore capabilities for soft-deleted records
- Multi-database support (PostgreSQL, MySQL, SQLite)
- Integration with repository pattern
- Type-safe implementation
