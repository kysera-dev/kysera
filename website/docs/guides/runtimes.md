---
sidebar_position: 6
title: Node.js, Bun, and Deno
description: Running Kysera across JavaScript runtimes — what is guaranteed, what is tested, and per-runtime setup
---

# Node.js, Bun, and Deno

Kysera targets all three server-side JavaScript runtimes. This guide explains what "cross-runtime" concretely means for these packages, which parts are runtime-specific (drivers, mostly), and how to bootstrap each runtime.

## What Cross-Runtime Means Here

- **ESM-only.** Every package ships `"type": "module"` with ESM exports exclusively — no CommonJS builds.
- **Platform-neutral builds.** Packages are bundled as plain modern ESM with no Node-specific shims or CJS interop baked in; anything runtime-specific (Node built-ins, database drivers) stays external to the bundle.
- **No third-party runtime dependencies.** Runtime `dependencies` are limited to other `@kysera/*` workspace packages (`@kysera/executor` has none at all); `kysely` is a peer dependency, and `zod` an optional peer where validation is offered.
- **Node built-ins are used sparingly and with the `node:` prefix**, which Node, Bun, and Deno all resolve:
  - `node:crypto` — only inside the `@kysera/core/cursor-crypto` subpath (signed cursor pagination), loaded lazily; if you never use signed cursors, it is never imported.
  - `node:async_hooks` — `AsyncLocalStorage` in `@kysera/rls` for context propagation. Supported by all three runtimes.
- **Runtime detection instead of runtime assumptions** where the environment genuinely differs: `getEnv` (below) for environment variables, and `@kysera/infra`'s shutdown helpers, which probe for process signal support and fall back to a warning plus manual shutdown (`createShutdownController`) when it is absent.

Version baselines from the packages' `engines` field: **Node.js >= 22**, **Bun >= 1.0**. Deno has no `engines` equivalent; recent Deno versions with `npm:` specifier support are assumed.

### Tested vs. Expected to Work

Being precise about guarantees:

- The full test suite (unit + multi-database integration against PostgreSQL, MySQL, and SQLite) runs under **Node.js**; CI uses Node 22.x and 24.x.
- **Bun** and **Deno** are verified by dedicated smoke tests in the repository (`test-all-bun.js`, `test-all-deno.ts`) that import all 13 packages under each runtime and exercise the runtime-sensitive features (`node:crypto` cursor signing, `node:async_hooks` RLS context):

  ```bash
  bun test-all-bun.js
  deno run --allow-read --allow-env test-all-deno.ts
  ```

- Database **drivers** are exercised by the automated suite on Node only. On Bun and Deno the drivers listed below are expected to work per their own runtime support, but are not part of this repository's automated matrix.

## Environment Variables: `getEnv`

`getEnv` from `@kysera/core` reads environment variables on any runtime — `process.env` on Node.js and Bun, `Deno.env.get()` on Deno — and returns `undefined` (rather than throwing) in browsers or when Deno runs without `--allow-env`:

```typescript
import { getEnv } from '@kysera/core'

const databaseUrl = getEnv('DATABASE_URL')
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set')
}
```

## Drivers Are the Runtime-Specific Part

Kysera itself is dialect-agnostic; runtime constraints come from Kysely's dialects and their underlying drivers. Kysely 0.29 ships `PostgresDialect` (`pg`), `MysqlDialect` (`mysql2`), `SqliteDialect` (`better-sqlite3`-compatible handles), and `MssqlDialect` (`tedious` + `tarn`).

| Dialect / driver                  | Node.js ≥ 22        | Bun ≥ 1.0                       | Deno                                  |
| --------------------------------- | ------------------- | ------------------------------- | ------------------------------------- |
| `PostgresDialect` + `pg`          | Tested in this repo | Expected to work                | Expected to work via `npm:pg`         |
| `SqliteDialect` + `better-sqlite3`| Tested in this repo | Expected to work (Node-API)     | Not recommended (native addon)        |
| `MysqlDialect` + `mysql2`         | Tested in this repo | Expected to work                | Not covered here                      |
| `MssqlDialect` + `tedious`        | Supported           | Not covered here                | Not covered here                      |

:::tip

On Bun, prefer `better-sqlite3` for SQLite — it is the driver this repository's own test suites use, and Bun loads it as a regular Node-API module. Bun's built-in `bun:sqlite` requires a third-party Kysely dialect that this project neither uses nor tests; if you adopt one, validate it against your workload yourself.

:::

On Deno, avoid native addons: pick a network database (PostgreSQL via `npm:pg` is the straightforward path) instead of SQLite.

## Per-Runtime Bootstrap

The same Kysera code runs everywhere; only the driver import and connection setup differ.

### Node.js (PostgreSQL)

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { createExecutor } from '@kysera/executor'
import { getEnv } from '@kysera/core'

interface Database {
  users: { id: number; email: string; name: string }
}

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: getEnv('DATABASE_URL') })
  })
})

const executor = await createExecutor(db, [])
const users = await executor.selectFrom('users').selectAll().execute()
```

### Bun (SQLite via better-sqlite3)

```typescript
import { Kysely, SqliteDialect } from 'kysely'
import SQLite from 'better-sqlite3'
import { createExecutor } from '@kysera/executor'

interface Database {
  users: { id: number; email: string; name: string }
}

const db = new Kysely<Database>({
  dialect: new SqliteDialect({ database: new SQLite('app.db') })
})

const executor = await createExecutor(db, [])
const users = await executor.selectFrom('users').selectAll().execute()
```

Run with `bun run app.ts` — no build step needed; Bun executes TypeScript directly.

### Deno (PostgreSQL via npm: specifiers)

```typescript
// app.ts — run with: deno run --allow-env --allow-net app.ts
import { Kysely, PostgresDialect } from 'npm:kysely@^0.29.4'
import pg from 'npm:pg@^8'
import { createExecutor } from 'npm:@kysera/executor@^0.9.0'
import { getEnv } from 'npm:@kysera/core@^0.9.0'

interface Database {
  users: { id: number; email: string; name: string }
}

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: getEnv('DATABASE_URL') })
  })
})

const executor = await createExecutor(db, [])
const users = await executor.selectFrom('users').selectAll().execute()
```

For larger projects, move the `npm:` specifiers into the `imports` map of `deno.json` so source files use bare `kysely` / `@kysera/*` imports and stay portable across runtimes.

Two Deno notes:

- `getEnv` needs `--allow-env`; without it, it returns `undefined` instead of throwing.
- Deno requires the `node:` prefix on built-in imports. Kysera's published builds already guarantee this — a post-build step restores the prefixes that the bundler strips — so `@kysera/core/cursor-crypto` and `@kysera/rls` load cleanly under Deno.

## Related

- [Getting Started](/docs/getting-started)
- [Multi-Database Configuration](/docs/guides/multi-database) — per-dialect connection setup in depth
- [Production Operations](/docs/guides/production) — health checks, resilience, shutdown
- [Troubleshooting](/docs/guides/troubleshooting)
