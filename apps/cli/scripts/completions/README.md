# Kysera CLI Shell Completions

This directory contains shell completion scripts for the Kysera CLI, providing tab completion for commands, subcommands, and options.

The scripts are **generated** from the actual CLI command tree (`apps/cli/src/commands`) by `generate.mjs`. Do not edit `kysera.bash`, `kysera.zsh`, or `kysera.fish` by hand — regenerate them instead:

```bash
node generate.mjs
```

Run this whenever commands, subcommands, or options change in `src/commands` or `src/cli.ts`.

## Quick Installation

### Bash

```bash
# User installation (add to ~/.bashrc or ~/.bash_profile)
source "$(pwd)/kysera.bash"

# System-wide (Linux)
sudo cp kysera.bash /etc/bash_completion.d/kysera

# System-wide (macOS with Homebrew)
sudo cp kysera.bash /usr/local/etc/bash_completion.d/kysera
```

### Zsh

```bash
# User installation
mkdir -p ~/.zsh/completions
cp kysera.zsh ~/.zsh/completions/_kysera
echo 'fpath=(~/.zsh/completions $fpath)' >> ~/.zshrc
echo 'autoload -U compinit && compinit' >> ~/.zshrc

# System-wide
sudo cp kysera.zsh /usr/local/share/zsh/site-functions/_kysera
```

### Fish

```bash
# User installation (recommended)
cp kysera.fish ~/.config/fish/completions/

# System-wide
sudo cp kysera.fish /usr/share/fish/vendor_completions.d/
```

## What Gets Completed

### Main Commands

- `init` - Initialize a new Kysera project
- `migrate` - Database migration management
- `generate` (alias `g`) - Code generation utilities
- `db` - Database management utilities
- `health` - Database health monitoring
- `audit` - Audit logging and history
- `debug` - Debug and diagnostic utilities
- `query` - Query utilities and analysis
- `repository` - Repository pattern utilities
- `test` - Test environment management
- `plugin` - Plugin management
- `schema` - PostgreSQL schema management
- `hello` - Test command to verify CLI setup
- `stats` - Show CLI performance statistics
- `help` - Display help for command

### Subcommands

- `migrate`: create, up, down, status, list, reset, fresh
- `generate`: model, repository, schema, crud
- `db`: seed, reset, tables, dump, restore, introspect, console
- `health`: check, watch, metrics
- `audit`: logs, history, restore, stats, cleanup, compare, diff
- `debug`: sql, profile, errors, circuit-breaker, analyzer
- `query`: by-timestamp, soft-deleted, analyze, explain
- `repository`: list, inspect, validate, methods
- `test`: setup, teardown, seed, fixtures
- `plugin`: list, enable, disable, config
- `schema`: list, create, drop, info, clone, compare

### Global Options

Accepted at the program level (before a command):

- `--verbose` - Enable verbose output
- `-q, --quiet` - Suppress non-essential output
- `--dry-run` - Preview changes without executing
- `--config <path>` - Path to configuration file (with file path completion)
- `--no-color` - Disable colored output
- `--json` - Output results as JSON
- `--env <environment>` - Environment (development/production/test)
- `--stats` - Show performance statistics
- `-v, --version` - Show CLI version
- `-h, --help` - Display help

### Per-Subcommand Options

Every subcommand completes its own real option set (extracted from the command registrations). Value completion is provided where the CLI defines an enumerated set, for example:

```bash
kysera init --database <TAB>          # postgres mysql sqlite
kysera init --template <TAB>          # basic api graphql monorepo
kysera audit logs --action <TAB>      # INSERT UPDATE DELETE
kysera debug circuit-breaker -a <TAB> # status reset open close
```

## Testing Completions

See [TESTING.md](./TESTING.md). Quick check:

```bash
kysera <TAB>            # main commands
kysera migrate <TAB>    # create up down status list reset fresh
kysera schema <TAB>     # list create drop info clone compare
```

## Troubleshooting

### Bash

1. Ensure bash-completion is installed: `brew install bash-completion` (macOS)
2. Check if bash-completion is sourced in your shell config
3. Reload your shell: `source ~/.bashrc`

### Zsh

1. Ensure the completion function is in your `$fpath`
2. Check if `compinit` is being called
3. Try rebuilding the completion cache: `rm ~/.zcompdump && compinit`

### Fish

1. Ensure the file is in the correct location: `~/.config/fish/completions/`
2. Fish loads completions automatically, no reload needed
3. Check Fish's completion search path: `echo $fish_complete_path`

## License

MIT © Kysera Team
