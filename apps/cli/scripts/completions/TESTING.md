# Testing Kysera CLI Shell Completions

This document provides testing instructions for the shell completion scripts.

## Quick Test (Without Installation)

### Bash

```bash
# Source the completion script in your current shell
cd /Users/taaliman/projects/luxquant/omnitron-dev/omni/apps/kysera-cli
source scripts/completions/kysera.bash

# Test completions
kysera <TAB>              # Should show: init migrate generate db health audit debug query repository test plugin help
kysera migrate <TAB>      # Should show: create up down status list reset fresh rollback
kysera init --dialect <TAB>  # Should show: postgres mysql sqlite
```

### Zsh

```zsh
# Load the completion in your current shell
cd /Users/taaliman/projects/luxquant/omnitron-dev/omni/apps/kysera-cli
fpath=(scripts/completions $fpath)
autoload -U compinit && compinit
source scripts/completions/kysera.zsh

# Test completions
kysera <TAB>              # Should show commands with descriptions
kysera migrate <TAB>      # Should show migrate subcommands
kysera generate --validation <TAB>  # Should show: zod yup joi none
```

### Fish

```fish
# Copy to Fish completions directory
cp scripts/completions/kysera.fish ~/.config/fish/completions/

# Test completions (Fish loads automatically)
kysera <TAB>              # Should show commands with descriptions
kysera db <TAB>           # Should show db subcommands
kysera test --strategy <TAB>  # Should show: realistic minimal random faker
```

## Comprehensive Test Cases

### 1. Main Commands Completion

```bash
kysera <TAB>
```

**Expected output:**
- init
- migrate
- generate
- db
- health
- audit
- debug
- query
- repository
- test
- plugin
- help

### 2. Subcommands Completion

#### Migrate Subcommands
```bash
kysera migrate <TAB>
```

**Expected output:**
- create
- up
- down
- status
- list
- reset
- fresh
- rollback

#### Generate Subcommands
```bash
kysera generate <TAB>
```

**Expected output:**
- model
- repository
- schema
- crud
- migration

### 3. Option Value Completion

#### Database Dialects
```bash
kysera init --dialect <TAB>
```

**Expected output:**
- postgres
- mysql
- sqlite

#### Validation Libraries
```bash
kysera generate model User --validation <TAB>
```

**Expected output:**
- zod
- yup
- joi
- none

#### Output Formats
```bash
kysera db dump --format <TAB>
```

**Expected output:**
- sql
- json
- yaml

#### Environments
```bash
kysera test setup --env <TAB>
```

**Expected output:**
- development
- test
- production

#### Seeding Strategies
```bash
kysera test seed --strategy <TAB>
```

**Expected output:**
- realistic
- minimal
- random
- faker

### 4. Global Options

```bash
kysera --<TAB>
```

**Expected output:**
- --help
- --version
- --verbose
- --quiet
- --dry-run
- --json
- --config
- --no-color

### 5. File Path Completion

```bash
kysera --config <TAB>
```

**Expected behavior:** Should complete file paths, filtering for .ts, .js, .json files

```bash
kysera generate model User --output <TAB>
```

**Expected behavior:** Should complete directory paths

### 6. Command-Specific Options

#### Init Command
```bash
kysera init --<TAB>
```

**Expected output:**
- --dialect
- --typescript
- --javascript
- --with-examples
- --skip-git
- (plus global options)

#### Generate Command
```bash
kysera generate model User --<TAB>
```

**Expected output:**
- --table
- --output
- --with-validation
- --with-tests
- --api
- --crud
- --validation
- (plus global options)

#### Test Command
```bash
kysera test seed --<TAB>
```

**Expected output:**
- --env
- --count
- --strategy
- --force
- (plus global options)

## Verification Checklist

- [ ] Main commands complete correctly
- [ ] Subcommands complete for all main commands
- [ ] Global options work with all commands
- [ ] Command-specific options complete correctly
- [ ] Option values complete with predefined choices
- [ ] File path completion works for --config
- [ ] Directory path completion works for --output
- [ ] No errors or warnings when using completions
- [ ] Completions work after typing partial text
- [ ] Case sensitivity works as expected

## Common Issues and Solutions

### Bash

**Issue:** Completions not working after sourcing
**Solution:** Ensure bash-completion package is installed
```bash
# macOS
brew install bash-completion

# Linux (Debian/Ubuntu)
sudo apt-get install bash-completion
```

**Issue:** _init_completion command not found
**Solution:** Install bash-completion 2.0 or later

### Zsh

**Issue:** Completions not appearing
**Solution:** Rebuild completion cache
```zsh
rm ~/.zcompdump
autoload -U compinit && compinit
```

**Issue:** Completions not updating after changes
**Solution:** Force reload
```zsh
unfunction _kysera
autoload -U compinit && compinit
```

### Fish

**Issue:** Completions not working
**Solution:** Verify file location
```fish
# Check Fish completion search paths
echo $fish_complete_path

# Manually reload (if needed)
complete -c kysera -e  # Clear old completions
source ~/.config/fish/completions/kysera.fish
```

## Performance Testing

Test completion performance with large command sets:

```bash
# Time the completion function
time kysera <TAB>

# Should complete in < 100ms for good user experience
```

## Edge Cases to Test

1. Partial command completion: `kysera mi<TAB>` → `kysera migrate`
2. Multiple options: `kysera init --typescript --dialect <TAB>` → shows dialects
3. Short aliases: `kysera m <TAB>` → shows migrate subcommands
4. Case sensitivity: Test with different case variations
5. Special characters in file paths: Test completion with spaces, quotes, etc.

## Automated Testing

For CI/CD integration, create test scripts:

```bash
#!/bin/bash
# test-completions.sh

source scripts/completions/kysera.bash

# Mock COMP_WORDS and COMP_CWORD to test completion function
test_completion() {
    COMP_WORDS=("$@")
    COMP_CWORD=$((${#COMP_WORDS[@]} - 1))
    _kysera_completions
    echo "${COMPREPLY[@]}"
}

# Test cases
test_completion kysera | grep -q "migrate" && echo "✓ Main commands" || echo "✗ Main commands"
test_completion kysera migrate | grep -q "up" && echo "✓ Migrate subcommands" || echo "✗ Migrate subcommands"
test_completion kysera --dialect | grep -q "postgres" && echo "✓ Dialect values" || echo "✗ Dialect values"
```

## Reporting Issues

If you find any issues with completions:

1. Specify your shell and version: `bash --version`, `zsh --version`, or `fish --version`
2. Describe the expected vs actual behavior
3. Provide the exact command and tab sequence
4. Check if the issue occurs in a clean shell session
5. Submit an issue with all details

## Contributing

To add new completions:

1. Update the respective completion file (kysera.bash, kysera.zsh, or kysera.fish)
2. Add test cases to this document
3. Verify completions work in the target shell
4. Update the README.md in the completions directory
5. Submit a PR with examples

---

Last updated: 2025-12-07
