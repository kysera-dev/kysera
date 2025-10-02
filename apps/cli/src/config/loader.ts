import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cosmiconfig } from 'cosmiconfig'
import { TypeScriptLoader } from 'cosmiconfig-typescript-loader'
import { KyseraConfigSchema, type KyseraConfig } from './schema.js'
import { mergeConfig, defaultConfig } from './defaults.js'
import { resolveConfigPaths, findConfigFile, validatePaths } from './resolver.js'
import { logger } from '../utils/logger.js'

/**
 * Load and validate Kysera configuration
 */
export async function loadConfig(configPath?: string): Promise<KyseraConfig> {
  let config: Partial<KyseraConfig> = {}
  let resolvedConfigPath: string

  if (configPath) {
    // Use specified config file
    resolvedConfigPath = resolve(process.cwd(), configPath)
    config = await loadConfigFile(resolvedConfigPath)
  } else {
    // Search for config file
    const foundPath = findConfigFile()
    if (foundPath) {
      resolvedConfigPath = foundPath
      config = await loadConfigFile(foundPath)
    } else {
      // No config file found, use defaults
      logger.debug('No configuration file found, using defaults')
      resolvedConfigPath = process.cwd()
    }
  }

  // Merge with defaults
  const merged = mergeConfig(config, defaultConfig)

  // Resolve paths and environment variables
  const resolved = resolveConfigPaths(merged, resolvedConfigPath)

  // Validate configuration
  const validation = KyseraConfigSchema.safeParse(resolved)
  if (!validation.success) {
    const errors = validation.error.errors.map(e => `  - ${e.path.join('.')}: ${e.message}`).join('\n')
    throw new Error(`Configuration validation failed:\n${errors}`)
  }

  // Validate paths exist
  const pathErrors = validatePaths(resolved)
  if (pathErrors.length > 0) {
    throw new Error(`Configuration path validation failed:\n  - ${pathErrors.join('\n  - ')}`)
  }

  return resolved
}

/**
 * Load configuration from a specific file
 */
async function loadConfigFile(filePath: string): Promise<Partial<KyseraConfig>> {
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
    if (!result || !result.config) {
      throw new Error(`No configuration found in ${filePath}`)
    }

    // Handle default export
    if (result.config.default) {
      return result.config.default
    }

    return result.config
  } catch (error: any) {
    throw new Error(`Failed to load configuration from ${filePath}: ${error.message}`)
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

  const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  return { valid: false, errors }
}

/**
 * Get configuration value by path
 */
export function getConfigValue(config: KyseraConfig, path: string): any {
  const keys = path.split('.')
  let value: any = config

  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key]
    } else {
      return undefined
    }
  }

  return value
}

/**
 * Set configuration value by path
 */
export function setConfigValue(config: KyseraConfig, path: string, value: any): void {
  const keys = path.split('.')
  const lastKey = keys.pop()

  if (!lastKey) return

  let obj: any = config
  for (const key of keys) {
    if (!(key in obj) || typeof obj[key] !== 'object') {
      obj[key] = {}
    }
    obj = obj[key]
  }

  obj[lastKey] = value
}