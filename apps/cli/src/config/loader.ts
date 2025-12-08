import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as fs from 'node:fs/promises';
import { cosmiconfig } from 'cosmiconfig';
import { TypeScriptLoader } from 'cosmiconfig-typescript-loader';
import { KyseraConfigSchema, type KyseraConfig } from './schema.js';
import { mergeConfig, defaultConfig } from './defaults.js';
import { resolveConfigPaths, findConfigFile, validatePaths } from './resolver.js';
import { logger } from '../utils/logger.js';
import { ConfigurationError, FileSystemError } from '../utils/errors.js';

/**
 * Load and validate Kysera configuration
 */
export async function loadConfig(configPath?: string): Promise<KyseraConfig> {
  let config: Partial<KyseraConfig> = {};
  let resolvedConfigPath: string;

  if (configPath) {
    // Use specified config file
    resolvedConfigPath = resolve(process.cwd(), configPath);
    config = await loadConfigFile(resolvedConfigPath);
  } else {
    // Search for config file
    const foundPath = findConfigFile();
    if (foundPath) {
      resolvedConfigPath = foundPath;
      config = await loadConfigFile(foundPath);
    } else {
      // No config file found, use defaults
      logger.debug('No configuration file found, using defaults');
      resolvedConfigPath = process.cwd();
    }
  }

  // Merge with defaults
  const merged = mergeConfig(config, defaultConfig);

  // Resolve paths and environment variables
  const resolved = resolveConfigPaths(merged, resolvedConfigPath);

  // Validate configuration
  const validation = KyseraConfigSchema.safeParse(resolved);
  if (!validation.success) {
    logger.debug('Validation failed:', validation.error);

    if (!validation.error || !validation.error.errors || !Array.isArray(validation.error.errors)) {
      throw new ConfigurationError(`Configuration validation failed: ${JSON.stringify(validation.error)}`);
    }

    const errors = validation.error.errors.map((e) => `  - ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new ConfigurationError(`Configuration validation failed:\n${errors}`);
  }

  // Validate paths exist
  const pathErrors = validatePaths(resolved);
  if (pathErrors.length > 0) {
    throw new ConfigurationError(`Configuration path validation failed:\n  - ${pathErrors.join('\n  - ')}`);
  }

  return resolved;
}

/**
 * Load configuration from a specific file
 */
async function loadConfigFile(filePath: string): Promise<Partial<KyseraConfig>> {
  // If it's a JSON file, load it directly
  if (filePath.endsWith('.json')) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as Partial<KyseraConfig>;
    } catch (error) {
      const err = error as Error;
      throw new FileSystemError(`Failed to load JSON configuration from ${filePath}: ${err.message}`);
    }
  }

  const explorer = cosmiconfig('kysera', {
    searchPlaces: [filePath],
    stopDir: resolve(filePath, '..'),
    loaders: {
      '.ts': TypeScriptLoader(),
      '.mts': TypeScriptLoader(),
      '.cts': TypeScriptLoader(),
    },
  });

  try {
    const result = await explorer.load(filePath);
    if (!result || !result.config) {
      throw new ConfigurationError(`No configuration found in ${filePath}`);
    }

    // Handle default export
    const config = result.config as { default?: Partial<KyseraConfig> } & Partial<KyseraConfig>;
    if (config.default) {
      return config.default;
    }

    return config;
  } catch (error) {
    const err = error as Error;
    throw new FileSystemError(`Failed to load configuration from ${filePath}: ${err.message}`);
  }
}

/**
 * Define configuration helper for TypeScript configs
 */
export function defineConfig(config: KyseraConfig): KyseraConfig {
  return config;
}

/**
 * Validate configuration without loading
 */
export function validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
  const result = KyseraConfigSchema.safeParse(config);

  if (result.success) {
    return { valid: true };
  }

  if (!result.error || !result.error.errors || !Array.isArray(result.error.errors)) {
    return { valid: false, errors: ['Validation failed'] };
  }

  const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
  return { valid: false, errors };
}

/**
 * Get configuration value by path
 */
export function getConfigValue(config: KyseraConfig, path: string): unknown {
  const keys = path.split('.');
  let value: unknown = config;

  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = (value as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * Set configuration value by path
 */
export function setConfigValue(config: KyseraConfig, path: string, value: unknown): void {
  const keys = path.split('.');
  const lastKey = keys.pop();

  if (!lastKey) return;

  let obj: Record<string, unknown> = config as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (!(key in obj) || typeof obj[key] !== 'object') {
      obj[key] = {};
    }
    obj = obj[key] as Record<string, unknown>;
  }

  obj[lastKey] = value;
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: KyseraConfig, configPath?: string): Promise<void> {
  // Find or use the specified config file path
  const resolvedPath = configPath
    ? resolve(process.cwd(), configPath)
    : findConfigFile() || resolve(process.cwd(), 'kysera.config.json');

  // Validate configuration before saving
  const validation = KyseraConfigSchema.safeParse(config);
  if (!validation.success) {
    if (!validation.error || !validation.error.errors || !Array.isArray(validation.error.errors)) {
      throw new ConfigurationError(`Configuration validation failed: ${JSON.stringify(validation.error)}`);
    }

    const errors = validation.error.errors.map((e) => `  - ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new ConfigurationError(`Configuration validation failed:\n${errors}`);
  }

  // Determine file format from extension
  const ext = resolvedPath.split('.').pop()?.toLowerCase();

  let content: string;
  if (ext === 'json') {
    content = JSON.stringify(config, null, 2);
  } else if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    content = `module.exports = ${JSON.stringify(config, null, 2)};`;
  } else if (ext === 'ts' || ext === 'mts' || ext === 'cts') {
    content = `import { defineConfig } from '@kysera/cli';\n\nexport default defineConfig(${JSON.stringify(config, null, 2)});`;
  } else {
    // Default to JSON format
    content = JSON.stringify(config, null, 2);
  }

  // Write the configuration file
  await fs.writeFile(resolvedPath, content, 'utf-8');

  logger.debug(`Configuration saved to ${resolvedPath}`);
}
