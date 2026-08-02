---
sidebar_position: 7
title: doctor
description: Diagnose environment, configuration, driver and database health
---

# kysera doctor

One-shot environment sanity check. Reach for `kysera doctor` when something feels off — the CLI can't find your config, a driver won't load, migrations behave unexpectedly — or as the first step in a CI pipeline to fail fast before running migrations. It probes the runtime, configuration discovery and validation, the database driver, database connectivity, migration state, and installed `@kysera/*` package versions, then prints a pass/warn/fail report.

```bash
kysera doctor
```

## Options

| Option                | Description                |
| --------------------- | -------------------------- |
| `--json`              | Output as JSON             |
| `-c, --config <path>` | Path to configuration file |

## What Gets Checked

Checks are namespaced `<section>.<name>` and grouped into five sections:

| Section    | Checks                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime`  | Node version against the CLI's `engines` constraint (`>=22.18.0`); platform/architecture (reports Bun when running under Bun)                     |
| `config`   | Which config file won discovery (`--config` > `KYSERA_CONFIG` > upward search); visible environment inputs (`DATABASE_URL`, `.env`); validation   |
| `drivers`  | Whether the driver for the configured dialect (`pg`, `mysql2`, or `better-sqlite3`) is importable, and which version resolves                     |
| `database` | Connectivity with latency (`SELECT 1`); migration state (tracking table present, executed vs pending counts)                                      |
| `versions` | The CLI's own version plus every `@kysera/*` package found in `node_modules`, with a warning when versions drift from the CLI's                    |

Every probe reports checks instead of aborting: a broken environment is the expected input here, so a failed probe becomes a `fail` check and the remaining sections still run. Checks that depend on a missing prerequisite (no database configured, database unreachable) are reported as skipped warnings rather than failures.

## Exit Code

`kysera doctor` exits `0` when no check fails — warnings are allowed — and `1` otherwise. That makes it directly usable as a CI gate.

## Example

```bash
$ kysera doctor

Kysera Doctor

Runtime
  [OK] node: v24.13.0 (satisfies >=22.18.0)
  [OK] platform: darwin arm64 (node v24.13.0)

Configuration
  [OK] discovery: /work/my-app/kysera.config.ts
  [OK] env: DATABASE_URL not set; .env present; --config not given
  [OK] validation: valid (dialect: postgres)

Drivers
  [OK] pg: v8.22.0 (dialect: postgres)

Database
  [OK] connect: connected in 4ms (dialect: postgres)
  [WARN] migrations: 12 executed, 2 pending (directory: migrations) - run 'kysera migrate up'

Versions
  [OK] cli: @kysera/cli v0.9.0
  [OK] packages: 4 package(s) at v0.9.0: core@0.9.0, dal@0.9.0, executor@0.9.0, repository@0.9.0

Summary: 9 pass, 1 warn, 0 fail
```

## JSON Output

With `--json` the report is a single object — `checks` is an array of `{ id, status, detail }` and `summary` aggregates the counts, with `summary.status` being the worst individual status:

```bash
kysera doctor --json
```

```json
{
  "checks": [
    { "id": "runtime.node", "status": "pass", "detail": "v24.13.0 (satisfies >=22.18.0)" },
    { "id": "config.validation", "status": "pass", "detail": "valid (dialect: postgres)" },
    { "id": "database.connect", "status": "pass", "detail": "connected in 4ms (dialect: postgres)" },
    { "id": "database.migrations", "status": "warn", "detail": "12 executed, 2 pending (directory: migrations) - run 'kysera migrate up'" }
  ],
  "summary": { "pass": 9, "warn": 1, "fail": 0, "status": "warn" }
}
```

## CI Recipes

```bash
# Gate a pipeline on the environment being sane (exit 1 on any failure)
kysera doctor

# Fail the build even on warnings
kysera doctor --json | jq -e '.summary.status == "pass"'

# Extract just the failing checks for a build annotation
kysera doctor --json | jq '[.checks[] | select(.status == "fail")]'
```

:::tip Warnings are informational
Pending migrations, a missing config file (defaults are used), or `@kysera/*` version drift all surface as `warn`, not `fail` — the exit code stays `0`. Pin the stricter `jq -e '.summary.status == "pass"'` form when you want warnings to break the build too.
:::

## See Also

- [health](/docs/cli/health) — recurring health checks and metrics once the environment is known-good
- [migrate](/docs/cli/migrate) — act on the pending-migrations warning
- [Configuration](/docs/cli/configuration) — how config discovery and precedence work
