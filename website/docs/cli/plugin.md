---
sidebar_position: 11
title: plugin
description: Plugin management and configuration
---

# kysera plugin

Plugin management and configuration tools for discovering, enabling, and configuring Kysera plugins.

## Commands

| Command | Description |
|---------|-------------|
| `list` | List available and installed plugins |
| `enable` | Enable a plugin |
| `disable` | Disable a plugin |
| `config` | Configure plugin settings |

## list

List available and installed plugins.

```bash
kysera plugin list [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--installed` | Show only installed plugins |
| `--available` | Show available plugins from registry |
| `--enabled` | Show only enabled plugins |
| `--disabled` | Show only disabled plugins |
| `-c, --category <type>` | Filter by category |
| `-s, --search <query>` | Search plugins by name or description |
| `--show-details` | Show detailed plugin information |
| `--json` | Output as JSON |
| `--config <path>` | Path to configuration file |

### Plugin Categories

| Category | Description |
|----------|-------------|
| `database` | Database-level plugins |
| `schema` | Schema modification plugins |
| `query` | Query enhancement plugins |
| `audit` | Audit and logging plugins |
| `cache` | Caching plugins |
| `validation` | Validation plugins |

### Examples

```bash
# List all plugins
kysera plugin list

# List installed plugins only
kysera plugin list --installed

# List available plugins from registry
kysera plugin list --available

# Filter by category
kysera plugin list --category audit

# Search plugins
kysera plugin list --search "soft delete"

# Show detailed information
kysera plugin list --show-details

# Show only enabled plugins
kysera plugin list --enabled
```

### Output

**Default view:**
```
Kysera Plugins
────────────────────────────────────────────────────────────────────────────────

Installed Plugins:

  @kysera/soft-delete v1.0.0
    Status: ● Enabled
    Category: schema
    Soft delete support with automatic filtering

  @kysera/timestamps v1.0.0
    Status: ● Enabled
    Category: schema
    Automatic created_at and updated_at timestamps

Available Plugins:

  @kysera/audit v1.0.0
    Category: audit
    Comprehensive audit logging for all database operations

  @kysera/cache v1.0.0
    Category: cache
    Query result caching with Redis/memory backends

────────────────────────────────────────────────────────────────────────────────
Summary:
  Installed: 2
  Enabled: 2
  Disabled: 0
  Available: 7
```

**Detailed view (with `--show-details`):**

Shows additional information:
- Author
- Homepage URL
- Hooks used (e.g., beforeInsert, afterUpdate)
- Providers exported
- Commands added
- Version compatibility

### Plugin Status

| Status | Indicator | Description |
|--------|-----------|-------------|
| Enabled | ● | Plugin is active and running |
| Disabled | ● | Plugin is installed but not active |
| Installed | ● | Plugin is installed, status unknown |
| Available | ◯ | Plugin can be installed |

## enable

Enable an installed plugin.

```bash
kysera plugin enable <name> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `name` | Plugin name (e.g., @kysera/audit) |

### Options

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to configuration file |

### Examples

```bash
# Enable a plugin
kysera plugin enable @kysera/soft-delete

# Enable with full package name
kysera plugin enable @kysera/audit
```

### Effect

Enabling a plugin:
1. Updates `kysera.config.ts` to include the plugin
2. Validates plugin compatibility
3. Runs any plugin initialization hooks

## disable

Disable an enabled plugin without uninstalling.

```bash
kysera plugin disable <name> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `name` | Plugin name (e.g., @kysera/audit) |

### Options

| Option | Description |
|--------|-------------|
| `--all` | Disable all plugins |
| `--config <path>` | Path to configuration file |

### Examples

```bash
# Disable a specific plugin
kysera plugin disable @kysera/cache

# Disable all plugins
kysera plugin disable --all
```

### Effect

Disabling a plugin:
1. Updates `kysera.config.ts` to set `enabled: false`
2. Plugin hooks are no longer called
3. Plugin remains installed for quick re-enabling

## config

Configure plugin settings.

```bash
kysera plugin config <name> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `name` | Plugin name (e.g., @kysera/cache) |

### Options

| Option | Description |
|--------|-------------|
| `--set <key=value>` | Set a configuration value |
| `--get <key>` | Get a configuration value |
| `--reset` | Reset to default configuration |
| `--show` | Show current configuration |
| `--json` | Output as JSON |
| `--config <path>` | Path to configuration file |

### Examples

```bash
# Show current configuration
kysera plugin config @kysera/cache --show

# Set a configuration value
kysera plugin config @kysera/cache --set "ttl=3600"

# Set multiple values
kysera plugin config @kysera/cache --set "ttl=3600" --set "driver=redis"

# Get a specific value
kysera plugin config @kysera/cache --get ttl

# Reset to defaults
kysera plugin config @kysera/cache --reset
```

### Configuration in kysera.config.ts

Plugin configuration is stored in the config file:

```typescript
import { defineConfig } from '@kysera/cli'

export default defineConfig({
  plugins: {
    '@kysera/soft-delete': {
      enabled: true,
      column: 'deleted_at',
      includeDeleted: false
    },
    '@kysera/timestamps': {
      enabled: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    '@kysera/cache': {
      enabled: true,
      ttl: 3600,
      driver: 'memory'
    }
  }
})
```

## Official Plugins

### @kysera/soft-delete

Soft delete support with automatic filtering.

```bash
kysera plugin enable @kysera/soft-delete
kysera plugin config @kysera/soft-delete --set "column=deleted_at"
```

### @kysera/timestamps

Automatic created_at and updated_at timestamps.

```bash
kysera plugin enable @kysera/timestamps
```

### @kysera/audit

Comprehensive audit logging.

```bash
kysera plugin enable @kysera/audit
kysera plugin config @kysera/audit --set "table=audit_logs"
```

### @kysera/rls

Row-Level Security for multi-tenant applications.

```bash
kysera plugin enable @kysera/rls
```

## Custom Plugins

You can create custom plugins in a `plugins/` directory:

```
my-project/
├── plugins/
│   └── my-custom-plugin/
│       ├── package.json
│       └── index.ts
└── kysera.config.ts
```

Custom plugins are automatically discovered by `kysera plugin list`.

## See Also

- [Plugins Overview](/docs/plugins/overview) - Plugin architecture
- [@kysera/soft-delete](/docs/plugins/soft-delete) - Soft delete plugin
- [@kysera/audit](/docs/plugins/audit) - Audit plugin
- [@kysera/timestamps](/docs/plugins/timestamps) - Timestamps plugin
- [Authoring Plugins](/docs/plugins/authoring-guide) - Create custom plugins
