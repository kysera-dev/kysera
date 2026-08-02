import { resolve, join } from 'node:path'
import * as fs from 'node:fs/promises'
import { KyseraConfigSchema, type KyseraConfig } from './schema.js'
import { mergeConfig, defaultConfig } from './defaults.js'
import { resolveConfigPaths, findConfigFile, validatePaths } from './resolver.js'
import { logger } from '../utils/logger.js'
import { ConfigurationError, FileSystemError } from '../utils/errors.js'

/**
 * Configuration cache: a CLI invocation loads its configuration exactly
 * once per resolved location (root --config is propagated into
 * subcommand options, so all loads in one invocation share a key).
 */
const configCache = new Map<string, KyseraConfig>()

/** Clear the config cache (used by tests). */
export function clearConfigCache(): void {
  configCache.clear()
}

/**
 * Detect a database dialect from a connection URL.
 */
function dialectFromConnectionUrl(url: string): 'postgres' | 'mysql' | 'sqlite' | undefined {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return 'postgres'
  if (url.startsWith('mysql://') || url.startsWith('mysql2://')) return 'mysql'
  if (url.startsWith('sqlite://') || url.endsWith('.db') || url.endsWith('.sqlite')) return 'sqlite'
  return undefined
}

/**
 * Apply environment overrides. Precedence contract:
 * flags > environment > .env (loaded into env, never overriding) >
 * config file > defaults.
 *
 * DATABASE_URL overrides the connection from the config file.
 */
function applyEnvOverrides(config: KyseraConfig): KyseraConfig {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return config

  const dialect = config.database?.dialect ?? dialectFromConnectionUrl(databaseUrl)
  if (!dialect) {
    throw new ConfigurationError(`Could not detect database dialect from DATABASE_URL`, [
      'Use a connection string with a protocol (postgres://, mysql://, sqlite://)',
      'Or set database.dialect in your configuration file'
    ])
  }

  const base: NonNullable<KyseraConfig['database']> = config.database ?? {
    dialect,
    debug: false
  }
  return {
    ...config,
    database: { ...base, connection: databaseUrl, dialect }
  }
}

/**
 * Load and validate Kysera configuration.
 *
 * Resolution order for the file: explicit path (subcommand -c/--config or
 * root --config, which is propagated) > KYSERA_CONFIG env > search from
 * the working directory upward > built-in defaults.
 */
export async function loadConfig(configPath?: string): Promise<KyseraConfig> {
  const requestedPath = configPath ?? process.env.KYSERA_CONFIG

  let config: Partial<KyseraConfig> = {}
  let resolvedConfigPath: string
  let cacheKey: string

  if (requestedPath) {
    // Use specified config file
    resolvedConfigPath = resolve(process.cwd(), requestedPath)
    cacheKey = resolvedConfigPath
  } else {
    const foundPath = findConfigFile()
    if (foundPath) {
      resolvedConfigPath = foundPath
      cacheKey = foundPath
    } else {
      // No config file found: use defaults, anchored at the working
      // directory (paths resolve relative to dirname of this value).
      logger.debug('No configuration file found, using defaults')
      resolvedConfigPath = join(process.cwd(), 'kysera.config.json')
      cacheKey = `defaults:${process.cwd()}`
    }
  }

  const cached = configCache.get(cacheKey)
  if (cached) {
    return cached
  }

  if (requestedPath) {
    config = await loadConfigFile(resolvedConfigPath)
  } else if (!cacheKey.startsWith('defaults:')) {
    config = await loadConfigFile(resolvedConfigPath)
  }

  // Merge with defaults
  const merged = mergeConfig(config, defaultConfig)

  // Resolve paths and environment variables
  const resolved = applyEnvOverrides(resolveConfigPaths(merged, resolvedConfigPath))

  // Validate configuration
  const validation = KyseraConfigSchema.safeParse(resolved)
  if (!validation.success) {
    logger.debug('Validation failed:', validation.error)

    const errors = validation.error.issues
      .map(e => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n')
    throw new ConfigurationError(`Configuration validation failed:\n${errors}`)
  }

  // Validate paths exist
  const pathErrors = validatePaths(resolved)
  if (pathErrors.length > 0) {
    throw new ConfigurationError(
      `Configuration path validation failed:\n  - ${pathErrors.join('\n  - ')}`
    )
  }

  configCache.set(cacheKey, resolved)
  return resolved
}

/**
 * Load configuration from a specific file
 */
async function loadConfigFile(filePath: string): Promise<Partial<KyseraConfig>> {
  // If it's a JSON file, load it directly
  if (filePath.endsWith('.json')) {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(content) as Partial<KyseraConfig>
    } catch (error) {
      const err = error as Error
      throw new FileSystemError(
        `Failed to load JSON configuration from ${filePath}: ${err.message}`
      )
    }
  }

  const [{ cosmiconfig }, { TypeScriptLoader }] = await Promise.all([
    import('cosmiconfig'),
    import('cosmiconfig-typescript-loader')
  ])

  const explorer = cosmiconfig('kysera', {
    searchPlaces: [filePath],
    stopDir: resolve(filePath, '..'),
    loaders: {
      '.ts': TypeScriptLoader(),
      '.mts': TypeScriptLoader(),
      '.cts': TypeScriptLoader()
    }
  })

  try {
    const result = await explorer.load(filePath)
    if (!result?.config) {
      throw new ConfigurationError(`No configuration found in ${filePath}`)
    }

    // Handle default export
    const config = result.config as { default?: Partial<KyseraConfig> } & Partial<KyseraConfig>
    if (config.default) {
      return config.default
    }

    return config
  } catch (error) {
    const err = error as Error
    throw new FileSystemError(`Failed to load configuration from ${filePath}: ${err.message}`)
  }
}

/**
 * Define configuration helper for TypeScript configs
 */
export function defineConfig(config: KyseraConfig): KyseraConfig {
  return config
}

/**
 * Validate configuration without loading
 */
export function validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
  const result = KyseraConfigSchema.safeParse(config)

  if (result.success) {
    return { valid: true }
  }

  const errors = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`)
  return { valid: false, errors }
}

/**
 * Get configuration value by path
 */
export function getConfigValue(config: KyseraConfig, path: string): unknown {
  const keys = path.split('.')
  let value: unknown = config

  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = (value as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }

  return value
}

/**
 * Set configuration value by path
 */
export function setConfigValue(config: KyseraConfig, path: string, value: unknown): void {
  const keys = path.split('.')
  const lastKey = keys.pop()

  if (!lastKey) return

  let obj: Record<string, unknown> = config
  for (const key of keys) {
    if (!(key in obj) || typeof obj[key] !== 'object') {
      obj[key] = {}
    }
    obj = obj[key] as Record<string, unknown>
  }

  obj[lastKey] = value
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: KyseraConfig, configPath?: string): Promise<void> {
  // Find or use the specified config file path
  const resolvedPath = configPath
    ? resolve(process.cwd(), configPath)
    : (findConfigFile() ?? resolve(process.cwd(), 'kysera.config.json'))

  // Validate configuration before saving
  const validation = KyseraConfigSchema.safeParse(config)
  if (!validation.success) {
    const errors = validation.error.issues
      .map(e => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n')
    throw new ConfigurationError(`Configuration validation failed:\n${errors}`)
  }

  // Determine file format from extension
  const ext = resolvedPath.split('.').pop()?.toLowerCase()

  let content: string
  if (ext === 'json') {
    content = JSON.stringify(config, null, 2)
  } else if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    content = `module.exports = ${JSON.stringify(config, null, 2)};`
  } else if (ext === 'ts' || ext === 'mts' || ext === 'cts') {
    content = `import { defineConfig } from '@kysera/cli';\n\nexport default defineConfig(${JSON.stringify(config, null, 2)});`
  } else {
    // Default to JSON format
    content = JSON.stringify(config, null, 2)
  }

  // Write the configuration file
  await fs.writeFile(resolvedPath, content, 'utf-8')

  logger.debug(`Configuration saved to ${resolvedPath}`)
}
