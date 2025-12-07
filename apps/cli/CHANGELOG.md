# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2025-12-07

### Added
- 600+ tests for CLI commands, config, and utilities
- Bash/Zsh/Fish completion scripts for shell integration
- Basic-usage examples for all packages

### Changed
- Aligned versions and peer dependencies across packages
- Relaxed CLI tsconfig for broader compatibility

### Fixed
- Replaced `execSync` with `execa` to prevent command injection
- Fixed `sql.raw` usage in dialect files

### Security
- Replaced `execSync` with `execa` for safer command execution

## [0.5.0] - 2025-12-06

### Added
- Security warnings and SECURITY.md documentation
- Integration with @xec-sh/kit for improved command execution

### Changed
- Updated dependencies across the ecosystem

### Fixed
- Cross-package test imports in migrations and repository

### Security
- Removed hardcoded passwords from codebase
- Added security warnings for sensitive operations

## [0.4.1] - 2025-10-17

### Fixed
- Linting issues across the package

## [0.4.0] - 2025-10-15

### Added
- Initial release of @kysera/cli
- Migration management commands (create, up, down, status, reset)
- Database operations (console, dump, restore, reset, introspect, tables)
- Code generation (CRUD, models, repositories, schema)
- Testing utilities (fixtures, seed, setup, teardown)
- Audit commands (history, compare, diff, logs, restore, stats, cleanup)
- Query utilities (analyze, explain, by-timestamp, soft-deleted)
- Repository tools (list, inspect, methods, validate)
- Plugin system (list, enable, disable, config)
- Health monitoring (check, metrics, watch)
- Debug tools (analyzer, circuit-breaker, errors, profile, sql)
- Docker support with Dockerfile
- E2E and integration tests
- Comprehensive command-line interface
