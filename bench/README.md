# @kysera/bench

Micro-benchmarks that measure the overhead Kysera adds on top of raw
[Kysely](https://kysely.dev), plus a query-count audit of the stacked mutation
plugins. Results land in [`RESULTS.md`](./RESULTS.md).

## Run

```bash
pnpm build         # once — suites import the built dist of each package
pnpm bench         # from the repo root (or `pnpm --filter @kysera/bench bench`)
```

The runner regenerates `bench/RESULTS.md` and prints the same report to
stdout. Wall time is roughly 15–30 s depending on the machine.

## What is measured

| Suite | Question it answers |
| --- | --- |
| Builder-chain (compile / execute) | What does the executor proxy + plugin interception cost on a single `selectFrom().select().where()` — with 0, 1 and 3 plugins? |
| Repository hot path | What do `create` / `findById` / `update` cost through `createRepositoryFactory` on plain Kysely vs the plugin ORM? |
| Mutation round-trip query count | How many statements does **one** `update` actually send under `rls + audit + soft-delete` (non-system context)? Documents the P0.3 shared-row-fetch baseline. |
| DAL overhead | What does a `createQuery` wrapper cost vs calling Kysely directly? |
| paginate vs paginateCursor | Offset vs cursor pagination on 10 000 rows, shallow and deep. |

## Methodology / determinism

- **Backend:** in-memory SQLite (`better-sqlite3`) — a synchronous, zero-latency
  backend, deliberately the *worst case* for relative overhead: there is no I/O
  to amortize wrapper costs against. Every suite gets a fresh database; every
  variant of a suite gets its own identically-seeded database.
- **Scheduling:** [tinybench](https://github.com/tinylibs/tinybench) with fixed
  warmup iterations and fixed measured iterations (`time: 0`, hrtime-based
  timestamps), single-threaded, tasks strictly sequential. Task errors throw.
- **JIT fairness:** each bench performs a full discarded pass before the
  measured pass, so later variants do not benefit from the warmup that earlier
  variants paid for.
- **Reported stats:** average ops/sec, median (p50) and p99 latency per task,
  plus throughput relative to the suite's baseline.
- **Query counting** uses a delegating Kysely `Driver` wrapper, so it records
  everything that reaches the database — including `BEGIN`/`COMMIT` and
  raw-db escapes inside plugins — not what the builder was asked to do.

## Caveats

Numbers are machine- and run-specific; treat absolute ops/sec as noise and the
relative percentages as the signal. Differences within ±5 % of a baseline are
below the noise floor of µs-scale benchmarking. On networked databases, the
per-statement round-trip dominates everything measured here — which is exactly
why the query-*count* suite matters most for production workloads.
