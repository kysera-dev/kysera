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

Kysely gives you a superb type-safe query builder — and stops there. Everything a serious
backend needs *around* the queries (cross-cutting filters, row-level security, atomic audit
trails, concurrent-safe migrations, health and retry primitives, test isolation) gets
rebuilt by hand on every project, and every hand-built layer drifts. Kysera is that layer,
done once, done strictly:

- **One interception seam** (`@kysera/executor`): the same soft-delete filter, RLS policy,
  and audit hook apply to the Repository pattern, the functional DAL, and everything inside
  transactions — no pattern-specific re-implementation, no forgotten path.
- **Security enforced in SQL, not in convention**: RLS rewrites `SELECT`/`UPDATE`/`DELETE`,
  soft delete narrows mutations to live rows, opt-outs are scoped to a single statement.
- **Operational rigor built in**: advisory-locked, checksum-verified migrations; a CLI with
  environment diagnostics and live-DB type generation; health, retry, circuit-breaker, and
  graceful-shutdown primitives.

No schema DSL, no lazy loading, no identity map, no hidden query generation: every query is
a Kysely query you can read, and the raw instance is one call away.

## Why not just Kysely? Why not an ORM?

| Capability | Raw Kysely | Typical ORM | Kysera |
|---|---|---|---|
| SQL visible and hand-tunable | ✅ | ⚠️ generated | ✅ always |
| Cross-cutting filters on **every** path incl. mutations & transactions | hand-built | partial, pattern-locked | ✅ one plugin core |
| Row-level security enforced in `UPDATE`/`DELETE` SQL | hand-built | rare | ✅ built-in |
| Audit log atomic with the mutation | hand-built | plugin-dependent | ✅ built-in |
| Concurrent-safe migrations (advisory locks, checksums) | hand-built | varies | ✅ built-in |
| Escape hatch to the bare query builder | n/a | often painful | ✅ `getRawDb()` / `sql` |
| Third-party runtime dependencies | 0 | many | **0** |
| Schema/type source of truth | your interfaces | ORM DSL | your interfaces (+ live-DB codegen) |

On a simple CRUD service, raw Kysely or a familiar ORM is enough. Kysera earns its place
when the data layer is load-bearing: multi-tenant isolation, financial writes that must
audit atomically, fleets of services sharing one migration history.

## Architecture

```
Layer 5  Plugins          @kysera/soft-delete · audit · timestamps · rls
Layer 4  Data access      @kysera/repository (structured CRUD) | @kysera/dal (functional)
Layer 3  Execution        @kysera/executor — one interception seam for everything above
Layer 2  Operations       @kysera/migrations · infra · debug · testing · dialects · cli
Layer 1  Core             @kysera/core — errors, pagination, types, logging
Layer 0  Kysely           untouched underneath — always reachable
```

Plugins declare priority tiers and run in a fixed, inspectable order —
`CONTEXT (1100) → SECURITY (1000) → FILTER (500) → TRANSFORM (100) → AUDIT (50) → DEBUG (−100)`.
Registration order never matters.

## Packages

Thirteen packages plus a CLI. Zero third-party runtime dependencies anywhere; `kysely` is a
peer dependency, `zod` is optional everywhere except `@kysera/migrations` (required there).

| Package | Purpose | Size (dist) |
|---|---|---|
| [`@kysera/core`](https://kysera.dev/docs/api/core) | Errors, pagination, types, logging, dialect detection, shared row cache | ~10 KB |
| [`@kysera/executor`](https://kysera.dev/docs/api/executor) | Unified execution layer — plugin interception | ~9 KB |
| [`@kysera/repository`](https://kysera.dev/docs/api/repository) | Repository pattern, validation adapters, upserts, atomic transitions | ~21 KB |
| [`@kysera/dal`](https://kysera.dev/docs/api/dal) | Functional data access: composable queries, transactions with savepoints | ~4 KB |
| [`@kysera/soft-delete`](https://kysera.dev/docs/plugins/soft-delete) | Read filtering + mutation narrowing to live rows | ~4 KB |
| [`@kysera/timestamps`](https://kysera.dev/docs/plugins/timestamps) | `created_at` / `updated_at` on repository writes, bulk included | ~5 KB |
| [`@kysera/audit`](https://kysera.dev/docs/plugins/audit) | Row-level history, atomic with the mutation, restore included | ~12 KB |
| [`@kysera/rls`](https://kysera.dev/docs/plugins/rls) | Declarative row-level security + native PostgreSQL RLS generation | ~57 KB |
| [`@kysera/migrations`](https://kysera.dev/docs/api/migrations) | Advisory-locked, checksum-verified migration runner | ~14 KB |
| [`@kysera/infra`](https://kysera.dev/docs/api/infra) | Health checks, retry, transaction retry, circuit breaker, shutdown, pool metrics | ~11 KB |
| [`@kysera/debug`](https://kysera.dev/docs/api/debug) | Query logging, slow-query alerts, profiler | ~4 KB |
| [`@kysera/testing`](https://kysera.dev/docs/api/testing) | Transaction-rollback isolation, factories, DB detection, plugin test harness | ~10 KB |
| [`@kysera/dialects`](https://kysera.dev/docs/api/dialects) | PostgreSQL / MySQL / SQLite / MSSQL adapters, unified error matching | ~21 KB |
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

// One executor, one plugin set — everything below inherits it
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

**Two patterns, one core.** Repository for structured CRUD with validation, functional DAL
for composable type-inferred reads — same executor, same plugins, same transaction
(CQRS-lite; nested calls become savepoints):

```typescript
await withTransaction(executor, async ctx => {
  const order = await orders.create(input)          // Repository write
  const stats = await getDashboardStats(ctx, order) // DAL read, same transaction
})
```

→ [Repository vs DAL, and when to use which](https://kysera.dev/docs/guides/dal-vs-repository)

## Security model

- **RLS**: `allow` / `deny` / `filter` / `validate` policies compile into the SQL of
  `SELECT`, `UPDATE`, and `DELETE` — including bulk mutations, where value-based policies
  are checked per affected row (bounded by `maxBulkRowChecks`). Context is ambient
  (AsyncLocalStorage), `requireContext` defaults to **true**, policies can be gated by
  environment/feature conditions evaluated at query time, and `@kysera/rls/native`
  generates real PostgreSQL `CREATE POLICY` DDL from the same schema for defense in depth.
- **Soft delete** narrows `UPDATE`/`DELETE` to live rows — no accidental resurrection or
  double-delete of dead data.
- **Scoped opt-outs**: `withPluginMetadata(executor, { includeDeleted: true })` affects one
  statement. Security plugins deliberately ignore the metadata channel — bypassing RLS
  requires an explicit system context, roles, or table exclusion, never a flag on a query.

→ [Multi-tenancy walkthrough](https://kysera.dev/docs/guides/multi-tenancy)

## Operations

- **Migrations**: advisory locks serialize concurrent runners on PostgreSQL
  (`pg_try_advisory_lock`), MySQL (`GET_LOCK`), and MSSQL (`sp_getapplock`); sha256
  checksums detect drift (`migrate verify`); dry-run plans and `migrate baseline` adopt
  existing schemas; stable `--json` shapes for CI.
- **CLI**: `kysera doctor` checks runtime, config, drivers, connectivity, migration state,
  and version drift in one shot; `kysera generate database` turns a live database into a
  typed `Database` interface with `Generated<>` columns; shell completions for bash/zsh/fish.
- **Runtime infra**: health checks and monitoring, retry with backoff,
  `withTransactionRetry` (re-runs whole transactions on serialization failures and
  deadlocks — proven against real PostgreSQL 40001/40P01), circuit breaker, graceful
  shutdown with documented drain semantics, pool metrics with an honest `detected` flag.
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

**Runtimes**: the full suite runs on Node.js ≥ 22; Bun ≥ 1.0 and Deno ≥ 1.40 are exercised
by cross-runtime smoke tests importing every package. ESM-only.

**Verified, not asserted**: CI runs lint, strict typecheck, the suite on Node 22/24,
multi-database suites against live PostgreSQL and MySQL services (MSSQL experimental),
Bun/Deno smoke, the docs build with hard broken-link gates, and a typecheck of all 835 code
snippets in the documentation against the real package types. Coverage floors are 95%
lines/functions per package. Concurrency claims are proven by racing tests: two migration
runners apply exactly once; twenty parallel status transitions produce exactly one winner.
A benchmark suite (`pnpm bench`) tracks overhead each release — measured on in-memory
SQLite (so it measures Kysera, not the network), the 0-plugin executor costs noise-to-13%
on the execute path, a full soft-delete + timestamps + RLS stack ~15–20%, and plugins share
one row fetch per operation, so a guarded `update` issues a single pre-image SELECT.

## When *not* to use Kysera

- A small CRUD app with one developer — raw Kysely, or an ORM you already know, is simpler.
- You want schema-first modelling with generated entities and relations — that's an ORM's
  job; Kysera keeps your interfaces as the source of truth.
- Your primary database is MSSQL and you need the CLI today — the data layer and locked
  migrations are covered; CLI targeting is still pending.

## Development

```bash
pnpm install        # install workspace
pnpm build          # build all packages
pnpm test           # run all tests (live-DB suites auto-detect docker)
pnpm test:multi-db  # against live PostgreSQL/MySQL (docker compose provided)
pnpm typecheck      # strict TypeScript across the monorepo
pnpm lint           # eslint, zero-warning policy
pnpm bench          # performance suite → bench/RESULTS.md
```

pnpm + Turborepo monorepo: packages in `packages/*`, the CLI in `apps/cli`, runnable
examples in `examples/*`, documentation in `website/`.

## License

[MIT](LICENSE) © LuxQuant
