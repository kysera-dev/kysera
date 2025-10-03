import { resolve, dirname, isAbsolute } from 'node:path'
import { existsSync } from 'node:fs'
import type { KyseraConfig } from './schema.js'

/**
 * Resolve environment variables in a string
 */
export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/g, (match, p1, p2) => {
    const envVar = p1 || p2
    const envValue = process.env[envVar]
    if (envValue === undefined) {
      // Return original if env var not found
      return match
    }
    return envValue
  })
}

/**
 * Resolve a path relative to the config file
 */
export function resolvePath(path: string, configPath: string): string {
  // Resolve environment variables first
  const resolvedPath = resolveEnvVars(path)

  // If already absolute, return as-is
  if (isAbsolute(resolvedPath)) {
    return resolvedPath
  }

  // Resolve relative to config file directory
  const configDir = dirname(configPath)
  return resolve(configDir, resolvedPath)
}

/**
 * Resolve all paths in the configuration
 */
export function resolveConfigPaths(config: KyseraConfig, configPath: string): KyseraConfig {
  const resolved = { ...config }

  // Resolve migration paths
  if (resolved.migrations?.directory) {
    resolved.migrations.directory = resolvePath(resolved.migrations.directory, configPath)
  }
  if (resolved.migrations?.templates?.create) {
    resolved.migrations.templates.create = resolvePath(resolved.migrations.templates.create, configPath)
  }
  if (resolved.migrations?.templates?.table) {
    resolved.migrations.templates.table = resolvePath(resolved.migrations.templates.table, configPath)
  }

  // Resolve generate paths
  if (resolved.generate?.repositories) {
    resolved.generate.repositories = resolvePath(resolved.generate.repositories, configPath)
  }
  if (resolved.generate?.models) {
    resolved.generate.models = resolvePath(resolved.generate.models, configPath)
  }
  if (resolved.generate?.schemas) {
    resolved.generate.schemas = resolvePath(resolved.generate.schemas, configPath)
  }
  if (resolved.generate?.migrations) {
    resolved.generate.migrations = resolvePath(resolved.generate.migrations, configPath)
  }
  if (resolved.generate?.templates?.repository) {
    resolved.generate.templates.repository = resolvePath(resolved.generate.templates.repository, configPath)
  }
  if (resolved.generate?.templates?.model) {
    resolved.generate.templates.model = resolvePath(resolved.generate.templates.model, configPath)
  }
  if (resolved.generate?.templates?.schema) {
    resolved.generate.templates.schema = resolvePath(resolved.generate.templates.schema, configPath)
  }

  // Resolve testing paths
  if (resolved.testing?.seeds) {
    resolved.testing.seeds = resolvePath(resolved.testing.seeds, configPath)
  }
  if (resolved.testing?.fixtures) {
    resolved.testing.fixtures = resolvePath(resolved.testing.fixtures, configPath)
  }

  // Resolve logging paths
  if (resolved.logging?.destinations && Array.isArray(resolved.logging.destinations)) {
    resolved.logging.destinations = resolved.logging.destinations.map((dest) => {
      if (dest.type === 'file' && 'path' in dest) {
        return {
          ...dest,
          path: resolvePath(dest.path, configPath)
        }
      }
      return dest
    })
  }

  // Resolve database connection string if it contains env vars
  if (resolved.database?.connection && typeof resolved.database.connection === 'string') {
    resolved.database.connection = resolveEnvVars(resolved.database.connection)
  }

  // Resolve test database connection string if it contains env vars
  if (resolved.testing?.database && typeof resolved.testing.database === 'string') {
    resolved.testing.database = resolveEnvVars(resolved.testing.database)
  }

  return resolved
}

/**
 * Find config file by walking up the directory tree
 */
export function findConfigFile(startDir: string = process.cwd()): string | null {
  const configNames = [
    'kysera.config.ts',
    'kysera.config.js',
    'kysera.config.mjs',
    'kysera.config.cjs',
    'kysera.config.json',
    '.kyserarc.ts',
    '.kyserarc.js',
    '.kyserarc.json'
  ]

  let currentDir = startDir
  const root = resolve('/')

  while (currentDir !== root) {
    for (const configName of configNames) {
      const configPath = resolve(currentDir, configName)
      if (existsSync(configPath)) {
        return configPath
      }
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      break
    }
    currentDir = parentDir
  }

  // Check root directory
  for (const configName of configNames) {
    const configPath = resolve(root, configName)
    if (existsSync(configPath)) {
      return configPath
    }
  }

  return null
}

/**
 * Validate that required paths exist
 */
export function validatePaths(config: KyseraConfig): string[] {
  const errors: string[] = []

  // Don't validate during init command
  if (process.argv.includes('init')) {
    return errors
  }

  // Check if migration directory exists (warning only)
  if (config.migrations?.directory && !existsSync(config.migrations.directory)) {
    // This is just a warning, not an error
    console.warn(`Warning: Migration directory does not exist: ${config.migrations.directory}`)
  }

  // Check template files if specified
  if (config.migrations?.templates?.create && !existsSync(config.migrations.templates.create)) {
    errors.push(`Migration template not found: ${config.migrations.templates.create}`)
  }
  if (config.migrations?.templates?.table && !existsSync(config.migrations.templates.table)) {
    errors.push(`Migration template not found: ${config.migrations.templates.table}`)
  }

  if (config.generate?.templates?.repository && !existsSync(config.generate.templates.repository)) {
    errors.push(`Repository template not found: ${config.generate.templates.repository}`)
  }
  if (config.generate?.templates?.model && !existsSync(config.generate.templates.model)) {
    errors.push(`Model template not found: ${config.generate.templates.model}`)
  }
  if (config.generate?.templates?.schema && !existsSync(config.generate.templates.schema)) {
    errors.push(`Schema template not found: ${config.generate.templates.schema}`)
  }

  return errors
}