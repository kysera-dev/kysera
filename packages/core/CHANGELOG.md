# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2025-12-07

### Added
- Shared logger interface for consistent logging across packages
- Zod schema exports for external validation use
- `toJSON()` override to `ForeignKeyError` for serialization consistency

### Changed
- All error classes now have consistent serialization patterns

### Fixed
- Improved error handling consistency across the ecosystem

## [0.5.0] - 2025-12-06

### Added
- Real query tracking system replacing fake metrics
- `withDebug()` wrapper for actual metrics collection
- 19 new tests for real metrics collection

### Changed
- **BREAKING**: `getMetrics()` now requires `withDebug()` wrapper for real metrics collection
- Updated README version references from 0.3.0 to 0.4.1

### Fixed
- Improved type safety with documented type assertions

## [0.4.1] - 2025-10-17

### Fixed
- Linting issues across the package

## [0.4.0] - 2025-10-15

### Added
- Initial release of @kysera/core
- Multi-database error parsing (PostgreSQL, MySQL, SQLite)
- Debug & profiling with query logging
- Health checks with pool metrics
- Pagination (offset & cursor-based)
- Retry logic with exponential backoff
- Circuit breaker pattern
- Graceful shutdown handling
- Transaction-based testing utilities
- 265 tests passing
- Zero runtime dependencies (peer: kysely)
- 100% type-safe with TypeScript strict mode
