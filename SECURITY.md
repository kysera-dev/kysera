# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| >= 0.9  | :white_check_mark: |
| < 0.9   | :x:                |

Only the latest 0.9.x release line receives security fixes. Older releases
are not patched — upgrade to the current release before reporting an issue
you cannot reproduce there.

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
