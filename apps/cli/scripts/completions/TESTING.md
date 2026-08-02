# Testing Kysera CLI Shell Completions

This document provides testing instructions for the shell completion scripts.

The scripts are generated from the CLI source by `generate.mjs`; if a completion looks wrong, first regenerate (`node generate.mjs`) and check whether the CLI command tree changed.

## Quick Test (Without Installation)

### Bash

```bash
# Source the completion script in your current shell (requires bash-completion)
cd apps/cli/scripts/completions
source kysera.bash

# Test completions
kysera <TAB>                 # init migrate generate db health audit debug query repository test plugin schema hello stats help
kysera migrate <TAB>         # create up down status list reset fresh
kysera init --database <TAB> # postgres mysql sqlite
```

### Zsh

```zsh
# Load the completion in your current shell
cd apps/cli/scripts/completions
fpath=($PWD $fpath)
autoload -U compinit && compinit

# Test completions
kysera <TAB>                 # commands with descriptions
kysera schema <TAB>          # list create drop info clone compare
kysera audit logs --action <TAB>  # INSERT UPDATE DELETE
```

### Fish

```fish
# Copy to Fish completions directory
cp kysera.fish ~/.config/fish/completions/

# Test completions (Fish loads automatically)
kysera <TAB>                 # commands with descriptions
kysera db <TAB>              # seed reset tables dump restore introspect console
kysera debug circuit-breaker --action <TAB>  # status reset open close
```

## Comprehensive Test Cases

### 1. Main Commands

`kysera <TAB>` should offer exactly:

init, migrate, generate, db, health, audit, debug, query, repository, test, plugin, schema, hello, stats, help

### 2. Subcommands

| Input | Expected |
| ----- | -------- |
| `kysera migrate <TAB>` | create up down status list reset fresh |
| `kysera generate <TAB>` | model repository schema crud |
| `kysera db <TAB>` | seed reset tables dump restore introspect console |
| `kysera health <TAB>` | check watch metrics |
| `kysera audit <TAB>` | logs history restore stats cleanup compare diff |
| `kysera debug <TAB>` | sql profile errors circuit-breaker analyzer |
| `kysera query <TAB>` | by-timestamp soft-deleted analyze explain |
| `kysera repository <TAB>` | list inspect validate methods |
| `kysera test <TAB>` | setup teardown seed fixtures |
| `kysera plugin <TAB>` | list enable disable config |
| `kysera schema <TAB>` | list create drop info clone compare |

### 3. Option Value Completion

| Input | Expected |
| ----- | -------- |
| `kysera init --database <TAB>` | postgres mysql sqlite |
| `kysera init --template <TAB>` | basic api graphql monorepo |
| `kysera init --package-manager <TAB>` | npm pnpm yarn bun |
| `kysera --env <TAB>` | development production test |
| `kysera audit logs --action <TAB>` | INSERT UPDATE DELETE (zsh/fish) |
| `kysera debug circuit-breaker --action <TAB>` | status reset open close (zsh/fish) |

### 4. Global Options

`kysera --<TAB>` should offer:

--verbose, --quiet, --dry-run, --config, --no-color, --json, --env, --stats, --version, --help

### 5. File Path Completion

- `kysera --config <TAB>` completes config file paths (.ts/.mts/.cts/.js/.mjs/.cjs/.json)
- `kysera migrate create foo --dir <TAB>` completes directory paths (zsh)

### 6. Per-Subcommand Options

- `kysera migrate up --<TAB>` → --to --steps --count --dry-run --force --verbose --config --schema --help
- `kysera plugin config --<TAB>` → --get --set --value --reset --show --edit --validate --export --import --json --config --help
- `kysera query soft-deleted --<TAB>` → --table --column --restore --purge --force --limit --json --config --schema --help

### 7. Alias

- `kysera g <TAB>` behaves like `kysera generate <TAB>` (bash/zsh/fish)

## Verification Checklist

- [ ] Main commands complete correctly (including schema, hello, stats)
- [ ] Subcommands complete for all command groups
- [ ] No removed/nonexistent commands are offered
- [ ] Per-subcommand options complete correctly
- [ ] Option values complete with predefined choices
- [ ] File path completion works for --config
- [ ] `g` alias completes generate subcommands
- [ ] No errors or warnings when using completions

## Common Issues and Solutions

### Bash

**Issue:** Completions not working after sourcing
**Solution:** Ensure bash-completion 2.0+ is installed (`_init_completion` is required)

```bash
# macOS
brew install bash-completion

# Linux (Debian/Ubuntu)
sudo apt-get install bash-completion
```

### Zsh

**Issue:** Completions not appearing
**Solution:** Rebuild completion cache

```zsh
rm ~/.zcompdump
autoload -U compinit && compinit
```

### Fish

**Issue:** Completions not working
**Solution:** Verify file location and reload

```fish
echo $fish_complete_path
complete -c kysera -e
source ~/.config/fish/completions/kysera.fish
```

## Automated Smoke Test (Bash)

```bash
#!/bin/bash
# Stub bash-completion helpers, then exercise the completion function directly
_init_completion() {
    cur=${COMP_WORDS[COMP_CWORD]}
    prev=${COMP_WORDS[COMP_CWORD-1]}
    return 0
}
_filedir() { COMPREPLY=(); }
source kysera.bash

test_completion() {
    COMP_WORDS=("$@" "")
    COMP_CWORD=$(( ${#COMP_WORDS[@]} - 1 ))
    COMPREPLY=()
    _kysera_completions
    echo "${COMPREPLY[@]}"
}

test_completion kysera | grep -qw migrate && echo "OK main commands"
test_completion kysera migrate | grep -qw fresh && echo "OK migrate subcommands"
test_completion kysera schema | grep -qw clone && echo "OK schema subcommands"
```
