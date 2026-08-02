<p align="center">
  <img src="website/static/img/logo.png" alt="Kysera" width="120" />
</p>

<h1 align="center">Kysera</h1>

<p align="center">
  <strong>The type-safe data layer for <a href="https://kysely.dev">Kysely</a>.</strong><br/>
  Repositories, functional queries, and a security-hardened plugin core —<br/>
  built for server infrastructures that live under heavy data load. Not an ORM, by design.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kysera/core"><img src="https://img.shields.io/npm/v/@kysera/core?color=0d9488&label=npm" alt="npm version"></a>
  <a href="https://github.com/kysera-dev/kysera/blob/main/LICENSE"><img src="https://img.shields.io/github/license/kysera-dev/kysera?color=0d9488" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-0d9488" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/runtime-Node%2022%2B%20%7C%20Bun%20%7C%20Deno-0d9488" alt="Cross-runtime">
  <img src="https://img.shields.io/badge/3rd--party%20runtime%20deps-0-0d9488" alt="Zero third-party runtime dependencies">
</p>

<p align="center">
  <a href="https://kysera.dev">Documentation</a> &bull;
  <a href="https://kysera.dev/docs/getting-started">Getting Started</a> &bull;
  <a href="https://kysera.dev/docs/api/overview">API Reference</a> &bull;
  <a href="https://github.com/kysera-dev/kysera/tree/main/examples">Examples</a>
</p>

---

## What Kysera is

Kysely gives you a superb type-safe query builder — and stops there. Everything a serious
backend needs *around* the queries is left to you: consistent data-access patterns, soft
deletion that mutation paths can't forget, row-level security that actually reaches the SQL,
audit trails that commit atomically with the write, migrations that two instances can't run
at once, health checks, retries, test isolation.

Teams rebuild that layer by hand on every project — and every hand-built layer drifts.
Kysera is that layer, done once, done strictly:

- **A unified execution core** (`@kysera/executor`): plugins intercept queries at one seam,
  so the same soft-delete filter, RLS policy, and audit hook apply to the Repository pattern,
  the functional DAL, **and everything running inside transactions** — no pattern-specific
  re-implementation, no forgotten path.
- **Security enforced in SQL, not in convention.** RLS policies rewrite `SELECT`, `UPDATE`,
  and `DELETE`; soft delete narrows mutations to live rows; opt-outs are scoped to a single
  statement (`withPluginMetadata`) — there is no global bypass switch to forget about.
- **Operational rigor as a first-class citizen**: advisory-locked, checksum-verified
  migrations; a CLI with environment diagnostics and live-DB type generation; health,
  retry, circuit-breaker, and graceful-shutdown primitives.

And it stays honest about what it is **not**: there is no schema DSL, no lazy loading, no
identity map, no hidden query generation. Every query is a Kysely query you can read, and
the raw instance is always one call away.

## Why not just Kysely? Why not an ORM?

| Capability | Raw Kysely | Typical ORM | Kysera |
|---|---|---|---|
| SQL visible and hand-tunable | ✅ | ⚠️ generated | ✅ always |
| Cross-cutting filters (soft delete, tenancy) on **every** path incl. mutations & transactions | hand-built | partial, pattern-locked | ✅ one plugin core |
| Row-level security enforced in `UPDATE`/`DELETE` SQL | hand-built | rare | ✅ built-in |
| Audit log atomic with the mutation | hand-built | plugin-dependent | ✅ built-in |
| Concurrent-safe migrations (advisory locks, checksums) | hand-built | varies | ✅ built-in |
| Escape hatch to the bare query builder | n/a | often painful | ✅ `getRawDb()` / `sql` |
| Third-party runtime dependencies | 0 | many | **0** |
| Schema/type source of truth | your interfaces | ORM DSL | your interfaces (+ live-DB codegen) |

The honest version of the pitch: **on a simple CRUD service, raw Kysely or an ORM is
enough.** Kysera earns its place when the data layer is load-bearing — multi-tenant
isolation, financial writes that must audit atomically, fleets of services sharing one
migration history, compliance-grade soft deletion. That is the level the whole project is
built and tested to.

## Architecture

```
Layer 5  Plugins          @kysera/soft-delete · audit · timestamps · rls
Layer 4  Data access      @kysera/repository (structured CRUD) | @kysera/dal (functional)
Layer 3  Execution        @kysera/executor — one interception seam for everything above
Layer 2  Operations       @kysera/migrations · infra · debug · testing · dialects · cli
Layer 1  Core             @kysera/core — errors, pagination, types, logging
Layer 0  Kysely           untouched underneath — always reachable
```

Plugins declare priority tiers and run in a fixed, inspectable order:
`CONTEXT (1100) → SECURITY (1000) → FILTER (500) → TRANSFORM (100) → AUDIT (50)`.
Registration order never matters; execution order is always the same.

## Packages

Thirteen focused packages plus a CLI. Zero third-party runtime dependencies anywhere —
verified across every `package.json`; `kysely` is a peer, `zod` an optional peer.

| Package | Purpose | Size (dist) |
|---|---|---|
| [`@kysera/core`](https://kysera.dev/docs/api/core) | Errors, pagination, types, logging, dialect detection | ~8 KB |
| [`@kysera/executor`](https://kysera.dev/docs/api/executor) | Unified execution layer — plugin interception | ~9 KB |
| [`@kysera/repository`](https://kysera.dev/docs/api/repository) | Repository pattern, validation adapters, upserts, atomic transitions | ~22 KB |
| [`@kysera/dal`](https://kysera.dev/docs/api/dal) | Functional data access: composable queries, transactions with savepoints | ~4 KB |
| [`@kysera/soft-delete`](https://kysera.dev/docs/plugins/soft-delete) | Read filtering + mutation narrowing to live rows | ~4 KB |
| [`@kysera/timestamps`](https://kysera.dev/docs/plugins/timestamps) | `created_at` / `updated_at` on repository writes, bulk included | ~5 KB |
| [`@kysera/audit`](https://kysera.dev/docs/plugins/audit) | Row-level history, atomic with the mutation, restore included | ~12 KB |
| [`@kysera/rls`](https://kysera.dev/docs/plugins/rls) | Declarative row-level security + native PostgreSQL RLS generation | ~53 KB |
| [`@kysera/migrations`](https://kysera.dev/docs/api/migrations) | Advisory-locked, checksum-verified migration runner | ~14 KB |
| [`@kysera/infra`](https://kysera.dev/docs/api/infra) | Health checks, retry, circuit breaker, graceful shutdown, pool metrics | ~11 KB |
| [`@kysera/debug`](https://kysera.dev/docs/api/debug) | Query logging, slow-query alerts, profiler | ~4 KB |
| [`@kysera/testing`](https://kysera.dev/docs/api/testing) | Transaction-rollback isolation, factories, plugin test harness | ~7 KB |
| [`@kysera/dialects`](https://kysera.dev/docs/api/dialects) | PostgreSQL / MySQL / SQLite / MSSQL adapters, unified error matching | ~22 KB |
| [`@kysera/cli`](https://kysera.dev/docs/cli/overview) | `doctor`, live-DB codegen, migrations, RLS DDL, scaffolding | — |

## Quick start

```bash
npm install kysely zod
npm install @kysera/executor @kysera/repository @kysera/soft-delete
```

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { createExecutor } from '@kysera/executor'
import { createORM, createRepositoryFactory, zodAdapter } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { z } from 'zod'

const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })

// One executor, one plugin set — every pattern below inherits it
const executor = await createExecutor(db, [softDeletePlugin()])
const orm = await createORM(executor, [])

const users = orm.createRepository(exec =>
  createRepositoryFactory(exec).create({
    tableName: 'users',
    mapRow: row => row,
    schemas: {
      create: zodAdapter(z.object({ email: z.string().email(), name: z.string() }))
    },
  })
)

const user = await users.create({ email: 'ada@example.com', name: 'Ada' })
await users.softDelete(user.id)
await users.findAll() // soft-deleted rows are filtered out — in SQL
```

Or scaffold a project and verify the whole environment in one shot:

```bash
npx @kysera/cli init my-app
npx @kysera/cli doctor
```

## Two patterns, one core

**Repository** for structured CRUD with validation; **functional DAL** for composable,
type-inferred reads; both against the same executor, plugins, and transaction — mix them
freely (CQRS-lite):

```typescript
await withTransaction(executor, async ctx => {
  const order = await orders.create(input)          // Repository write
  const stats = await getDashboardStats(ctx, order) // DAL read, same transaction
})                                                  // nested calls become savepoints
```

→ [Repository vs DAL, and when to use which](https://kysera.dev/docs/guides/dal-vs-repository)

## Security model (v0.9)

- **RLS**: policies (`allow` / `deny` / `filter` / `validate`) compile into the SQL of
  `SELECT`, `UPDATE`, and `DELETE` — a mutation cannot skip the filter a read would get.
  Context is ambient (AsyncLocalStorage), `requireContext` defaults to **true**, and
  `@kysera/rls/native` generates real PostgreSQL `CREATE POLICY` DDL from the same schema
  for defense in depth.
- **Soft delete** narrows `UPDATE`/`DELETE` to live rows — no accidental resurrection or
  double-delete of dead data.
- **Scoped opt-outs**: `withPluginMetadata(executor, { includeDeleted: true })` affects one
  statement. Security plugins deliberately ignore the metadata channel — bypassing RLS
  requires an explicit system context, roles, or table exclusion, never a flag on a query.

→ [Multi-tenancy walkthrough](https://kysera.dev/docs/guides/multi-tenancy)

## Operations

- **Migrations**: DB advisory locks (PostgreSQL `pg_try_advisory_lock`, MySQL `GET_LOCK`,
  MSSQL `sp_getapplock`) serialize concurrent runners; sha256 checksums detect drift
  (`migrate verify`); dry-run plans and `migrate baseline` for adopting existing schemas;
  CI-stable `--json` shapes.
- **CLI**: `kysera doctor` (runtime, config, drivers, connectivity, migration state,
  version drift — one shot); `kysera generate database` (live-DB → typed `Database`
  interface with `Generated<>` columns); shell completions for bash/zsh/fish.
- **Runtime infra**: health checks with latency tiers, `HealthMonitor` (`using`-compatible),
  retry with exponential backoff and transient-error detection, `withTransactionRetry`
  (re-runs whole transactions on serialization failures and deadlocks — proven against
  real PostgreSQL 40001/40P01), circuit breaker, graceful shutdown with pinned drain
  semantics, pool metrics that admit when they can't measure (`detected` flag).
- **Debugging**: query logging with parameter redaction, slow-query alerts, percentile
  profiling — wraps any Kysely instance.

→ [Production operations guide](https://kysera.dev/docs/guides/production)

## Database & runtime support

| | PostgreSQL | MySQL | SQLite | MSSQL |
|---|---|---|---|---|
| Queries, repositories, DAL, plugins | ✅ | ✅ | ✅ | ✅ |
| Dialect-aware pagination | ✅ | ✅ | ✅ | ✅ (`OFFSET…FETCH` / `TOP`) |
| Error parsing (`parseDatabaseError`) | ✅ | ✅ | ✅ | ✅ |
| Migration advisory locks | ✅ | ✅ | single-writer | ✅ (`sp_getapplock`) |
| Native RLS DDL generation | ✅ | — | — | — |
| CLI target | ✅ | ✅ | ✅ | ⚠️ not yet |

**Runtimes**: the full test suite runs on Node.js ≥ 22; Bun ≥ 1.0 and Deno ≥ 1.40 are
exercised by cross-runtime smoke tests that import every package. ESM-only.

**Testing discipline**: CI runs lint, strict typecheck, the full suite on Node 22/24,
multi-database suites against live PostgreSQL and MySQL services (MSSQL experimental),
Bun/Deno smoke, the documentation build with hard broken-link gates, and a typecheck of
every code snippet in the docs (835 blocks compile against the real package types).
Per-package coverage floors sit at 95% lines/functions on the standard profile.
Concurrency claims are proven by tests, not asserted: two migration runners racing on a
live database apply exactly once; twenty parallel status transitions produce exactly one
winner.

**Performance discipline**: a benchmark suite (`pnpm bench`) tracks the overhead every
release. Current numbers (in-memory SQLite, so they measure Kysera, not the network): the
0-plugin executor costs noise-to-13% on the execute path; a full soft-delete + timestamps
+ RLS stack costs ~15–20% — and the plugins share one row fetch per operation, so a
guarded `update` issues a single pre-image SELECT instead of one per plugin.

## When *not* to use Kysera

Honesty is part of the contract:

- A small CRUD app with one developer — raw Kysely, or an ORM you already know, is simpler.
- You want schema-first modelling with generated entities and relations — that's an ORM's
  job; Kysera deliberately keeps your interfaces as the source of truth.
- Your primary database is MSSQL and you need the CLI today — the data layer and locked
  migrations are covered, but CLI targeting is still pending (see the matrix above).

## Development

```bash
pnpm install        # install workspace
pnpm build          # build all packages
pnpm test           # run all tests
pnpm test:multi-db  # against live PostgreSQL/MySQL (docker compose provided)
pnpm typecheck      # strict TypeScript across the monorepo
pnpm lint           # eslint, zero-warning policy
```

The repository is a pnpm + Turborepo monorepo: packages in `packages/*`, the CLI in
`apps/cli`, runnable examples in `examples/*`, documentation in `website/`.

## License

[MIT](LICENSE) © LuxQuant
