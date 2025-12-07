# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2025-12-07

### Changed
- Use `NotFoundError` from `@kysera/core` for missing audit logs
- Use `BadRequestError` for validation errors
- Proper `@kysera/repository` import instead of relative dist imports

### Fixed
- Fixed relative import from dist to proper `@kysera/repository` import
- Added `@kysera/core` dependency for consistent error classes

## [0.5.0] - 2025-12-06

### Added
- Safe JSON parsing with graceful error handling
- Configurable `primaryKeyColumn` option for UUID/custom PK support
- 42 new tests for JSON parsing, large payloads, and security
- Comprehensive test coverage for restore and advanced features

### Fixed
- Improved JSON parsing error handling for edge cases

## [0.4.1] - 2025-10-17

### Fixed
- Linting issues across the package

## [0.4.0] - 2025-10-15

### Added
- Initial release of @kysera/audit
- Automatic change tracking
- Bulk operations support
- Multi-database compatibility (PostgreSQL, MySQL, SQLite)
- Performance optimized for high-volume writes
- Complete audit trail system
- Query utilities for audit log retrieval
