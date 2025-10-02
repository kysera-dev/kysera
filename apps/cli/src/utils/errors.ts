import { prism } from '@xec-sh/kit'
import { logger } from './logger.js'

export class CLIError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'CLI_ERROR',
    public readonly suggestions: string[] = []
  ) {
    super(message)
    this.name = 'CLIError'
    Error.captureStackTrace(this, this.constructor)
  }
}

export class ConfigurationError extends CLIError {
  constructor(message: string, suggestions: string[] = []) {
    super(message, 'CONFIG_ERROR', suggestions)
    this.name = 'ConfigurationError'
  }
}

export class DatabaseError extends CLIError {
  constructor(message: string, suggestions: string[] = []) {
    super(message, 'DATABASE_ERROR', suggestions)
    this.name = 'DatabaseError'
  }
}

export class ValidationError extends CLIError {
  constructor(message: string, public readonly errors: string[] = []) {
    super(message, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
  }
}

export class FileSystemError extends CLIError {
  constructor(message: string, public readonly path?: string) {
    super(message, 'FS_ERROR')
    this.name = 'FileSystemError'
  }
}

export class NetworkError extends CLIError {
  constructor(message: string, public readonly url?: string) {
    super(message, 'NETWORK_ERROR')
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
}

function handleCLIError(error: CLIError): void {
  logger.error('')
  logger.error(prism.red(`✗ ${error.message}`))

  if (error instanceof ValidationError && error.errors.length > 0) {
    logger.error('')
    logger.error('Validation errors:')
    for (const err of error.errors) {
      logger.error(`  • ${err}`)
    }
  }

  if (error.suggestions.length > 0) {
    logger.error('')
    logger.error('Suggestions:')
    for (const suggestion of error.suggestions) {
      logger.error(prism.yellow(`  → ${suggestion}`))
    }
  }

  if (error.code && ERROR_CODES[error.code]) {
    const codeInfo = ERROR_CODES[error.code]
    logger.error('')
    logger.error(prism.gray(`Error code: ${codeInfo.code}`))
    if (codeInfo.suggestions && codeInfo.suggestions.length > 0) {
      logger.error('')
      logger.error('Additional suggestions:')
      for (const suggestion of codeInfo.suggestions) {
        logger.error(prism.gray(`  • ${suggestion}`))
      }
    }
  }

  if (logger.level === 'debug' && error.stack) {
    logger.error('')
    logger.error(prism.gray('Stack trace:'))
    logger.error(prism.gray(error.stack))
  }

  logger.error('')
  logger.error(prism.gray(`Need help? Run 'kysera help' or visit https://kysera.dev/docs`))
}

function handleGenericError(error: Error): void {
  logger.error('')
  logger.error(prism.red(`✗ ${error.message}`))

  // Try to provide helpful suggestions based on error message
  const suggestions = getSuggestionsFromError(error)
  if (suggestions.length > 0) {
    logger.error('')
    logger.error('Suggestions:')
    for (const suggestion of suggestions) {
      logger.error(prism.yellow(`  → ${suggestion}`))
    }
  }

  if (logger.level === 'debug' && error.stack) {
    logger.error('')
    logger.error(prism.gray('Stack trace:'))
    logger.error(prism.gray(error.stack))
  }

  logger.error('')
  logger.error(prism.gray(`This might be a bug. Please report it at https://github.com/kysera/kysera/issues`))
}

function handleUnknownError(error: unknown): void {
  logger.error('')
  logger.error(prism.red('✗ An unexpected error occurred'))
  logger.error(String(error))
  logger.error('')
  logger.error(prism.gray(`This is likely a bug. Please report it at https://github.com/kysera/kysera/issues`))
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
 * Create a formatted error message
 */
export function formatError(title: string, details?: Record<string, any>): string {
  let message = title

  if (details) {
    message += '\n\nDetails:'
    for (const [key, value] of Object.entries(details)) {
      message += `\n  ${key}: ${JSON.stringify(value)}`
    }
  }

  return message
}