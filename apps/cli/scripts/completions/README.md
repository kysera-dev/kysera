# Kysera CLI Shell Completions

This directory contains shell completion scripts for Kysera CLI to enable tab completion for commands, subcommands, and options.

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

## Features

### Main Commands
- `init` - Initialize a new Kysera project
- `migrate` - Database migration management
- `generate` - Code generation utilities
- `db` - Database management tools
- `health` - Health monitoring and metrics
- `audit` - Audit logging and history
- `debug` - Debug and diagnostic tools
- `query` - Query analysis and utilities
- `repository` - Repository pattern utilities
- `test` - Test environment management
- `plugin` - Plugin management
- `help` - Show help information

### Subcommand Completion

Each main command has intelligent subcommand completion:

- `migrate`: create, up, down, status, list, reset, fresh, rollback
- `generate`: model, repository, schema, crud, migration
- `db`: seed, reset, tables, dump, restore, introspect, console
- `health`: check, watch, metrics
- `audit`: logs, history, restore, stats, cleanup, compare, diff
- `debug`: connection, schema, queries, slow-queries, explain
- `query`: analyze, explain, optimize, index, suggest
- `repository`: list, create, scaffold, validate, test
- `test`: setup, teardown, seed, fixtures, run
- `plugin`: list, install, uninstall, enable, disable, info

### Global Options

All commands support these global options:
- `--help` - Show help information
- `--version` - Show version number
- `--verbose` / `-v` - Detailed output
- `--quiet` / `-q` - Minimal output
- `--dry-run` - Preview without executing
- `--json` - JSON output format
- `--config` - Custom config file (with file path completion)
- `--no-color` - Disable colored output

### Command-Specific Options

The completion scripts include context-aware option completion for each command:

#### init
- `--dialect` (postgres, mysql, sqlite)
- `--typescript`
- `--javascript`
- `--with-examples`
- `--skip-git`

#### migrate
- `--name`
- `--table`
- `--all`
- `--step`
- `--to`

#### generate
- `--table`
- `--output` (with directory completion)
- `--with-validation`
- `--with-tests`
- `--api`
- `--crud`
- `--validation` (zod, yup, joi, none)

#### db
- `--force`
- `--output` (with file completion)
- `--format` (sql, json, yaml)
- `--env` (development, test, production)

#### health
- `--interval`
- `--format` (table, json)
- `--threshold`

#### audit
- `--from`
- `--to`
- `--entity`
- `--limit`
- `--format` (table, json)

#### test
- `--env` (development, test, production)
- `--count`
- `--strategy` (realistic, minimal, random, faker)
- `--force`

#### plugin
- `--global`
- `--save`

## Testing Completions

After installation, test the completions:

```bash
# Type and press TAB to see available commands
kysera <TAB>

# Type and press TAB to see migrate subcommands
kysera migrate <TAB>

# Type and press TAB to see available dialects
kysera init --dialect <TAB>

# Type and press TAB to see validation libraries
kysera generate model User --validation <TAB>
```

## Troubleshooting

### Bash

If completions don't work:
1. Ensure bash-completion is installed: `brew install bash-completion` (macOS)
2. Check if bash-completion is sourced in your shell config
3. Reload your shell: `source ~/.bashrc`

### Zsh

If completions don't work:
1. Ensure the completion function is in your `$fpath`
2. Check if `compinit` is being called
3. Try rebuilding the completion cache: `rm ~/.zcompdump && compinit`

### Fish

If completions don't work:
1. Ensure the file is in the correct location: `~/.config/fish/completions/`
2. Fish loads completions automatically, no reload needed
3. Check Fish's completion search path: `echo $fish_complete_path`

## Contributing

If you find issues or want to add more completions:
1. Test your changes in the appropriate shell
2. Ensure all commands and options are covered
3. Submit a PR with clear descriptions of the changes

## License

MIT © Kysera Team
