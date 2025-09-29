# Kysera Development Principles

## 🎯 Mission

Building a production-ready TypeScript ORM on top of Kysely with ZERO compromises on reliability, type safety, and performance.

## ⚠️ CRITICAL: Zero-Tolerance Reliability Policy

**This is a HIGH-RELIABILITY FRAMEWORK**. We DO NOT make assumptions, approximations, or partial implementations:

- **100% Runtime Compatibility**: All code MUST work identically on Node.js, Bun, and Deno
- **100% Test Coverage**: Every function, branch, and edge case MUST be tested
- **Zero Warnings**: No TypeScript warnings, no linter warnings, no deprecation warnings
- **Zero External Dependencies**: Core packages have ZERO external runtime dependencies
- **No "Good Enough"**: If it's not perfect, it's not ready
- **No Workarounds**: Fix the root cause, not the symptom
- **No Assumptions**: Test everything, verify everything, prove everything

**REMEMBER**: This framework will power critical systems. A single bug could have catastrophic consequences. There is NO room for error.

## 📦 Monorepo Structure

### Current Directory Layout
```
kysera/
├── packages/              # Core packages
│   ├── core/             # @kysera/core - Core utilities (8.13KB)
│   ├── repository/       # @kysera/repository - Repository pattern (4.93KB)
│   ├── soft-delete/      # @kysera/soft-delete - Soft delete plugin (477B)
│   ├── migrations/       # @kysera/migrations - Migration system (planned)
│   ├── audit/            # @kysera/audit - Audit logging (planned)
│   └── timestamps/       # @kysera/timestamps - Auto timestamps (planned)
├── examples/
│   └── blog-app/         # Example blog application
├── specs/                # Formal specifications
│   └── spec.md          # Main specification document
├── scripts/              # Build and tooling scripts
├── package.json          # Root workspace configuration
├── pnpm-workspace.yaml   # PNPM workspace configuration
├── turbo.json           # Turborepo configuration
├── tsconfig.base.json   # Base TypeScript configuration
├── eslint.config.mjs    # ESLint v9 flat config
└── CLAUDE.md           # This file
```

### Package Versions (Latest)
```json
{
  "turbo": "2.5.8",
  "typescript": "5.9.2",
  "vitest": "2.1.9 / 3.2.4",
  "tsup": "8.5.0",
  "kysely": "0.28.7",
  "zod": "3.24.1",
  "pnpm": "10.17.1"
}
```

## 🚀 ESM-Only Module System

### Critical: We Support Only ESM Modules

Since we target modern runtimes (Bun, Deno, Node.js 20+), we use ESM exclusively:

- **NO CommonJS exports** - Only `.mjs` or ESM `.js`
- **"type": "module"** in all package.json files
- **Import/export syntax only** - No `require()` or `module.exports`
- **Explicit file extensions** in imports for Deno compatibility

### Package.json Configuration

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "engines": {
    "node": ">=20.0.0",
    "bun": ">=1.0.0"
  },
  "sideEffects": false
}
```

### TSup Configuration (ESM-Only)

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],  // ESM only!
  dts: {
    tsconfig: './tsconfig.build.json'
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  target: 'esnext',  // Latest JavaScript
  platform: 'neutral',  // Platform-agnostic
  tsconfig: './tsconfig.build.json'
})
```

## 📐 TypeScript Configuration

### Strictest Possible Settings

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",

    // Strict Type Checking - MAXIMUM SAFETY
    "strict": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "useUnknownInCatchVariables": true,
    "alwaysStrict": true,

    // Additional Checks - NO COMPROMISES
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false,

    // Module Settings
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,

    // Output Settings
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "removeComments": true,

    // Type Checking
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

## 🧪 Testing Strategy

### Testing Stack
- **Vitest** - Modern, fast test runner
- **@vitest/coverage-v8** - Code coverage
- **fast-check** - Property-based testing
- **@stryker-mutator/core** - Mutation testing

### Cross-Runtime Testing

```bash
# Test in Node.js
pnpm test

# Test in Bun
bun test

# Test in Deno
deno task test
```

## 🏗 Development Workflow

### 1. Package Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build specific package
pnpm --filter @kysera/core build

# Watch mode
pnpm dev

# Type checking
pnpm typecheck

# Linting
pnpm lint

# Format code
pnpm format
```

### 2. Code Quality Gates

All code must pass:
- ✅ Type checking (`tsc --noEmit`)
- ✅ Linting (ESLint v9 with strict rules)
- ✅ Formatting (`prettier`)
- ✅ Unit tests (>95% coverage)
- ✅ Integration tests
- ✅ Cross-runtime compatibility (Node, Bun, Deno)

## 📦 Current Package Status

### Implemented Packages

| Package | Version | Size | Status | Description |
|---------|---------|------|--------|-------------|
| @kysera/core | 0.1.0 | 8.13KB | ✅ Built | Core utilities, error handling, pagination, health checks |
| @kysera/repository | 0.1.0 | 4.93KB | ✅ Built | Repository pattern with Zod validation |
| @kysera/soft-delete | 0.1.0 | 477B | ✅ Built | Soft delete plugin |

### Planned Packages

| Package | Status | Description |
|---------|--------|-------------|
| @kysera/migrations | 🚧 Planned | Database migration system |
| @kysera/audit | 🚧 Planned | Audit logging plugin |
| @kysera/timestamps | 🚧 Planned | Automatic created/updated timestamps |

## 🚀 Performance Standards

### Bundle Size Limits
- Core: <10KB
- Repository: <15KB
- Plugins: <5KB each
- Zero runtime dependencies in core

### Runtime Performance
- Operations/second: >1M
- Memory overhead: <5%
- Startup time: <10ms
- Works in edge environments

## 🔧 Build Configuration

### Turborepo Configuration

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"],
      "cache": true
    },
    "test": {
      "cache": false
    },
    "dev": {
      "persistent": true,
      "cache": false
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "cache": true
    }
  }
}
```

### PNPM Workspace

```yaml
packages:
  - "packages/*"
  - "examples/*"
```

## 🎯 Decision Framework

When making architectural decisions, prioritize in this order:

1. **Correctness** - Must work correctly
2. **Type Safety** - Fully typed, no any
3. **Simplicity** - Easiest to understand wins
4. **Performance** - Fast enough for production
5. **Size** - Smaller is better

## 🚨 Critical Rules

### MUST Follow
- ✅ ESM modules only
- ✅ TypeScript strict mode
- ✅ Zero runtime dependencies in core
- ✅ Cross-runtime compatibility
- ✅ Comprehensive tests
- ✅ Property access with bracket notation when needed

### MUST NOT Do
- 🚫 CommonJS modules
- 🚫 Any type (except when absolutely necessary)
- 🚫 External dependencies in core
- 🚫 Runtime-specific code
- 🚫 Mutable state
- 🚫 Missing tests
- 🚫 Synchronous I/O

## 🛠 Tooling Commands

```bash
# Development
pnpm dev          # Start development mode
pnpm build        # Build all packages
pnpm test         # Run tests
pnpm lint         # Run ESLint
pnpm format       # Format with Prettier
pnpm typecheck    # Check TypeScript types

# Package Management
pnpm add -D [package] -w              # Add dev dependency to root
pnpm add [package] --filter @kysera/core  # Add to specific package
pnpm update --interactive              # Interactive update
pnpm audit                            # Security audit

# Turborepo
turbo build --filter=@kysera/core    # Build specific package
turbo build --dry-run                 # Preview what will be built
turbo daemon clean                    # Clean turbo cache
```

## 📊 Quality Metrics

### Current Status
- TypeScript: Strict mode enabled ✅
- ESLint: Configured with strict rules ✅
- Build: All packages building ✅
- Module System: ESM-only ⚠️ (needs update)
- Test Coverage: 0% ❌ (tests pending)
- Cross-runtime: Not tested yet ❌

### Target Metrics
- Test Coverage: >95%
- Mutation Score: >95%
- Bundle Size: Within limits
- Zero TypeScript errors
- Zero ESLint errors
- Works in Node, Bun, Deno

## 🌟 Philosophy

> "Perfection is achieved not when there is nothing more to add,
> but when there is nothing left to take away."
> — Antoine de Saint-Exupéry

Every line of code should embody this philosophy. We're building a framework that will power critical systems - there is no room for compromise on quality, type safety, or reliability.

---

**Last Updated**: 2025-09-30
**Version**: 0.1.0
**Status**: Active Development