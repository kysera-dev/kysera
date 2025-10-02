# Changesets

This repository uses [changesets](https://github.com/changesets/changesets) to manage versioning and changelogs.

## How it works

All packages in this monorepo are versioned together. When you make a change that should be released, you need to add a changeset.

## Adding a changeset

Run the following command and follow the prompts:

```bash
pnpm changeset
```

This will ask you:
1. Which packages are affected by your changes
2. What type of change it is (major, minor, or patch)
3. A summary of the changes for the changelog

The changeset will be created in the `.changeset` directory.

## Version types

- **Major**: Breaking changes (0.x.0 -> 1.0.0)
- **Minor**: New features (0.1.0 -> 0.2.0)
- **Patch**: Bug fixes (0.1.0 -> 0.1.1)

## Releasing

The release process is automated through GitHub Actions:

1. When changesets are merged to `main`, a PR is automatically created to bump versions
2. Merging that PR will trigger the release to npm and create GitHub releases
3. All packages are released with the same version number

## Manual release

For manual releases, run:

```bash
pnpm release
```

This will:
1. Prompt for the new version
2. Update all package versions
3. Generate changelog
4. Build and test
5. Publish to npm
6. Create git tag
7. Push to GitHub

## Fixed versioning

All `@kysera/*` packages are released together with the same version number. This is configured in `.changeset/config.json` under the `fixed` field.

This approach ensures:
- Consistent versioning across the ecosystem
- Simpler dependency management
- Clear compatibility between packages
- Easier troubleshooting

## Tips

- Always add a changeset for user-facing changes
- Use clear, descriptive summaries that will appear in the changelog
- Group related changes in a single changeset when possible
- For internal changes that don't affect users, you can skip the changeset