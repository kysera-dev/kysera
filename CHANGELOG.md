# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


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

