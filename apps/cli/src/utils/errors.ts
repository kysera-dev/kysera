import { prism } from '@xec-sh/kit'
import { logger } from './logger.js'

export class CLIError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'CLI_ERROR',
    public readonly details?: any,
    public readonly suggestions: string[] = []
  ) {
    super(message)
    this.name = 'CLIError'
    Error.captureStackTrace(this, this.constructor)
  }
}

export class ConfigurationError extends CLIError {
  constructor(message: string, suggestions: string[] = []) {
    super(message, 'CONFIG_ERROR', undefined, suggestions)
    this.name = 'ConfigurationError'
  }
}

export class DatabaseError extends CLIError {
  constructor(message: string, suggestions: string[] = []) {
    super(message, 'DATABASE_ERROR', undefined, suggestions)
    this.name = 'DatabaseError'
  }
}

export class ValidationError extends CLIError {
  constructor(message: string, public readonly errors: string[] = []) {
    super(message, 'VALIDATION_ERROR', { errors })
    this.name = 'ValidationError'
  }
}

export class FileSystemError extends CLIError {
  constructor(message: string, public readonly path?: string) {
    super(message, 'FS_ERROR', path ? { path } : undefined)
    this.name = 'FileSystemError'
  }
}

export class NetworkError extends CLIError {
  constructor(message: string, public readonly url?: string) {
    super(message, 'NETWORK_ERROR', url ? { url } : undefined)
    this.name = 'NetworkError'
  }
}

export interface ErrorCode {
  code: string
  message: string
  suggestions?: string[]
}

export const ERROR_CODES: Record<string, ErrorCode> = {
  // Database errors
  E001: {
    code: 'E001',
    message: 'Database connection failed',
    suggestions: [
      'Check your database connection string',
      'Verify the database server is running',
      'Check network connectivity',
      'Verify credentials are correct'
    ]
  },
  E002: {
    code: 'E002',
    message: 'Migration failed',
    suggestions: [
      'Review the migration file for errors',
      'Check if migration was already executed',
      'Run "kysera migrate status" to verify state',
      'Use "kysera migrate down" to rollback if needed'
    ]
  },
  E003: {
    code: 'E003',
    message: 'Configuration error',
    suggestions: [
      'Check your kysera.config.ts file',
      'Run "kysera config validate" to check configuration',
      'Ensure all required fields are provided'
    ]
  },
  E004: {
    code: 'E004',
    message: 'Plugin error',
    suggestions: [
      'Check plugin configuration',
      'Verify plugin is properly installed',
      'Check plugin compatibility with current version'
    ]
  },
  E005: {
    code: 'E005',
    message: 'Generation error',
    suggestions: [
      'Verify template files exist',
      'Check write permissions for output directory',
      'Ensure database connection for introspection'
    ]
  }
}

export function handleError(error: unknown): void {
  if (error instanceof CLIError) {
    handleCLIError(error)
  } else if (error instanceof Error) {
    handleGenericError(error)
  } else {
    handleUnknownError(error)
  }
  process.exit(1)
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

  if (error.suggestions && error.suggestions.length > 0) {
    output.push('')
    output.push('Suggestions:')
    for (const suggestion of error.suggestions) {
      output.push(prism.yellow(`  → ${suggestion}`))
    }
  }

  // Check for verbose mode using environment variable
  const isVerbose = process.env.VERBOSE === 'true'
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

  // Add help message for specific error codes
  if (error.code === 'CONFIG_NOT_FOUND') {
    output.push(prism.gray(`Need help? Run 'kysera help' or visit https://kysera.dev/docs`))
  } else {
    output.push(prism.gray(`Need help? Run 'kysera help' or visit https://kysera.dev/docs`))
  }

  const errorMessage = output.join('\n')
  console.error(errorMessage)
}

function handleGenericError(error: Error): void {
  const output: string[] = []
  output.push('')
  output.push(prism.red(`✗ ${error.message}`))

  // Try to provide helpful suggestions based on error message
  const suggestions = getSuggestionsFromError(error)
  if (suggestions.length > 0) {
    output.push('')
    output.push('Suggestions:')
    for (const suggestion of suggestions) {
      output.push(prism.yellow(`  → ${suggestion}`))
    }
  }

  const isVerbose = process.env.VERBOSE === 'true'
  if (isVerbose && error.stack) {
    output.push('')
    output.push(prism.gray('Stack trace:'))
    output.push(prism.gray(error.stack))
  }

  output.push('')
  output.push(prism.gray(`This might be a bug. Please report it at https://github.com/kysera/kysera/issues`))

  console.error(output.join('\n'))
}

function handleUnknownError(error: unknown): void {
  const output: string[] = []
  output.push('')
  output.push(prism.red('✗ An unexpected error occurred'))
  output.push('')
  output.push(String(error))
  output.push('')
  output.push(prism.gray(`This is likely a bug. Please report it at https://github.com/kysera/kysera/issues`))

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
 * Assert a condition and throw if false
 */
export function assert(condition: any, message: string): asserts condition {
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

    if (error.details) {
      if (typeof error.details === 'object') {
        for (const [key, value] of Object.entries(error.details)) {
          lines.push(String(value))
        }
      } else {
        lines.push(String(error.details))
      }
    }

    if (error.suggestions && error.suggestions.length > 0) {
      lines.push(...error.suggestions)
    }
  } else if (error instanceof Error) {
    lines.push(error.message)
  } else if (error === null || error === undefined) {
    lines.push('Unknown error')
  } else {
    lines.push(String(error))
  }

  return lines.join('\n')
}