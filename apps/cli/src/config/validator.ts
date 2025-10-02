import { z, ZodError } from 'zod'
import type { KyseraConfig } from './schema.js'
import { KyseraConfigSchema } from './schema.js'

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface ValidationError {
  path: string
  message: string
  code: string
}

export interface ValidationWarning {
  path: string
  message: string
  suggestion?: string
}

/**
 * Validate configuration with detailed error reporting
 */
export function validateConfiguration(config: unknown): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  try {
    // Parse with Zod
    KyseraConfigSchema.parse(config)
  } catch (error) {
    if (error instanceof ZodError) {
      for (const issue of error.errors) {
        errors.push({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code
        })
      }
    } else {
      errors.push({
        path: '',
        message: 'Unknown validation error',
        code: 'UNKNOWN'
      })
    }
  }

  // Additional validation and warnings
  if (config && typeof config === 'object') {
    const cfg = config as Partial<KyseraConfig>

    // Check database configuration
    if (!cfg.database?.connection) {
      warnings.push({
        path: 'database.connection',
        message: 'No database connection configured',
        suggestion: 'Set DATABASE_URL environment variable or add database.connection to config'
      })
    }

    // Check for deprecated options or patterns
    checkDeprecations(cfg, warnings)

    // Check for best practices
    checkBestPractices(cfg, warnings)

    // Check for security concerns
    checkSecurity(cfg, warnings)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

/**
 * Check for deprecated configuration options
 */
function checkDeprecations(config: Partial<KyseraConfig>, warnings: ValidationWarning[]): void {
  // Example: Check for old plugin format
  if ('plugins' in config) {
    const plugins = config.plugins as any

    // Check if using old format (e.g., plugins as array)
    if (Array.isArray(plugins)) {
      warnings.push({
        path: 'plugins',
        message: 'Array format for plugins is deprecated',
        suggestion: 'Use object format with plugin names as keys'
      })
    }
  }
}

/**
 * Check for best practices
 */
function checkBestPractices(config: Partial<KyseraConfig>, warnings: ValidationWarning[]): void {
  // Warn if no migrations directory configured
  if (!config.migrations?.directory) {
    warnings.push({
      path: 'migrations.directory',
      message: 'No migrations directory configured',
      suggestion: 'Set migrations.directory to organize database migrations'
    })
  }

  // Warn if timestamps plugin not enabled
  if (!config.plugins?.timestamps?.enabled) {
    warnings.push({
      path: 'plugins.timestamps',
      message: 'Timestamps plugin is not enabled',
      suggestion: 'Enable timestamps plugin for automatic created_at/updated_at management'
    })
  }

  // Warn if audit plugin not enabled for production
  if (process.env.NODE_ENV === 'production' && !config.plugins?.audit?.enabled) {
    warnings.push({
      path: 'plugins.audit',
      message: 'Audit plugin is not enabled in production',
      suggestion: 'Consider enabling audit logging for production environments'
    })
  }

  // Warn about pool size
  if (config.database?.pool?.max && config.database.pool.max > 100) {
    warnings.push({
      path: 'database.pool.max',
      message: `Pool max connections (${config.database.pool.max}) is very high`,
      suggestion: 'Consider reducing pool size to avoid exhausting database connections'
    })
  }

  // Warn about slow query threshold
  if (config.health?.slowQueryThreshold && config.health.slowQueryThreshold > 1000) {
    warnings.push({
      path: 'health.slowQueryThreshold',
      message: `Slow query threshold (${config.health.slowQueryThreshold}ms) is very high`,
      suggestion: 'Consider lowering threshold to catch performance issues earlier'
    })
  }
}

/**
 * Check for security concerns
 */
function checkSecurity(config: Partial<KyseraConfig>, warnings: ValidationWarning[]): void {
  // Check for hardcoded credentials
  if (config.database?.connection && typeof config.database.connection === 'object') {
    const conn = config.database.connection

    if ('password' in conn && conn.password && !conn.password.includes('$')) {
      warnings.push({
        path: 'database.connection.password',
        message: 'Database password appears to be hardcoded',
        suggestion: 'Use environment variables for sensitive data (e.g., ${DB_PASSWORD})'
      })
    }
  }

  // Check for debug mode in production
  if (process.env.NODE_ENV === 'production' && config.database?.debug) {
    warnings.push({
      path: 'database.debug',
      message: 'Database debug mode is enabled in production',
      suggestion: 'Disable debug mode in production to avoid exposing sensitive data'
    })
  }

  // Check for verbose logging in production
  if (process.env.NODE_ENV === 'production' && config.logging?.level === 'debug') {
    warnings.push({
      path: 'logging.level',
      message: 'Debug logging is enabled in production',
      suggestion: 'Use "info" or "warn" level in production'
    })
  }

  // Check for query params logging
  if (process.env.NODE_ENV === 'production' && config.logging?.queries?.includeParams) {
    warnings.push({
      path: 'logging.queries.includeParams',
      message: 'Query parameters logging is enabled in production',
      suggestion: 'Disable parameter logging in production to avoid exposing sensitive data'
    })
  }
}

/**
 * Format validation result for display
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = []

  if (result.errors.length > 0) {
    lines.push('Configuration Errors:')
    for (const error of result.errors) {
      lines.push(`  ✗ ${error.path}: ${error.message}`)
    }
  }

  if (result.warnings.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('Configuration Warnings:')
    for (const warning of result.warnings) {
      lines.push(`  ⚠ ${warning.path}: ${warning.message}`)
      if (warning.suggestion) {
        lines.push(`    → ${warning.suggestion}`)
      }
    }
  }

  if (result.valid && result.warnings.length === 0) {
    lines.push('✓ Configuration is valid')
  }

  return lines.join('\n')
}