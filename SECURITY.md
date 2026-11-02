# Security Policy

## Supported Versions

Security fixes land on the current stable release line. Upgrade to the latest
stable release when checking whether an issue still reproduces.

## Checking dependencies

Run `pnpm install --frozen-lockfile` followed by `pnpm run audit:deps` at the
workspace root. This checks the locked library, CLI, example, build and
documentation dependencies. Use `pnpm audit --prod` separately to investigate
exposure in production; a finding in the documentation toolchain does not by
itself mean the package shipped to an application is affected.

CI and normal releases fail on any reported advisory, including low severity.
Resolve it by removing the dependency or upgrading and testing its consumers.
Scoped overrides and patches live in `pnpm-workspace.yaml`; revisit them when
upstream updates. A clean audit only covers advisories known to the registry.
pnpm 12 enforces its minimum age for newly published releases, including transitive dependencies.
The build uses the TypeScript 6 compiler API for TypeDoc, tsup and typed linting.

## Reporting a Vulnerability

Please report vulnerabilities **privately** through
[GitHub Security Advisories](https://github.com/kysera-dev/kysera/security/advisories/new)
for this repository. Do not open public issues, discussions, or pull
requests for suspected vulnerabilities.

What to include:

- Affected package(s) (`@kysera/*`) and version(s)
- A minimal reproduction (schema + query/policy definitions are usually enough)
- Impact assessment: what an attacker can read, write, or bypass

You can expect an acknowledgement within 7 days. We follow **coordinated
disclosure with a 90-day window**: we ask that you keep the report private
for up to 90 days from acknowledgement (or until a fix is released,
whichever comes first). We credit reporters in the advisory unless you ask
otherwise.

## Scope

Especially welcome — these are the project's security-critical surfaces:

- **RLS bypasses** (`@kysera/rls`): any query shape whose rows escape a
  tenant filter, a `deny`/`allow` policy, or the native PostgreSQL RLS
  generators — including bulk mutations, joins, subqueries, and CTEs.
- **Soft-delete bypasses** (`@kysera/soft-delete`): reads that return
  soft-deleted rows without an explicit `withDeleted`-style opt-in.
- **SQL injection** through any Kysera-provided API (identifiers, operators,
  pagination cursors, migration names).
- **Cursor tampering** (`@kysera/core` signed pagination cursors).
- **Audit integrity** (`@kysera/audit`): writes that dodge audit capture or
  forge audit entries.

Out of scope: vulnerabilities in Kysely itself or in database drivers
(report upstream), denial of service requiring database superuser access,
and issues in example apps under `examples/`.
