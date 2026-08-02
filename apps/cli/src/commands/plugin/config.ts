import { Command } from 'commander'
import { prism, select, text, confirm } from '@xec-sh/kit'
import { spinner } from '../../utils/spinner.js'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { loadConfig, saveConfig } from '../../config/loader.js'
import type { KyseraConfig } from '../../config/schema.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as yaml from 'js-yaml'

export interface ConfigPluginOptions {
  get?: string
  set?: string
  value?: string
  reset?: boolean
  show?: boolean
  edit?: boolean
  validate?: boolean
  export?: string
  import?: string
  json?: boolean
  config?: string
}

interface PluginConfig {
  enabled: boolean
  [key: string]: unknown
}

/** Plugin settings as stored in the kysera config, keyed by plugin package name. */
type PluginsRecord = Record<string, PluginConfig | undefined>

interface ConfigSchema {
  properties: Record<
    string,
    {
      type: 'string' | 'number' | 'boolean' | 'array' | 'object'
      description?: string
      default?: unknown
      enum?: unknown[]
      required?: boolean
      min?: number
      max?: number
    }
  >
}

export function configPluginCommand(): Command {
  const cmd = new Command('config')
    .description('Configure plugin settings')
    .argument('[name]', 'Plugin name to configure')
    .option('-g, --get <key>', 'Get configuration value')
    .option('-s, --set <key>', 'Set configuration key')
    .option('--value <value>', 'Configuration value to set')
    .option('--reset', 'Reset to default configuration', false)
    .option('--show', 'Show current configuration', false)
    .option('--edit', 'Edit configuration interactively', false)
    .option('--validate', 'Validate configuration', false)
    .option('--export <file>', 'Export configuration to file')
    .option('--import <file>', 'Import configuration from file')
    .option('--json', 'Output as JSON', false)
    .option('--config <path>', 'Path to configuration file')
    .action(async (name: string | undefined, options: ConfigPluginOptions) => {
      try {
        await configurePlugin(name, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to configure plugin: ${error instanceof Error ? error.message : String(error)}`,
          'PLUGIN_CONFIG_ERROR'
        )
      }
    })

  return cmd
}

async function configurePlugin(
  name: string | undefined,
  options: ConfigPluginOptions
): Promise<void> {
  const configSpinner = spinner()

  try {
    // Load configuration
    const config = await loadConfig(options.config)

    config.plugins ??= {}
    const pluginsRecord = config.plugins as PluginsRecord

    // Handle import first
    if (options.import) {
      await importPluginConfig(options.import, config)
      await saveConfig(config, options.config)
      console.log(prism.green('✅ Configuration imported successfully'))
      return
    }

    // Select plugin if not specified
    if (!name) {
      const plugins = Object.keys(config.plugins)

      if (plugins.length === 0) {
        console.log(prism.yellow('No plugins configured'))
        console.log(prism.gray('Enable plugins with: kysera plugin enable <name>'))
        return
      }

      name = (await select({
        message: 'Select plugin to configure:',
        options: plugins.map(p => ({
          label: p,
          value: p,
          hint: pluginsRecord[p]?.enabled ? 'Enabled' : 'Disabled'
        }))
      })) as string
    }

    // Initialize plugin config if not exists
    let pluginConfig = pluginsRecord[name]
    if (!pluginConfig) {
      pluginConfig = { enabled: false }
      pluginsRecord[name] = pluginConfig
    }

    // Handle export
    if (options.export) {
      await exportPluginConfig(name, pluginConfig, options.export)
      console.log(prism.green(`✅ Configuration exported to ${options.export}`))
      return
    }

    // Handle show
    if (options.show) {
      displayPluginConfig(name, pluginConfig, options.json ?? false)
      return
    }

    // Handle get
    if (options.get) {
      const value = getConfigValue(pluginConfig, options.get)
      if (options.json) {
        console.log(JSON.stringify({ [options.get]: value }, null, 2))
      } else {
        console.log(`${options.get}: ${formatValue(value)}`)
      }
      return
    }

    // Handle set
    if (options.set) {
      if (options.value === undefined) {
        throw new CLIError('Value required when setting configuration', 'CONFIG_ERROR', undefined, [
          'Use --value <value> to specify the value'
        ])
      }

      const parsedValue = parseConfigValue(options.value)
      setConfigValue(pluginConfig, options.set, parsedValue)

      await saveConfig(config, options.config)
      console.log(prism.green(`✅ Set ${options.set} = ${formatValue(parsedValue)}`))
      return
    }

    // Handle reset
    if (options.reset) {
      const defaultConfig = getDefaultConfig(name)

      const shouldReset =
        (options.json ?? false) ||
        (await confirm({ message: `Reset ${name} to default configuration?` }))

      if (shouldReset) {
        pluginsRecord[name] = {
          ...defaultConfig,
          enabled: pluginConfig.enabled
        }

        await saveConfig(config, options.config)
        console.log(prism.green('✅ Configuration reset to defaults'))
      }
      return
    }

    // Handle validate
    if (options.validate) {
      const schema = getConfigSchema(name)
      const errors = validateConfig(pluginConfig, schema)

      if (errors.length === 0) {
        console.log(prism.green('✅ Configuration is valid'))
      } else {
        console.log(prism.red('❌ Configuration errors found:'))
        for (const error of errors) {
          console.log(`  • ${error}`)
        }
      }
      return
    }

    // Handle edit (interactive)
    if (options.edit) {
      await editConfigInteractive(name, pluginConfig, pluginsRecord, config, options)
      return
    }

    // Default: show configuration
    displayPluginConfig(name, pluginConfig, options.json ?? false)
  } catch (error) {
    configSpinner.stop()
    logger.error('Configuration failed')
    throw error
  }
}

function getConfigValue(config: PluginConfig, key: string): unknown {
  const keys = key.split('.')
  let value: unknown = config

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k]
    } else {
      return undefined
    }
  }

  return value
}

function setConfigValue(config: PluginConfig, key: string, value: unknown): void {
  const keys = key.split('.')
  let target: Record<string, unknown> = config

  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    if (!(k in target) || typeof target[k] !== 'object') {
      target[k] = {}
    }
    target = target[k] as Record<string, unknown>
  }

  target[keys[keys.length - 1]] = value
}

function parseConfigValue(value: string): unknown {
  // Try to parse as JSON
  try {
    return JSON.parse(value) as unknown
  } catch {
    // Not JSON
  }

  // Boolean values
  if (value === 'true') return true
  if (value === 'false') return false

  // Numeric values
  if (/^-?\d+$/.test(value)) {
    return parseInt(value)
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return parseFloat(value)
  }

  // Array values
  if (value.includes(',')) {
    return value.split(',').map(v => v.trim())
  }

  // String value
  return value
}

function formatValue(value: unknown): string {
  switch (typeof value) {
    case 'undefined':
      return 'undefined'
    case 'boolean':
      return value ? 'true' : 'false'
    case 'string':
      return value
    case 'number':
      return String(value)
    case 'object':
      if (value === null) return 'null'
      if (Array.isArray(value)) {
        // Match Array#join semantics: null/undefined render as empty strings
        return `[${value.map(v => (v == null ? '' : String(v))).join(', ')}]`
      }
      return JSON.stringify(value, null, 2)
    default:
      // bigint, symbol or function
      return String(value)
  }
}

function getDefaultConfig(pluginName: string): PluginConfig {
  const defaults: Record<string, PluginConfig | undefined> = {
    '@kysera/soft-delete': {
      enabled: true,
      column: 'deleted_at',
      filterDeleted: true,
      paranoid: true
    },
    '@kysera/timestamps': {
      enabled: true,
      createdColumn: 'created_at',
      updatedColumn: 'updated_at',
      touchOnUpdate: true
    },
    '@kysera/audit': {
      enabled: true,
      tableName: 'audit_logs',
      includeMetadata: true,
      logLevel: 'info',
      excludeTables: [],
      includeOldValues: true,
      includeNewValues: true
    },
    '@kysera/cache': {
      enabled: true,
      backend: 'memory',
      ttl: 3600,
      maxSize: 1000,
      keyPrefix: 'kysera:',
      invalidateOnUpdate: true
    },
    '@kysera/validation': {
      enabled: true,
      provider: 'zod',
      strict: true,
      abortEarly: false,
      stripUnknown: true
    }
  }

  return defaults[pluginName] ?? { enabled: false }
}

function getConfigSchema(pluginName: string): ConfigSchema {
  const schemas: Record<string, ConfigSchema | undefined> = {
    '@kysera/soft-delete': {
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Enable/disable plugin',
          default: true
        },
        column: {
          type: 'string',
          description: 'Column name for soft delete timestamp',
          default: 'deleted_at'
        },
        filterDeleted: {
          type: 'boolean',
          description: 'Automatically filter deleted records',
          default: true
        },
        paranoid: {
          type: 'boolean',
          description: 'Prevent hard deletes',
          default: true
        }
      }
    },
    '@kysera/timestamps': {
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Enable/disable plugin',
          default: true
        },
        createdColumn: {
          type: 'string',
          description: 'Column name for created timestamp',
          default: 'created_at'
        },
        updatedColumn: {
          type: 'string',
          description: 'Column name for updated timestamp',
          default: 'updated_at'
        },
        touchOnUpdate: {
          type: 'boolean',
          description: 'Update timestamp on record update',
          default: true
        }
      }
    },
    '@kysera/audit': {
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Enable/disable plugin',
          default: true
        },
        tableName: {
          type: 'string',
          description: 'Table name for audit logs',
          default: 'audit_logs'
        },
        includeMetadata: {
          type: 'boolean',
          description: 'Include metadata in audit logs',
          default: true
        },
        logLevel: {
          type: 'string',
          description: 'Logging level',
          enum: ['debug', 'info', 'warn', 'error'],
          default: 'info'
        },
        excludeTables: {
          type: 'array',
          description: 'Tables to exclude from auditing',
          default: []
        }
      }
    },
    '@kysera/cache': {
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Enable/disable plugin',
          default: true
        },
        backend: {
          type: 'string',
          description: 'Cache backend',
          enum: ['memory', 'redis', 'memcached'],
          default: 'memory'
        },
        ttl: {
          type: 'number',
          description: 'Time to live in seconds',
          default: 3600,
          min: 0
        },
        maxSize: {
          type: 'number',
          description: 'Maximum cache entries',
          default: 1000,
          min: 1
        }
      }
    }
  }

  return schemas[pluginName] ?? { properties: {} }
}

function validateConfig(config: PluginConfig, schema: ConfigSchema): string[] {
  const errors: string[] = []

  for (const [key, spec] of Object.entries(schema.properties)) {
    const value: unknown = config[key]

    // Check required fields
    if (spec.required && value === undefined) {
      errors.push(`Missing required field: ${key}`)
      continue
    }

    if (value === undefined) {
      continue
    }

    // Type validation
    const actualType = Array.isArray(value) ? 'array' : typeof value

    if (actualType !== spec.type) {
      errors.push(`${key}: expected ${spec.type}, got ${actualType}`)
    }

    // Enum validation
    if (spec.enum && !spec.enum.includes(value)) {
      errors.push(`${key}: must be one of [${spec.enum.join(', ')}]`)
    }

    // Range validation (loose comparison, matching the historical behavior
    // for non-number values that already failed type validation above)
    if (spec.type === 'number') {
      const numValue = value as number
      if (spec.min !== undefined && numValue < spec.min) {
        errors.push(`${key}: must be >= ${spec.min}`)
      }
      if (spec.max !== undefined && numValue > spec.max) {
        errors.push(`${key}: must be <= ${spec.max}`)
      }
    }
  }

  return errors
}

async function editConfigInteractive(
  pluginName: string,
  config: PluginConfig,
  pluginsRecord: PluginsRecord,
  fullConfig: KyseraConfig,
  options: ConfigPluginOptions
): Promise<void> {
  const schema = getConfigSchema(pluginName)

  console.log('')
  console.log(prism.bold(`🔧 Configure ${pluginName}`))
  console.log(prism.gray('─'.repeat(50)))

  const updatedConfig: PluginConfig = { ...config }

  for (const [key, spec] of Object.entries(schema.properties)) {
    if (key === 'enabled') continue // Skip enabled field

    console.log('')
    console.log(prism.cyan(key))
    if (spec.description) {
      console.log(prism.gray(`  ${spec.description}`))
    }

    const currentValue: unknown = config[key] ?? spec.default

    if (spec.type === 'boolean') {
      const newValue = await confirm({
        message: `${key} (current: ${String(currentValue)}):`,
        initialValue: currentValue as boolean | undefined
      })
      updatedConfig[key] = newValue
    } else if (spec.enum) {
      const newValue = await select({
        message: `${key}:`,
        options: spec.enum.map(v => ({
          label: String(v),
          value: v,
          hint: v === currentValue ? '(current)' : undefined
        }))
      })
      updatedConfig[key] = newValue
    } else if (spec.type === 'number') {
      const prompt =
        spec.min !== undefined && spec.max !== undefined
          ? `${key} (${spec.min}-${spec.max}):`
          : spec.min !== undefined
            ? `${key} (>=${spec.min}):`
            : spec.max !== undefined
              ? `${key} (<=${spec.max}):`
              : `${key}:`

      const newValue = await text({ message: prompt, defaultValue: String(currentValue) })
      const parsed = parseFloat(newValue as string)

      if (!isNaN(parsed)) {
        updatedConfig[key] = parsed
      }
    } else if (spec.type === 'array') {
      const currentStr = Array.isArray(currentValue) ? currentValue.join(', ') : ''

      const newValue = await text({
        message: `${key} (comma-separated):`,
        defaultValue: currentStr
      })

      updatedConfig[key] = (newValue as string)
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
    } else {
      const newValue = await text({
        message: `${key}:`,
        defaultValue: typeof currentValue === 'string' ? currentValue : ''
      })
      updatedConfig[key] = newValue
    }
  }

  // Validate configuration
  const errors = validateConfig(updatedConfig, schema)

  if (errors.length > 0) {
    console.log('')
    console.log(prism.red('❌ Validation errors:'))
    for (const error of errors) {
      console.log(`  • ${error}`)
    }

    const shouldSave = await confirm({ message: 'Save anyway?' })
    if (!shouldSave) {
      console.log(prism.gray('Configuration not saved'))
      return
    }
  }

  // Save configuration
  pluginsRecord[pluginName] = updatedConfig
  await saveConfig(fullConfig, options.config)

  console.log('')
  console.log(prism.green('✅ Configuration saved'))
}

async function exportPluginConfig(
  pluginName: string,
  config: PluginConfig,
  filename: string
): Promise<void> {
  const exportData = {
    plugin: pluginName,
    version: '1.0',
    timestamp: new Date().toISOString(),
    config
  }

  const ext = path.extname(filename).toLowerCase()

  let content: string
  if (ext === '.yaml' || ext === '.yml') {
    content = yaml.dump(exportData)
  } else {
    content = JSON.stringify(exportData, null, 2)
  }

  await fs.writeFile(filename, content, 'utf-8')
}

interface PluginConfigImport {
  plugin?: string
  version?: string
  timestamp?: string
  config?: PluginConfig
}

async function importPluginConfig(filename: string, config: KyseraConfig): Promise<void> {
  const content = await fs.readFile(filename, 'utf-8')
  const ext = path.extname(filename).toLowerCase()

  let importData: PluginConfigImport
  if (ext === '.yaml' || ext === '.yml') {
    importData = yaml.load(content) as PluginConfigImport
  } else {
    importData = JSON.parse(content) as PluginConfigImport
  }

  if (!importData.plugin || !importData.config) {
    throw new CLIError('Invalid import file format', 'IMPORT_ERROR', undefined, [
      'File must contain "plugin" and "config" fields'
    ])
  }

  config.plugins ??= {}

  ;(config.plugins as PluginsRecord)[importData.plugin] = importData.config
}

function displayPluginConfig(name: string, config: PluginConfig, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ [name]: config }, null, 2))
    return
  }

  console.log('')
  console.log(prism.bold(`🔧 ${name} Configuration`))
  console.log(prism.gray('─'.repeat(50)))

  console.log('')
  console.log(`Status: ${config.enabled ? prism.green('Enabled') : prism.yellow('Disabled')}`)

  const entries = Object.entries(config).filter(([key]) => key !== 'enabled')

  if (entries.length > 0) {
    console.log('')
    console.log(prism.cyan('Settings:'))

    for (const [key, value] of entries) {
      console.log(`  ${key}: ${formatValue(value)}`)
    }
  }

  console.log('')
  console.log(prism.cyan('Commands:'))
  console.log('  kysera plugin config <name> --edit     Edit interactively')
  console.log('  kysera plugin config <name> --reset    Reset to defaults')
  console.log('  kysera plugin config <name> --export   Export configuration')
  console.log('  kysera plugin config <name> --validate Validate configuration')
}
