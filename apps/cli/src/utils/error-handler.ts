import { prism } from '@xec-sh/kit';
import { CLIError, CLIErrorCodes } from './errors.js';
import type { Command } from 'commander';
import {
  ErrorCodes,
  DatabaseErrorCodes,
  ValidationErrorCodes,
  ConfigErrorCodes,
  FileSystemErrorCodes,
  NetworkErrorCodes,
  MigrationErrorCodes,
  PluginErrorCodes,
} from '@kysera/core';

export interface ErrorContext {
  command?: string;
  operation?: string;
  details?: Record<string, unknown>;
  suggestion?: string;
}

/**
 * Error code to user-friendly message mapping
 *
 * Uses unified ErrorCodes from @kysera/core for consistency across
 * the entire Kysera ecosystem. Both unified codes and legacy codes are supported.
 */
const ERROR_MESSAGES: Record<string, { message: string; suggestion?: string }> = {
  // Database errors (using unified codes from @kysera/core)
  [DatabaseErrorCodes.DB_CONNECTION_FAILED]: {
    message: 'Failed to connect to the database',
    suggestion: 'Check your database configuration and ensure the database server is running',
  },
  [DatabaseErrorCodes.DB_QUERY_FAILED]: {
    message: 'Database query failed',
    suggestion: 'Check your query syntax and database permissions',
  },
  [DatabaseErrorCodes.DB_TIMEOUT]: {
    message: 'Database operation timed out',
    suggestion: 'Try increasing the timeout or optimizing the query',
  },
  [DatabaseErrorCodes.DB_POOL_EXHAUSTED]: {
    message: 'Database connection pool exhausted',
    suggestion: 'Increase pool size or check for connection leaks',
  },
  DB_PERMISSION_ERROR: {
    message: 'Insufficient database permissions',
    suggestion: 'Ensure your database user has the necessary permissions for this operation',
  },
  DB_NOT_FOUND: {
    message: 'Database does not exist',
    suggestion: 'Create the database first or check your database configuration',
  },
  DB_ALREADY_EXISTS: {
    message: 'Database already exists',
    suggestion: 'Use a different name or drop the existing database first',
  },

  // Migration errors (using unified codes from @kysera/core)
  [MigrationErrorCodes.MIGRATION_NOT_FOUND]: {
    message: 'Migration file not found',
    suggestion: 'Check that the migration exists in your migrations directory',
  },
  [MigrationErrorCodes.MIGRATION_UP_FAILED]: {
    message: 'Migration execution failed',
    suggestion: 'Check the migration file for errors or database compatibility issues',
  },
  [MigrationErrorCodes.MIGRATION_DOWN_FAILED]: {
    message: 'Migration rollback failed',
    suggestion: 'Check the down() function in your migration file',
  },
  [MigrationErrorCodes.MIGRATION_LOCK_FAILED]: {
    message: 'Migrations are locked',
    suggestion: 'Another migration process might be running. Wait or manually unlock migrations',
  },
  [MigrationErrorCodes.MIGRATION_VALIDATION_FAILED]: {
    message: 'Invalid migration file',
    suggestion: 'Ensure the migration exports valid up() and down() functions',
  },
  MIGRATIONS_DIR_NOT_FOUND: {
    message: 'Migrations directory does not exist',
    suggestion: 'Create the migrations directory or specify a different path with --dir',
  },

  // Configuration errors (using unified codes from @kysera/core)
  [ConfigErrorCodes.CONFIG_NOT_FOUND]: {
    message: 'Configuration file not found',
    suggestion: 'Run "kysera init" to create a configuration file or specify one with --config',
  },
  [ConfigErrorCodes.CONFIG_INVALID_VALUE]: {
    message: 'Invalid configuration file',
    suggestion: 'Check your configuration file for syntax errors or missing required fields',
  },
  [ConfigErrorCodes.CONFIG_VALIDATION_FAILED]: {
    message: 'Configuration validation failed',
    suggestion: 'Review the validation errors and update your configuration accordingly',
  },
  [ConfigErrorCodes.CONFIG_PARSE_ERROR]: {
    message: 'Configuration file parse error',
    suggestion: 'Check your configuration file syntax',
  },

  // Plugin errors (using unified codes from @kysera/core)
  [PluginErrorCodes.PLUGIN_NOT_FOUND]: {
    message: 'Plugin not found',
    suggestion: 'Check the plugin name or run "kysera plugin list --available" to see available plugins',
  },
  [PluginErrorCodes.PLUGIN_INIT_FAILED]: {
    message: 'Plugin initialization failed',
    suggestion: 'Check plugin configuration and dependencies',
  },
  [PluginErrorCodes.PLUGIN_DEPENDENCY_MISSING]: {
    message: 'Plugin has unmet dependencies',
    suggestion: 'Install the required dependencies or enable dependent plugins first',
  },
  [PluginErrorCodes.PLUGIN_CONFLICT]: {
    message: 'Plugin conflict detected',
    suggestion: 'Check for conflicting plugins and disable one of them',
  },
  [PluginErrorCodes.PLUGIN_DUPLICATE]: {
    message: 'Duplicate plugin detected',
    suggestion: 'Remove the duplicate plugin from your configuration',
  },
  PLUGIN_NOT_INSTALLED: {
    message: 'Plugin is not installed',
    suggestion: 'Install the plugin first with "npm install" or "pnpm add"',
  },
  PLUGIN_ALREADY_ENABLED: {
    message: 'Plugin is already enabled',
    suggestion: 'The plugin is already active. Check "kysera plugin list" to see enabled plugins',
  },
  PLUGIN_INCOMPATIBLE: {
    message: 'Plugin is not compatible with this version',
    suggestion: 'Check the plugin documentation for version requirements or update Kysera',
  },

  // File system errors (using unified codes from @kysera/core)
  [FileSystemErrorCodes.FS_FILE_NOT_FOUND]: {
    message: 'File not found',
    suggestion: 'Check the file path and ensure the file exists',
  },
  [FileSystemErrorCodes.FS_DIRECTORY_NOT_FOUND]: {
    message: 'Directory not found',
    suggestion: 'Check the directory path or create it with "mkdir"',
  },
  [FileSystemErrorCodes.FS_PERMISSION_DENIED]: {
    message: 'Permission denied',
    suggestion: 'Check file permissions or run with appropriate privileges',
  },
  [FileSystemErrorCodes.FS_FILE_EXISTS]: {
    message: 'File already exists',
    suggestion: 'Use --force to overwrite or choose a different name',
  },
  [FileSystemErrorCodes.FS_WRITE_FAILED]: {
    message: 'Failed to write file',
    suggestion: 'Check write permissions and available disk space',
  },
  [FileSystemErrorCodes.FS_READ_FAILED]: {
    message: 'Failed to read file',
    suggestion: 'Check that the file exists and has read permissions',
  },

  // Validation errors (using unified codes from @kysera/core)
  [ValidationErrorCodes.VALIDATION_INVALID_INPUT]: {
    message: 'Invalid input provided',
    suggestion: 'Check the input format and try again',
  },
  [ValidationErrorCodes.VALIDATION_REQUIRED_FIELD]: {
    message: 'Required field missing',
    suggestion: 'Provide all required fields',
  },
  [ValidationErrorCodes.VALIDATION_UNIQUE_VIOLATION]: {
    message: 'Unique constraint violation',
    suggestion: 'The value already exists. Use a different value.',
  },
  [ValidationErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION]: {
    message: 'Foreign key constraint violation',
    suggestion: 'Referenced record does not exist',
  },

  // Network errors (using unified codes from @kysera/core)
  [NetworkErrorCodes.NETWORK_CONNECTION_REFUSED]: {
    message: 'Network connection refused',
    suggestion: 'Check that the service is running and accessible',
  },
  [NetworkErrorCodes.NETWORK_TIMEOUT]: {
    message: 'Network request timed out',
    suggestion: 'Try increasing the timeout or check network connectivity',
  },
  [NetworkErrorCodes.NETWORK_DNS_FAILED]: {
    message: 'DNS resolution failed',
    suggestion: 'Check the hostname and DNS configuration',
  },

  // Test errors
  TEST_DB_ERROR: {
    message: 'Test database operation failed',
    suggestion: 'Check your test database configuration and permissions',
  },
  TEST_FIXTURE_ERROR: {
    message: 'Failed to load test fixture',
    suggestion: 'Check the fixture file format and content',
  },
  TEST_SEED_ERROR: {
    message: 'Test data seeding failed',
    suggestion: 'Review the seeding configuration and database schema',
  },

  // General errors
  INVALID_ARGUMENT: {
    message: 'Invalid argument provided',
    suggestion: 'Check the command syntax with "kysera help [command]"',
  },
  OPERATION_CANCELLED: {
    message: 'Operation cancelled by user',
    suggestion: undefined,
  },
  NETWORK_ERROR: {
    message: 'Network request failed',
    suggestion: 'Check your internet connection and try again',
  },
  TIMEOUT_ERROR: {
    message: 'Operation timed out',
    suggestion: 'Try increasing the timeout or check for blocking operations',
  },
  [DatabaseErrorCodes.DB_UNKNOWN]: {
    message: 'An unexpected database error occurred',
    suggestion: 'Try running with --verbose for more details',
  },
  UNKNOWN_ERROR: {
    message: 'An unexpected error occurred',
    suggestion: 'Try running with --verbose for more details',
  },

  // Legacy code mappings (for backward compatibility)
  DB_CONNECTION_ERROR: {
    message: 'Failed to connect to the database',
    suggestion: 'Check your database configuration and ensure the database server is running',
  },
  FILE_NOT_FOUND: {
    message: 'File not found',
    suggestion: 'Check the file path and ensure the file exists',
  },
  DIR_NOT_FOUND: {
    message: 'Directory not found',
    suggestion: 'Check the directory path or create it with "mkdir"',
  },
  PERMISSION_DENIED: {
    message: 'Permission denied',
    suggestion: 'Check file permissions or run with appropriate privileges',
  },
  FILE_EXISTS: {
    message: 'File already exists',
    suggestion: 'Use --force to overwrite or choose a different name',
  },
  CONFIG_NOT_FOUND: {
    message: 'Configuration file not found',
    suggestion: 'Run "kysera init" to create a configuration file or specify one with --config',
  },
  CONFIG_INVALID: {
    message: 'Invalid configuration file',
    suggestion: 'Check your configuration file for syntax errors or missing required fields',
  },
  CONFIG_VALIDATION_ERROR: {
    message: 'Configuration validation failed',
    suggestion: 'Review the validation errors and update your configuration accordingly',
  },
  MIGRATION_NOT_FOUND: {
    message: 'Migration file not found',
    suggestion: 'Check that the migration exists in your migrations directory',
  },
  MIGRATION_INVALID: {
    message: 'Invalid migration file',
    suggestion: 'Ensure the migration exports valid up() and down() functions',
  },
  MIGRATION_FAILED: {
    message: 'Migration execution failed',
    suggestion: 'Check the migration file for errors or database compatibility issues',
  },
  MIGRATION_LOCKED: {
    message: 'Migrations are locked',
    suggestion: 'Another migration process might be running. Wait or manually unlock migrations',
  },
  PLUGIN_NOT_FOUND: {
    message: 'Plugin not found',
    suggestion: 'Check the plugin name or run "kysera plugin list --available" to see available plugins',
  },
  PLUGIN_DEPENDENCY_ERROR: {
    message: 'Plugin has unmet dependencies',
    suggestion: 'Install the required dependencies or enable dependent plugins first',
  },
};

/**
 * Enhanced error handler with helpful messages
 */
export class ErrorHandler {
  private verbose: boolean;
  private quiet: boolean;
  private context: ErrorContext = {};

  constructor(options: { verbose?: boolean; quiet?: boolean } = {}) {
    this.verbose = options.verbose || process.env.VERBOSE === 'true';
    this.quiet = options.quiet || process.env.QUIET === 'true';
  }

  /**
   * Set error context
   */
  setContext(context: ErrorContext): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Handle and display error
   */
  handle(error: unknown, exitCode = 1): void {
    if (this.quiet && exitCode === 0) {
      process.exit(exitCode);
    }

    const errorInfo = this.extractErrorInfo(error);
    this.displayError(errorInfo);

    if (this.verbose) {
      this.displayDebugInfo(error, errorInfo);
    }

    process.exit(exitCode);
  }

  /**
   * Extract error information
   */
  private extractErrorInfo(error: unknown): {
    code?: string;
    message: string;
    suggestion?: string;
    details?: Record<string, unknown>;
    stack?: string;
  } {
    if (error instanceof CLIError) {
      const codeInfo = error.code ? ERROR_MESSAGES[error.code] : undefined;
      return {
        code: error.code,
        message: codeInfo?.message || error.message,
        suggestion: error.details?.suggestion || codeInfo?.suggestion,
        details: error.details,
        stack: error.stack,
      };
    }

    if (error instanceof Error) {
      // Check for common error patterns
      const errorStr = error.message.toLowerCase();
      let code: string | undefined;
      let suggestion: string | undefined;

      if (errorStr.includes('enoent')) {
        code = 'FILE_NOT_FOUND';
        suggestion = ERROR_MESSAGES.FILE_NOT_FOUND.suggestion;
      } else if (errorStr.includes('eacces') || errorStr.includes('permission')) {
        code = 'PERMISSION_DENIED';
        suggestion = ERROR_MESSAGES.PERMISSION_DENIED.suggestion;
      } else if (errorStr.includes('econnrefused')) {
        code = 'DB_CONNECTION_ERROR';
        suggestion = ERROR_MESSAGES.DB_CONNECTION_ERROR.suggestion;
      } else if (errorStr.includes('timeout')) {
        code = 'TIMEOUT_ERROR';
        suggestion = ERROR_MESSAGES.TIMEOUT_ERROR.suggestion;
      } else if (errorStr.includes('network')) {
        code = 'NETWORK_ERROR';
        suggestion = ERROR_MESSAGES.NETWORK_ERROR.suggestion;
      }

      return {
        code,
        message: error.message,
        suggestion,
        stack: error.stack,
      };
    }

    return {
      message: String(error),
      suggestion: ERROR_MESSAGES.UNKNOWN_ERROR.suggestion,
    };
  }

  /**
   * Display formatted error
   */
  private displayError(errorInfo: {
    code?: string;
    message: string;
    suggestion?: string;
    details?: Record<string, unknown>;
  }): void {
    console.error('');

    // Error header
    if (this.context.operation) {
      console.error(prism.red('✗') + ' ' + prism.bold(this.context.operation));
    }

    // Error message
    const prefix = errorInfo.code ? `[${errorInfo.code}] ` : '';
    console.error(prism.red(prefix + errorInfo.message));

    // Additional details
    if (errorInfo.details && !this.verbose) {
      const detailKeys = Object.keys(errorInfo.details).filter((k) => k !== 'suggestion' && k !== 'stack');
      if (detailKeys.length > 0) {
        console.error('');
        detailKeys.forEach((key) => {
          console.error(prism.gray(`  ${key}: ${errorInfo.details?.[key]}`));
        });
      }
    }

    // Suggestion
    if (errorInfo.suggestion) {
      console.error('');
      console.error(prism.yellow('💡 ' + errorInfo.suggestion));
    }

    // Context-specific help
    if (this.context.command) {
      console.error('');
      console.error(prism.gray(`Run 'kysera help ${this.context.command}' for more information`));
    }

    console.error('');
  }

  /**
   * Display debug information
   */
  private displayDebugInfo(
    error: unknown,
    errorInfo: { code?: string; message: string; suggestion?: string; details?: Record<string, unknown>; stack?: string }
  ): void {
    console.error(prism.gray('─'.repeat(60)));
    console.error(prism.gray('Debug Information:'));

    // Context
    if (Object.keys(this.context).length > 0) {
      console.error(prism.gray('Context:'));
      Object.entries(this.context).forEach(([key, value]) => {
        if (value && key !== 'suggestion') {
          console.error(prism.gray(`  ${key}: ${JSON.stringify(value)}`));
        }
      });
    }

    // Full error object
    if (error instanceof Error) {
      console.error(prism.gray('Error Type:'), error.constructor.name);
      if (error.cause) {
        console.error(prism.gray('Cause:'), error.cause);
      }
    }

    // Stack trace
    if (errorInfo.stack) {
      console.error(prism.gray('Stack Trace:'));
      const stackLines = errorInfo.stack.split('\n').slice(1, 11); // Show first 10 stack frames
      stackLines.forEach((line: string) => {
        console.error(prism.gray(line));
      });
    }

    // Environment
    console.error(prism.gray('Environment:'));
    console.error(prism.gray(`  Node: ${process.version}`));
    console.error(prism.gray(`  Platform: ${process.platform}`));
    console.error(prism.gray(`  CWD: ${process.cwd()}`));

    console.error(prism.gray('─'.repeat(60)));
  }

  /**
   * Create a wrapped command handler with error handling
   */
  wrapCommand<T extends (...args: unknown[]) => Promise<unknown>>(
    handler: T,
    options: { command?: string; operation?: string } = {}
  ): T {
    return (async (...args: Parameters<T>) => {
      try {
        this.setContext({
          command: options.command,
          operation: options.operation,
        });
        return await handler(...args);
      } catch (error) {
        this.handle(error);
        return undefined;
      }
    }) as T;
  }

  /**
   * Install global error handlers
   */
  static install(program: Command): void {
    const handler = new ErrorHandler({
      verbose: program.opts().verbose,
      quiet: program.opts().quiet,
    });

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      handler.setContext({ operation: 'Uncaught Exception' });
      handler.handle(error, 1);
    });

    process.on('unhandledRejection', (error) => {
      handler.setContext({ operation: 'Unhandled Promise Rejection' });
      handler.handle(error, 1);
    });

    // Handle command errors
    program.exitOverride((err) => {
      if (err.code === 'commander.help' || err.code === 'commander.version') {
        process.exit(0);
      }
      handler.setContext({ operation: 'Command Error' });
      handler.handle(err, err.exitCode || 1);
    });
  }
}

/**
 * Create error with code and details
 */
export function createError(
  code: keyof typeof ERROR_MESSAGES,
  customMessage?: string,
  details?: Record<string, unknown>
): CLIError {
  const errorInfo = ERROR_MESSAGES[code];
  return new CLIError(customMessage || errorInfo.message, code, {
    ...details,
    suggestion: details?.suggestion || errorInfo.suggestion,
  });
}
