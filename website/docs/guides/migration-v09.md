---
sidebar_position: 8
title: Migration Guide v0.8 → v0.9
description: Upgrading from Kysera v0.8 to v0.9 (kysely 0.29)
---

# Migration Guide: v0.8 → v0.9

v0.9 moves the toolkit to **kysely 0.29**, hardens the query-operator layer,
and closes several silent-failure holes found during a full-codebase audit.
Most applications upgrade without code changes — the breaking changes below
are corrections of behavior that was already wrong or dangerous.

## Requirements

| Requirement | v0.8 | v0.9 |
| ----------- | ---- | ---- |
| kysely (peer) | >=0.28.14 | **>=0.29.0** |
| Node.js | >=20 | **>=22** |
| TypeScript | ^6.0.2 | ^6.0.3 |

Kysely 0.29 highlights relevant to Kysera users: `$pickTables`/`$omitTables`
compile-time helpers, controlled transactions everywhere, query cancellation
via `AbortSignal`, and migration exports moved to `'kysely/migration'`
(Kysera ships its own runner — no import changes needed for `@kysera/migrations`).

## Breaking Behavior Corrections

### 1. Malformed operator values now throw (`InvalidOperatorValueError`)

Previously a valid operator with a malformed value silently **dropped the
filter** and returned the whole table:

```typescript
// v0.8: returned ALL rows (filter silently dropped!)
// v0.9: throws InvalidOperatorValueError
await repo.find({ where: { age: { $between: [30] } } })      // needs [min, max]
await repo.find({ where: { age: { $isNull: 'yes' } } })      // needs boolean
await repo.find({ where: { name: { $contains: null } } })    // needs string
await repo.find({ where: { age: { $in: 'oops' } } })         // needs array
```

If you relied on the old behavior, fix the operator value — it was never
filtering what you thought.

### 2. `$ne` / `$nin` now follow MongoDB NULL semantics

```typescript
// Rows where age IS NULL now MATCH $ne / $nin (as in MongoDB):
await repo.find({ where: { age: { $ne: 30 } } })
// v0.8: WHERE age <> 30            (NULL rows silently dropped)
// v0.9: WHERE (age <> 30 OR age IS NULL)

// Exclude NULLs explicitly when you need SQL semantics:
await repo.find({ where: { age: { $ne: 30, $isNotNull: true } } })
// or include null in the exclusion list:
await repo.find({ where: { age: { $nin: [30, null] } } })
```

`$in: [x, null]` now matches NULL rows too.

### 3. `$ilike` is portable

`$ilike` compiles to `LOWER(col) LIKE LOWER(pattern)` and works on every
dialect (previously it emitted PostgreSQL's `ILIKE` keyword, which crashed on
MySQL/SQLite/MSSQL). PostgreSQL users needing native `ILIKE` (trigram indexes)
should use the DAL or raw kysely.

### 4. `orderBy` and dynamic column names are validated

`paginate({ orderBy: 'name desc' })` used to be passed through and silently
mis-ordered on some dialects; it now throws. Pass the column and direction
separately: `paginate({ orderBy: 'name', orderDirection: 'desc' })`.

Column-name validation no longer depends on `NODE_ENV`: identifier-shape
checks always run (cheap), and strict whitelist checks run when you provide
`allowedColumns`. Development and production now behave identically.

### 5. `testWithIsolation` uses kysely's `setIsolationLevel`

`@kysera/testing`'s `testWithIsolation` no longer issues a raw
`SET TRANSACTION ISOLATION LEVEL` (which failed inside active MySQL
transactions and was a syntax error on SQLite). It now delegates to kysely's
dialect-aware transaction builder.

## New Capabilities

### Executor covers every derived-instance API (incl. kysely 0.29)

Plugins are no longer silently lost on:

- `$pickTables()` / `$omitTables()` / `$extendTables()` / `withTables()`
- `withPlugin()` / `withoutPlugins()`
- `transaction().setIsolationLevel(...).setAccessMode(...)` (previously only `execute` was exposed)
- `startTransaction()` controlled transactions, including savepoint-derived ones
- `connection()` callbacks
- `with(name, query)` direct-expression CTE form (new in kysely 0.29)

Native `#private` getters (`db.schema`, introspection) now work through the
proxy — `executor.schema.createTable(...)` previously threw
`Cannot read private member`.

### Aliased table references are safe

`selectFrom('users as u')` previously crashed soft-delete (invalid SQL) or —
worse — silently skipped plugin filters when a `tables:` allowlist was set.
Plugins now receive the base table name plus `context.alias` /
`context.tableExpression`, and the built-in plugins qualify their conditions
with the alias. The cross-join array form applies plugins per entry.

Custom plugin authors: qualify column conditions with
`context.alias ?? context.table`.

### Migration runner advisory lock

Concurrent deployments no longer double-run migrations: the runner takes a
PostgreSQL `pg_try_advisory_lock` / MySQL `GET_LOCK` around each run
(`advisoryLock: true` by default, `lockTimeoutMs: 60000`). See the
[Migrations guide](/docs/guides/migrations#concurrent-deployments-advisory-lock).

### `detectDialect` identifies real SQLite/MSSQL instances

Detection now keys on parameter-placeholder style (`$1` / `?` / `@1`), which
is unambiguous across kysely's compilers. Real SQLite instances were
previously reported as `postgres` (both double-quote identifiers), which fed
wrong timestamp formats to plugins on SQLite.

### MySQL adapter fixes (`@kysera/dialects`)

- `getTables` / `getTableColumns` handle MySQL 8's uppercase
  `information_schema` result keys (previously returned `undefined` entries)
- `getDatabaseSize` converts the DECIMAL/BIGINT strings drivers return into
  numbers (PostgreSQL adapter too)

## Recommended Pattern Reminder

`repo.transaction(fn)` gives the callback a raw kysely `Transaction`. Calls on
the **outer** repository inside the callback stay bound to the base executor —
they escape the transaction, and since kysely 0.29's strict single-connection
mutex they deadlock on SQLite. Always rebind:

```typescript
await repo.transaction(async trx => {
  const txRepo = repo.withTransaction(trx)
  return txRepo.bulkUpdate(updates)
})
```
