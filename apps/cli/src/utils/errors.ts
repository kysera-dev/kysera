import { prism } from '@xec-sh/kit'
import {
  ErrorCodes,
  DatabaseErrorCodes,
  ValidationErrorCodes,
  ConfigErrorCodes,
  FileSystemErrorCodes,
  NetworkErrorCodes,
  MigrationErrorCodes,
  PluginErrorCodes,
  parseDatabaseError
} from '@kysera/core'
import { isJsonMode, isVerboseMode } from './output.js'

/**
 * CLI Error Codes mapping to unified @kysera/core ErrorCodes
 *
 * This provides a consistent error code system across the entire Kysera ecosystem.
 */
export const CLIErrorCodes = {
  // CLI-specific codes
  CLI_ERROR: 'CLI_ERROR',
  ASSERTION_ERROR: 'ASSERTION_ERROR',

  // Database codes (mapped from @kysera/core)
  DATABASE_ERROR: DatabaseErrorCodes.DB_QUERY_FAILED,
  DB_CONNECTION_ERROR: DatabaseErrorCodes.DB_CONNECTION_FAILED,

  // Config codes (mapped from @kysera/core)
  CONFIG_ERROR: ConfigErrorCodes.CONFIG_VALIDATION_FAILED,
  CONFIG_NOT_FOUND: ConfigErrorCodes.CONFIG_NOT_FOUND,
  CONFIG_INVALID: ConfigErrorCodes.CONFIG_INVALID_VALUE,

  // Validation codes (mapped from @kysera/core)
  VALIDATION_ERROR: ValidationErrorCodes.VALIDATION_INVALID_INPUT,

  // File system codes (mapped from @kysera/core)
  FS_ERROR: FileSystemErrorCodes.FS_READ_FAILED,
  FILE_NOT_FOUND: FileSystemErrorCodes.FS_FILE_NOT_FOUND,
  DIR_NOT_FOUND: FileSystemErrorCodes.FS_DIRECTORY_NOT_FOUND,
  PERMISSION_DENIED: FileSystemErrorCodes.FS_PERMISSION_DENIED,

  // Network codes (mapped from @kysera/core)
  NETWORK_ERROR: NetworkErrorCodes.NETWORK_CONNECTION_REFUSED,
  TIMEOUT_ERROR: NetworkErrorCodes.NETWORK_TIMEOUT,

  // Migration codes (mapped from @kysera/core)
  MIGRATION_FAILED: MigrationErrorCodes.MIGRATION_UP_FAILED,
  MIGRATION_NOT_FOUND: MigrationErrorCodes.MIGRATION_NOT_FOUND,

  // Plugin codes (mapped from @kysera/core)
  PLUGIN_ERROR: PluginErrorCodes.PLUGIN_VALIDATION_FAILED,
  PLUGIN_NOT_FOUND: PluginErrorCodes.PLUGIN_NOT_FOUND
} as const

// Codes come from the CLIErrorCodes map but ad-hoc codes are allowed too,
// so the public type is plain string.
export type CLIErrorCode = string

export class CLIError extends Error {
  constructor(
    message: string,
    public readonly code: CLIErrorCode = CLIErrorCodes.CLI_ERROR,
    public readonly details?: unknown,
    public readonly suggestions: string[] = []
  ) {
    super(message)
    this.name = 'CLIError'
    Error.captureStackTrace(this, this.constructor)
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      suggestions: this.suggestions
    }
  }
}

export class ConfigurationError extends CLIError {
  constructor(message: string, suggestions: string[] = []) {
    super(message, CLIErrorCodes.CONFIG_ERROR, undefined, suggestions)
    this.name = 'ConfigurationError'
  }
}

export class CLIDatabaseError extends CLIError {
  constructor(message: string, suggestions: string[] = []) {
    super(message, CLIErrorCodes.DATABASE_ERROR, undefined, suggestions)
    this.name = 'CLIDatabaseError'
  }
}

// Alias for backward compatibility
export const DatabaseError = CLIDatabaseError

export class ValidationError extends CLIError {
  constructor(
    message: string,
    public readonly errors: string[] = []
  ) {
    super(message, CLIErrorCodes.VALIDATION_ERROR, { errors })
    this.name = 'ValidationError'
  }
}

export class FileSystemError extends CLIError {
  constructor(
    message: string,
    code: CLIErrorCode = CLIErrorCodes.FS_ERROR,
    suggestions: string[] = [],
    public readonly path?: string
  ) {
    super(message, code, path ? { path } : undefined, suggestions)
    this.name = 'FileSystemError'
  }
}

export class NetworkError extends CLIError {
  constructor(
    message: string,
    public readonly url?: string
  ) {
    super(message, CLIErrorCodes.NETWORK_ERROR, url ? { url } : undefined)
    this.name = 'NetworkError'
  }
}

export interface ErrorCodeInfo {
  code: string
  message: string
  suggestions?: string[]
}

/**
 * Legacy error codes mapping to unified codes
 * Maintained for backward compatibility
 */
export const ERROR_CODES: Record<string, ErrorCodeInfo> = {
  // Database errors - mapped to unified codes
  E001: {
    code: ErrorCodes.DB_CONNECTION_FAILED,
    message: 'Database connection failed',
    suggestions: [
      'Check your database connection string',
      'Verify the database server is running',
      'Check network connectivity',
      'Verify credentials are correct'
    ]
  },
  E002: {
    code: ErrorCodes.MIGRATION_UP_FAILED,
    message: 'Migration failed',
    suggestions: [
      'Review the migration file for errors',
      'Check if migration was already executed',
      'Run "kysera migrate status" to verify state',
      'Use "kysera migrate down" to rollback if needed'
    ]
  },
  E003: {
    code: ErrorCodes.CONFIG_VALIDATION_FAILED,
    message: 'Configuration error',
    suggestions: [
      'Check your kysera.config.ts file',
      'Run "kysera config validate" to check configuration',
      'Ensure all required fields are provided'
    ]
  },
  E004: {
    code: ErrorCodes.PLUGIN_VALIDATION_FAILED,
    message: 'Plugin error',
    suggestions: [
      'Check plugin configuration',
      'Verify plugin is properly installed',
      'Check plugin compatibility with current version'
    ]
  },
  E005: {
    code: ErrorCodes.FS_WRITE_FAILED,
    message: 'Generation error',
    suggestions: [
      'Verify template files exist',
      'Check write permissions for output directory',
      'Ensure database connection for introspection'
    ]
  }
}

/**
 * Get unified error code from legacy code
 */
export function getUnifiedErrorCode(legacyCode: string): string {
  // Record lookup can miss at runtime (tsconfig has noUncheckedIndexedAccess off)
  const errorInfo = ERROR_CODES[legacyCode] as ErrorCodeInfo | undefined
  return errorInfo?.code ?? legacyCode
}

/**
 * Single error surface for the CLI. Formats the error for humans (or as
 * JSON on stderr in --json mode) and exits with code 1.
 */
export function handleError(error: unknown): never {
  if (isJsonMode()) {
    process.stderr.write(`${JSON.stringify({ error: serializeError(error) }, null, 2)}\n`)
    process.exit(1)
  }

  if (error instanceof CLIError) {
    handleCLIError(error)
  } else if (error instanceof Error) {
    handleGenericError(error)
  } else {
    handleUnknownError(error)
  }
  process.exit(1)
}

/**
 * Serialize any error into a stable JSON payload.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof CLIError) {
    const payload: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      code: error.code
    }
    if (error.details !== undefined) payload.details = error.details
    if (error.suggestions.length > 0) payload.suggestions = error.suggestions
    if (isVerboseMode() && error.stack) payload.stack = error.stack
    return payload
  }
  if (error instanceof Error) {
    const payload: Record<string, unknown> = { name: error.name, message: error.message }
    const hints = databaseHints(error)
    if (hints.length > 0) payload.suggestions = hints
    if (isVerboseMode() && error.stack) payload.stack = error.stack
    return payload
  }
  return { name: 'UnknownError', message: String(error) }
}

function handleCLIError(error: CLIError): void {
  const output: string[] = []
  output.push('')
  output.push(prism.red(`✗ ${error.message}`))

  if (error.code) {
    output.push('')
    output.push(prism.gray(`Error code: ${error.code}`))
  }

  if (error instanceof ValidationError && error.errors.length > 0) {
    output.push('')
    output.push('Validation errors:')
    for (const err of error.errors) {
      output.push(`  • ${err}`)
    }
  }

  if (error.suggestions.length > 0) {
    output.push('')
    output.push('Suggestions:')
    for (const suggestion of error.suggestions) {
      output.push(prism.yellow(`  → ${suggestion}`))
    }
  }

  const isVerbose = isVerboseMode()
  if (isVerbose && error.details) {
    output.push('')
    output.push('Details:')
    output.push(JSON.stringify(error.details, null, 2))
  }

  if (isVerbose && error.stack) {
    output.push('')
    output.push(prism.gray('Stack trace:'))
    output.push(prism.gray(error.stack))
  }

  output.push('')
  output.push(prism.gray(`Need help? Run 'kysera help' or visit https://kysera.dev/docs`))

  const errorMessage = output.join('\n')
  console.error(errorMessage)
}

function handleGenericError(error: Error): void {
  const output: string[] = []
  output.push('')
  output.push(prism.red(`✗ ${error.message}`))

  // Try to provide helpful suggestions based on error message
  const suggestions = [...databaseHints(error), ...getSuggestionsFromError(error)]
  if (suggestions.length > 0) {
    output.push('')
    output.push('Suggestions:')
    for (const suggestion of suggestions) {
      output.push(prism.yellow(`  → ${suggestion}`))
    }
  }

  const isVerbose = isVerboseMode()
  if (isVerbose && error.stack) {
    output.push('')
    output.push(prism.gray('Stack trace:'))
    output.push(prism.gray(error.stack))
  }

  output.push('')
  output.push(
    prism.gray(`This might be a bug. Please report it at https://github.com/kysera/kysera/issues`)
  )

  console.error(output.join('\n'))
}

function handleUnknownError(error: unknown): void {
  const output: string[] = []
  output.push('')
  output.push(prism.red('✗ An unexpected error occurred'))
  output.push('')
  output.push(String(error))
  output.push('')
  output.push(
    prism.gray(`This is likely a bug. Please report it at https://github.com/kysera/kysera/issues`)
  )

  console.error(output.join('\n'))
}

function getSuggestionsFromError(error: Error): string[] {
  const suggestions: string[] = []
  const message = error.message.toLowerCase()

  if (message.includes('enoent') || message.includes('no such file')) {
    suggestions.push('Check if the file or directory exists')
    suggestions.push('Verify the path is correct')
  } else if (message.includes('eacces') || message.includes('permission')) {
    suggestions.push('Check file/directory permissions')
    suggestions.push('Try running with appropriate permissions')
  } else if (message.includes('econnrefused')) {
    suggestions.push('Check if the service is running')
    suggestions.push('Verify the connection details')
  } else if (message.includes('timeout')) {
    suggestions.push('Check network connectivity')
    suggestions.push('Increase timeout settings if needed')
  } else if (message.includes('module not found')) {
    suggestions.push('Run "npm install" to install dependencies')
    suggestions.push('Check if the module is listed in package.json')
  }

  return suggestions
}

/**
 * Best-effort dialect detection from a raw driver error, used to run it
 * through @kysera/core's parseDatabaseError for a human-readable hint.
 */
function guessErrorDialect(error: Error): 'postgres' | 'mysql' | 'sqlite' | null {
  const raw = error as Error & {
    code?: unknown
    errno?: unknown
    sqlState?: unknown
    severity?: unknown
  }
  if (typeof raw.message === 'string' && raw.message.includes('SQLITE_')) {
    return 'sqlite'
  }
  if (raw.sqlState !== undefined || typeof raw.errno === 'number') {
    return 'mysql'
  }
  if (
    typeof raw.severity === 'string' ||
    (typeof raw.code === 'string' && /^[0-9A-Z]{5}$/.test(raw.code))
  ) {
    return 'postgres'
  }
  return null
}

/**
 * Dialect-aware hints for raw database driver errors.
 */
function databaseHints(error: Error): string[] {
  const dialect = guessErrorDialect(error)
  if (!dialect) return []
  try {
    const parsed = parseDatabaseError(error, dialect)
    if (
      parsed.code !== ErrorCodes.DB_UNKNOWN &&
      parsed.message &&
      parsed.message !== error.message
    ) {
      return [parsed.message]
    }
  } catch {
    // Hints are best-effort only
  }
  return []
}

/**
 * Assert a condition and throw if false
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new CLIError(message, 'ASSERTION_ERROR')
  }
}

/**
 * Format error for display
 */
export function formatError(error: unknown): string {
  const lines: string[] = []

  if (error instanceof CLIError) {
    lines.push(error.message)
    lines.push(error.code)

    if (error.details !== undefined && error.details !== null) {
      if (typeof error.details === 'object') {
        for (const value of Object.values(error.details)) {
          lines.push(stringifyValue(value))
        }
      } else {
        lines.push(stringifyValue(error.details))
      }
    }

    if (error.suggestions.length > 0) {
      lines.push(...error.suggestions)
    }
  } else if (error instanceof Error) {
    lines.push(error.message)
  } else if (error === null || error === undefined) {
    lines.push('Unknown error')
  } else {
    lines.push(stringifyValue(error))
  }

  return lines.join('\n')
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value)
    } catch {
      return '[object]'
    }
  }
  return String(value)
}

/**
 * Check if an error matches expected patterns
 * @param error - The error to check
 * @param patterns - Array of string patterns to match against (case-insensitive)
 * @returns true if the error message contains any of the patterns
 */
export function isExpectedError(error: unknown, patterns: string[]): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return patterns.some(pattern => message.toLowerCase().includes(pattern.toLowerCase()))
}
