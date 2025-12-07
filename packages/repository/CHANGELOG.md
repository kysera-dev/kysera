# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2025-12-07

### Changed
- Use `NotFoundError` from `@kysera/core` for not found scenarios
- Use `DatabaseError` for database operation failures
- Improved integration with `@kysera/core` error classes

### Fixed
- Proper `@kysera/core` import patterns

## [0.5.0] - 2025-12-06

### Added
- True keyset cursor pagination with O(1) performance
- Configurable `primaryKeyColumn` option for UUID/custom PK support
- 13 new tests for keyset pagination

### Changed
- Improved type safety with documented type assertions

## [0.4.1] - 2025-10-17

### Fixed
- Linting issues across the package

## [0.4.0] - 2025-10-15

### Added
- Initial release of @kysera/repository
- Base repository with CRUD operations
- Type-safe table operations
- Validation helpers with Zod integration
- Plugin system for extensibility
- Batch operations support
- Smart validation system
- Zero runtime dependencies (peer: kysely, zod)
- 100% TypeScript with strict mode
