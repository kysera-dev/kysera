import { prism } from '@xec-sh/kit'
import { CLIError } from './errors.js'
import type { Command } from 'commander'

export interface ErrorContext {
  command?: string
  operation?: string
  details?: Record<string, any>
  suggestion?: string
}

/**
 * Error code to user-friendly message mapping
 */
const ERROR_MESSAGES: Record<string, { message: string; suggestion?: string }> = {
  // Database errors
  DB_CONNECTION_ERROR: {
    message: 'Failed to connect to the database',
    suggestion: 'Check your database configuration and ensure the database server is running'
  },
  DB_PERMISSION_ERROR: {
    message: 'Insufficient database permissions',
    suggestion: 'Ensure your database user has the necessary permissions for this operation'
  },
  DB_NOT_FOUND: {
    message: 'Database does not exist',
    suggestion: 'Create the database first or check your database configuration'
  },
  DB_ALREADY_EXISTS: {
    message: 'Database already exists',
    suggestion: 'Use a different name or drop the existing database first'
  },

  // Migration errors
  MIGRATION_NOT_FOUND: {
    message: 'Migration file not found',
    suggestion: 'Check that the migration exists in your migrations directory'
  },
  MIGRATION_INVALID: {
    message: 'Invalid migration file',
    suggestion: 'Ensure the migration exports valid up() and down() functions'
  },
  MIGRATION_FAILED: {
    message: 'Migration execution failed',
    suggestion: 'Check the migration file for errors or database compatibility issues'
  },
  MIGRATION_LOCKED: {
    message: 'Migrations are locked',
    suggestion: 'Another migration process might be running. Wait or manually unlock migrations'
  },
  MIGRATIONS_DIR_NOT_FOUND: {
    message: 'Migrations directory does not exist',
    suggestion: 'Create the migrations directory or specify a different path with --dir'
  },

  // Configuration errors
  CONFIG_NOT_FOUND: {
    message: 'Configuration file not found',
    suggestion: 'Run "kysera init" to create a configuration file or specify one with --config'
  },
  CONFIG_INVALID: {
    message: 'Invalid configuration file',
    suggestion: 'Check your configuration file for syntax errors or missing required fields'
  },
  CONFIG_VALIDATION_ERROR: {
    message: 'Configuration validation failed',
    suggestion: 'Review the validation errors and update your configuration accordingly'
  },

  // Plugin errors
  PLUGIN_NOT_FOUND: {
    message: 'Plugin not found',
    suggestion: 'Check the plugin name or run "kysera plugin list --available" to see available plugins'
  },
  PLUGIN_NOT_INSTALLED: {
    message: 'Plugin is not installed',
    suggestion: 'Install the plugin first with "npm install" or "pnpm add"'
  },
  PLUGIN_ALREADY_ENABLED: {
    message: 'Plugin is already enabled',
    suggestion: 'The plugin is already active. Check "kysera plugin list" to see enabled plugins'
  },
  PLUGIN_DEPENDENCY_ERROR: {
    message: 'Plugin has unmet dependencies',
    suggestion: 'Install the required dependencies or enable dependent plugins first'
  },
  PLUGIN_INCOMPATIBLE: {
    message: 'Plugin is not compatible with this version',
    suggestion: 'Check the plugin documentation for version requirements or update Kysera'
  },

  // File system errors
  FILE_NOT_FOUND: {
    message: 'File not found',
    suggestion: 'Check the file path and ensure the file exists'
  },
  DIR_NOT_FOUND: {
    message: 'Directory not found',
    suggestion: 'Check the directory path or create it with "mkdir"'
  },
  PERMISSION_DENIED: {
    message: 'Permission denied',
    suggestion: 'Check file permissions or run with appropriate privileges'
  },
  FILE_EXISTS: {
    message: 'File already exists',
    suggestion: 'Use --force to overwrite or choose a different name'
  },

  // Test errors
  TEST_DB_ERROR: {
    message: 'Test database operation failed',
    suggestion: 'Check your test database configuration and permissions'
  },
  TEST_FIXTURE_ERROR: {
    message: 'Failed to load test fixture',
    suggestion: 'Check the fixture file format and content'
  },
  TEST_SEED_ERROR: {
    message: 'Test data seeding failed',
    suggestion: 'Review the seeding configuration and database schema'
  },

  // General errors
  INVALID_ARGUMENT: {
    message: 'Invalid argument provided',
    suggestion: 'Check the command syntax with "kysera help [command]"'
  },
  OPERATION_CANCELLED: {
    message: 'Operation cancelled by user',
    suggestion: null
  },
  NETWORK_ERROR: {
    message: 'Network request failed',
    suggestion: 'Check your internet connection and try again'
  },
  TIMEOUT_ERROR: {
    message: 'Operation timed out',
    suggestion: 'Try increasing the timeout or check for blocking operations'
  },
  UNKNOWN_ERROR: {
    message: 'An unexpected error occurred',
    suggestion: 'Try running with --verbose for more details'
  }
}

/**
 * Enhanced error handler with helpful messages
 */
export class ErrorHandler {
  private verbose: boolean
  private quiet: boolean
  private context: ErrorContext = {}

  constructor(options: { verbose?: boolean; quiet?: boolean } = {}) {
    this.verbose = options.verbose || process.env.VERBOSE === 'true'
    this.quiet = options.quiet || process.env.QUIET === 'true'
  }

  /**
   * Set error context
   */
  setContext(context: ErrorContext): void {
    this.context = { ...this.context, ...context }
  }

  /**
   * Handle and display error
   */
  handle(error: unknown, exitCode = 1): void {
    if (this.quiet && exitCode === 0) {
      process.exit(exitCode)
      return
    }

    const errorInfo = this.extractErrorInfo(error)
    this.displayError(errorInfo)

    if (this.verbose) {
      this.displayDebugInfo(error, errorInfo)
    }

    process.exit(exitCode)
  }

  /**
   * Extract error information
   */
  private extractErrorInfo(error: unknown): {
    code?: string
    message: string
    suggestion?: string
    details?: any
    stack?: string
  } {
    if (error instanceof CLIError) {
      const codeInfo = error.code ? ERROR_MESSAGES[error.code] : undefined
      return {
        code: error.code,
        message: codeInfo?.message || error.message,
        suggestion: error.details?.suggestion || codeInfo?.suggestion,
        details: error.details,
        stack: error.stack
      }
    }

    if (error instanceof Error) {
      // Check for common error patterns
      const errorStr = error.message.toLowerCase()
      let code: string | undefined
      let suggestion: string | undefined

      if (errorStr.includes('enoent')) {
        code = 'FILE_NOT_FOUND'
        suggestion = ERROR_MESSAGES.FILE_NOT_FOUND.suggestion
      } else if (errorStr.includes('eacces') || errorStr.includes('permission')) {
        code = 'PERMISSION_DENIED'
        suggestion = ERROR_MESSAGES.PERMISSION_DENIED.suggestion
      } else if (errorStr.includes('econnrefused')) {
        code = 'DB_CONNECTION_ERROR'
        suggestion = ERROR_MESSAGES.DB_CONNECTION_ERROR.suggestion
      } else if (errorStr.includes('timeout')) {
        code = 'TIMEOUT_ERROR'
        suggestion = ERROR_MESSAGES.TIMEOUT_ERROR.suggestion
      } else if (errorStr.includes('network')) {
        code = 'NETWORK_ERROR'
        suggestion = ERROR_MESSAGES.NETWORK_ERROR.suggestion
      }

      return {
        code,
        message: error.message,
        suggestion,
        stack: error.stack
      }
    }

    return {
      message: String(error),
      suggestion: ERROR_MESSAGES.UNKNOWN_ERROR.suggestion
    }
  }

  /**
   * Display formatted error
   */
  private displayError(errorInfo: {
    code?: string
    message: string
    suggestion?: string
    details?: any
  }): void {
    console.error('')

    // Error header
    if (this.context.operation) {
      console.error(prism.red('✗') + ' ' + prism.bold(this.context.operation))
    }

    // Error message
    const prefix = errorInfo.code ? `[${errorInfo.code}] ` : ''
    console.error(prism.red(prefix + errorInfo.message))

    // Additional details
    if (errorInfo.details && !this.verbose) {
      const detailKeys = Object.keys(errorInfo.details).filter(
        k => k !== 'suggestion' && k !== 'stack'
      )
      if (detailKeys.length > 0) {
        console.error('')
        detailKeys.forEach(key => {
          console.error(prism.gray(`  ${key}: ${errorInfo.details[key]}`))
        })
      }
    }

    // Suggestion
    if (errorInfo.suggestion) {
      console.error('')
      console.error(prism.yellow('💡 ' + errorInfo.suggestion))
    }

    // Context-specific help
    if (this.context.command) {
      console.error('')
      console.error(
        prism.gray(`Run 'kysera help ${this.context.command}' for more information`)
      )
    }

    console.error('')
  }

  /**
   * Display debug information
   */
  private displayDebugInfo(error: unknown, errorInfo: any): void {
    console.error(prism.gray('─'.repeat(60)))
    console.error(prism.gray('Debug Information:'))

    // Context
    if (Object.keys(this.context).length > 0) {
      console.error(prism.gray('Context:'))
      Object.entries(this.context).forEach(([key, value]) => {
        if (value && key !== 'suggestion') {
          console.error(prism.gray(`  ${key}: ${JSON.stringify(value)}`))
        }
      })
    }

    // Full error object
    if (error instanceof Error) {
      console.error(prism.gray('Error Type:'), error.constructor.name)
      if (error.cause) {
        console.error(prism.gray('Cause:'), error.cause)
      }
    }

    // Stack trace
    if (errorInfo.stack) {
      console.error(prism.gray('Stack Trace:'))
      const stackLines = errorInfo.stack.split('\n').slice(1, 11) // Show first 10 stack frames
      stackLines.forEach((line: string) => {
        console.error(prism.gray(line))
      })
    }

    // Environment
    console.error(prism.gray('Environment:'))
    console.error(prism.gray(`  Node: ${process.version}`))
    console.error(prism.gray(`  Platform: ${process.platform}`))
    console.error(prism.gray(`  CWD: ${process.cwd()}`))

    console.error(prism.gray('─'.repeat(60)))
  }

  /**
   * Create a wrapped command handler with error handling
   */
  wrapCommand<T extends (...args: any[]) => Promise<any>>(
    handler: T,
    options: { command?: string; operation?: string } = {}
  ): T {
    return (async (...args: Parameters<T>) => {
      try {
        this.setContext({
          command: options.command,
          operation: options.operation
        })
        return await handler(...args)
      } catch (error) {
        this.handle(error)
      }
    }) as T
  }

  /**
   * Install global error handlers
   */
  static install(program: Command): void {
    const handler = new ErrorHandler({
      verbose: program.opts().verbose,
      quiet: program.opts().quiet
    })

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      handler.setContext({ operation: 'Uncaught Exception' })
      handler.handle(error, 1)
    })

    process.on('unhandledRejection', (error) => {
      handler.setContext({ operation: 'Unhandled Promise Rejection' })
      handler.handle(error, 1)
    })

    // Handle command errors
    program.exitOverride((err) => {
      if (err.code === 'commander.help' || err.code === 'commander.version') {
        process.exit(0)
      }
      handler.setContext({ operation: 'Command Error' })
      handler.handle(err, err.exitCode || 1)
    })
  }
}

/**
 * Create error with code and details
 */
export function createError(
  code: keyof typeof ERROR_MESSAGES,
  customMessage?: string,
  details?: Record<string, any>
): CLIError {
  const errorInfo = ERROR_MESSAGES[code]
  return new CLIError(
    customMessage || errorInfo.message,
    code,
    {
      ...details,
      suggestion: details?.suggestion || errorInfo.suggestion
    }
  )
}