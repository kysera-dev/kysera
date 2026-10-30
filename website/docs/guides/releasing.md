---
title: Releasing Kysera
description: Reproducible npm publication and safe GitHub release recovery
---

Run releases from the repository root, with the package manager declared in
`package.json`, npm publication access and a working `origin` Git credential.
GitHub Release creation additionally requires an authenticated `gh` CLI.

```bash
# Read-only plan: no version writes, build, tests, commit, push or publish.
bun run ./scripts/release.ts --version 0.10.2 --dry-run

# Interactive release, including the GitHub Release page.
bun run ./scripts/release.ts --version 0.10.2 --github-release
```

The version above is an example; choose the next unreleased canonical semver.
With no `--version`, the script prompts. `--yes` requires an explicit version and
accepts release/push prompts. `pnpm release:ci --version <version>` uses that mode;
it skips tests only because the CI job is expected to have passed them already.

## Release boundaries

1. Require a clean working tree, validate the version, check dependency ordering
   and inspect only the selected remote tag. A conflicting release tag stops the
   run before publication. `--force` permits a non-primary branch or older version;
   it never permits unrelated uncommitted changes.
2. Update versions and release notes; preserve all `workspace:` dependency forms,
   including optional dependencies. Build and test unless explicitly skipped.
   Refresh the lockfile without running install scripts.
3. Commit only the release manifests, lockfile and changelog. An existing tag must
   point at the exact current commit; a resume must not publish changed source
   under an old version.
4. Pack exact archives into `.release-artifacts/<version>/<commit>/`, without
   rerunning lifecycle scripts after validation. Validate exported entry points
   and reject remaining local dependency references. Verify all existing npm
   archives by SHA-512 before publishing any package.
5. Atomically push the current branch and **that one release tag**. Historical
   tags and other branches are excluded, including when `push.followTags` is set.
   A failed push stops before npm publication. Declining the push leaves a local
   prepared release; it does not publish packages.
6. Publish the saved archives in dependency order and verify their npm integrity
   afterwards. An existing version is skipped only when its archive matches. Only a registry `E404` means absent; authentication, network and
   server failures abort rather than being treated as permission to publish.
   Prereleases use npm's `next` tag. Provenance is explicit (`--provenance`) or
   automatic when GitHub Actions OIDC credentials are available.
7. With `--github-release`, create the missing GitHub Release using notes from
   the immutable tagged changelog. An existing release is preserved.

`--skip-build`, `--skip-tests` and `--skip-publish` are explicit operator choices,
not evidence that those stages passed. Git/changelog read errors stop the run;
only a genuinely absent changelog is treated as empty. One writer holds
`.release-artifacts/running`; after an abrupt termination, inspect its `owner.json`
and confirm that process has stopped before removing the lock. Publication across multiple npm packages
is not atomic: a partial run is resumed, never rolled back by deleting versions.

## Recover a partial release

Keep `.release-artifacts` until publication is complete, and retain it with CI
artifacts if the checkout is ephemeral. Cache records use relative archive paths,
so the cache can be restored under a different checkout directory at the same
release commit. A resume verifies and reuses the same
archives rather than repacking a potentially different build. A missing or
modified saved archive is a failure. A registry checksum mismatch never permits
overwriting npm: recover the original archive or release a new version. Even a
change to JSON key order changes the archive checksum; the script does not infer
that different archives are equivalent.

For an interrupted npm publication, use a clean checkout of the **release
commit** on its original branch and rerun the same `--version`. If the branch has
advanced, use an isolated checkout at that commit; do not reset a shared working
branch. A failed push must be reconciled before the remaining npm packages can
be published. Never move or force-push an already published tag.

If npm and the tag already succeeded and only the GitHub page is missing:

```bash
bun run ./scripts/release.ts --version 0.10.1 --github-only --dry-run
bun run ./scripts/release.ts --version 0.10.1 --github-only
```

This mode can run from a later tools-fix commit. It verifies that local and remote
release tags match, reads notes from the tag and creates only the missing GitHub
Release. It never rebuilds packages, changes versions, republishes npm, pushes
branches or replaces old tags. Cancellation leaves external state unchanged.

A historical `git push --tags` failure can have partially succeeded: inspect the
selected tag and npm versions before retrying. The release script no longer sends
all local tags. Conflicting old tags do not prevent a new release.

## Verify the tooling

```bash
pnpm test:release
pnpm exec tsc -p scripts/tsconfig.json --noEmit
pnpm exec eslint scripts/release.ts scripts/release-safety.ts scripts/release.test.ts scripts/release-artifacts.ts scripts/release-artifacts.test.ts --max-warnings 0
```

The regression suite uses disposable local Git repositories to check tag
conflicts, atomic push, repeatability and protection of unrelated refs. It never
publishes test packages or GitHub releases.
