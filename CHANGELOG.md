# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


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

