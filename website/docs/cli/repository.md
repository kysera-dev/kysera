---
sidebar_position: 10
title: repository
description: Repository introspection and management
---

# kysera repository

Repository introspection and management tools for analyzing and validating your repository classes.

## Commands

| Command    | Description                                |
| ---------- | ------------------------------------------ |
| `list`     | List all repository classes in the project |
| `inspect`  | Inspect a repository in detail             |
| `validate` | Validate schemas against database          |
| `methods`  | Show available repository methods          |

## list

List all repository classes found in the project.

```bash
kysera repository list [options]
```

### Options

| Option                   | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `-d, --directory <path>` | Directory to scan (default: src)                    |
| `-p, --pattern <glob>`   | File pattern to match (default: \**/*Repository.ts) |
| `--show-methods`         | Show repository methods                             |
| `--show-schemas`         | Show entity schemas                                 |
| `--json`                 | Output as JSON                                      |
| `--config <path>`        | Path to configuration file                          |

### Examples

```bash
# List all repositories
kysera repository list

# List with method details
kysera repository list --show-methods

# List with schema information
kysera repository list --show-schemas

# Scan a different directory
kysera repository list --directory lib

# Custom file pattern
kysera repository list --pattern "**/*Repo.ts"

# Output as JSON for scripting
kysera repository list --json
```

### Output

**Table View (default):**

| Repository     | Table | Path                        | Methods | Features |
| -------------- | ----- | --------------------------- | ------- | -------- |
| UserRepository | users | src/repos/UserRepository.ts | 12      | V P S    |

Feature indicators:

- `V` - Has validation (Zod/Valibot)
- `P` - Has pagination
- `S` - Has soft delete

**Detailed View (with `--show-methods` or `--show-schemas`):**

```
UserRepository
  Path: src/repos/UserRepository.ts
  Table: users
  Entity: UserEntity
  Stats:
    Lines: 150
    Methods: 12
    [OK] Has validation
    [OK] Has pagination
    [OK] Has soft delete

  Methods:
    * findById()
    * findByEmail()
    * create()
    * update()
    ...
```

### Summary

The command provides a summary showing:

- Total repositories found
- Percentage with validation
- Percentage with pagination
- Percentage with soft delete

## inspect

Inspect a specific repository in detail.

```bash
kysera repository inspect [options]
```

The repository is selected with `-f/--file` or `-c/--className` — there is no positional argument.

### Options

| Option                  | Description                |
| ----------------------- | -------------------------- |
| `-f, --file <path>`     | Repository file to inspect |
| `-c, --className <name>`| Repository class name      |
| `--show-ast`            | Show abstract syntax tree  |
| `--show-dependencies`   | Show dependencies graph    |
| `--show-complexity`     | Show complexity metrics    |
| `--show-database`       | Show database table info   |
| `--json`                | Output as JSON             |
| `--config <path>`       | Path to configuration file |

### Examples

```bash
# Inspect by class name
kysera repository inspect -c UserRepository

# Inspect a specific file
kysera repository inspect -f src/repos/UserRepository.ts

# Include dependency graph and complexity metrics
kysera repository inspect -c UserRepository --show-dependencies --show-complexity

# Cross-check against the database table
kysera repository inspect -c UserRepository --show-database
```

### Output

Inspection provides:

- File path and location
- Table name
- Entity type
- All methods with signatures
- Dependencies
- Plugins used
- Validation schema details

## validate

Validate repository schemas against the actual database schema.

```bash
kysera repository validate [options]
```

### Options

| Option                   | Description                                  |
| ------------------------ | -------------------------------------------- |
| `-d, --directory <path>` | Directory to scan (default: src)             |
| `-p, --pattern <glob>`   | File pattern to match (default: \**/*Repository.ts) |
| `--fix`                  | Attempt to fix issues                        |
| `--strict`               | Strict validation (fail on warnings)         |
| `--show-details`         | Show detailed validation results             |
| `--json`                 | Output as JSON                               |
| `--config <path>`        | Path to configuration file                   |

### Examples

```bash
# Validate all repositories
kysera repository validate

# Strict validation with details
kysera repository validate --strict --show-details

# Validate a different directory
kysera repository validate -d lib

# Attempt automatic fixes
kysera repository validate --fix
```

### Validation Checks

The validator checks:

| Check              | Description                                |
| ------------------ | ------------------------------------------ |
| Column existence   | Schema properties match database columns   |
| Type compatibility | TypeScript types match SQL types           |
| Nullable fields    | Optional properties match NULL constraints |
| Primary keys       | ID fields match primary key definition     |
| Foreign keys       | References match foreign key constraints   |

### Output

```
Validating repositories against database schema...

UserRepository → users
  [OK] All 8 columns match

OrderRepository → orders
  [WARN] Column 'shipping_address' is nullable in DB but required in schema
  [ERR] Column 'legacy_id' exists in DB but not in schema

ProductRepository → products
  [OK] All 12 columns match

Summary:
  Validated: 3 repositories
  Passed: 2
  Warnings: 1
  Errors: 1
```

## methods

Show available methods across all repositories.

```bash
kysera repository methods [options]
```

### Options

| Option                  | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `-r, --repository <name>` | Repository class name                                  |
| `-f, --file <path>`     | Repository file path                                     |
| `-g, --group-by <type>` | Group by: visibility, type, category (default: visibility) |
| `--filter <pattern>`    | Filter methods by name pattern                           |
| `--show-signatures`     | Show full method signatures                              |
| `--show-examples`       | Show usage examples                                      |
| `--show-complexity`     | Show complexity metrics                                  |
| `--markdown`            | Output as markdown documentation                         |
| `--json`                | Output as JSON                                           |
| `--config <path>`       | Path to configuration file                               |

### Examples

```bash
# List all methods
kysera repository methods

# Show full signatures
kysera repository methods --show-signatures

# Filter by pattern
kysera repository methods --filter "find*"

# Group by method type
kysera repository methods --group-by type

# Methods of a single repository, as markdown docs
kysera repository methods -r UserRepository --markdown
```

### Output

**Default view:**

```
Repository Methods

UserRepository:
  • findById
  • findByEmail
  • findActive
  • create
  • update
  • delete
  • softDelete

OrderRepository:
  • findById
  • findByUser
  • findByStatus
  • create
  • updateStatus
  ...
```

**With signatures:**

```
UserRepository:
  • findById(id: string): Promise<User | null>
  • findByEmail(email: string): Promise<User | null>
  • create(data: CreateUserInput): Promise<User>
  ...
```

## Use Cases

### Code Review

```bash
# Check repository coverage
kysera repository list

# Verify validation is in place
kysera repository list --show-schemas
```

### Database Sync

```bash
# Check for schema drift
kysera repository validate

# Get fix suggestions after migration
kysera repository validate --fix
```

### Documentation

```bash
# Generate method inventory
kysera repository methods --json > repository-methods.json

# Export repository details
kysera repository list --json --show-methods > repositories.json
```

### Onboarding

```bash
# Understand available queries
kysera repository methods --filter "find*"

# Inspect specific repository
kysera repository inspect -c UserRepository
```

## Configuration

Repository commands scan the directory given by `-d/--directory` (default: `src`) with the `-p/--pattern` glob (default: `**/*Repository.ts`). Output locations for generated code come from the `generate` section of `kysera.config.ts`:

```typescript
export default {
  generate: {
    repositories: './src/repositories',
    models: './src/models',
    schemas: './src/schemas'
  }
}
```

## See Also

- [Generate Commands](/docs/cli/generate) - Generate repository code
- [@kysera/repository](/docs/api/repository) - Repository API
- [Repository Pattern](/docs/core-concepts/repository-pattern) - Repository concepts
