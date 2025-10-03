import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { logger } from './logger.js'

export interface GlobalOptions {
  verbose?: boolean
  quiet?: boolean
  dryRun?: boolean
  config?: string
  noColor?: boolean
  json?: boolean
}

/**
 * Global state for CLI options
 */
class GlobalOptionsManager {
  private static instance: GlobalOptionsManager
  private options: GlobalOptions = {}
  private originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug
  }

  private constructor() {}

  static getInstance(): GlobalOptionsManager {
    if (!GlobalOptionsManager.instance) {
      GlobalOptionsManager.instance = new GlobalOptionsManager()
    }
    return GlobalOptionsManager.instance
  }

  /**
   * Set global options
   */
  setOptions(options: GlobalOptions): void {
    this.options = { ...this.options, ...options }
    this.applyOptions()
  }

  /**
   * Get global options
   */
  getOptions(): GlobalOptions {
    return { ...this.options }
  }

  /**
   * Check if verbose mode is enabled
   */
  isVerbose(): boolean {
    return this.options.verbose || process.env['VERBOSE'] === 'true'
  }

  /**
   * Check if quiet mode is enabled
   */
  isQuiet(): boolean {
    return this.options.quiet || process.env['QUIET'] === 'true'
  }

  /**
   * Check if dry-run mode is enabled
   */
  isDryRun(): boolean {
    return this.options.dryRun || process.env['DRY_RUN'] === 'true'
  }

  /**
   * Check if JSON output is enabled
   */
  isJson(): boolean {
    return this.options.json || process.env['JSON_OUTPUT'] === 'true'
  }

  /**
   * Apply global options
   */
  private applyOptions(): void {
    // Set environment variables
    if (this.options.verbose) {
      process.env['VERBOSE'] = 'true'
      logger.setLevel('debug')
    }

    if (this.options.quiet) {
      process.env['QUIET'] = 'true'
      this.enableQuietMode()
    }

    if (this.options.dryRun) {
      process.env['DRY_RUN'] = 'true'
    }

    if (this.options.json) {
      process.env['JSON_OUTPUT'] = 'true'
      // Quiet mode for JSON output
      this.enableQuietMode()
    }

    if (this.options.noColor) {
      process.env['NO_COLOR'] = 'true'
      // Disable colors in prism/chalk
      ;(prism as any).level = 0
    }

    if (this.options.config) {
      process.env['KYSERA_CONFIG'] = this.options.config
    }
  }

  /**
   * Enable quiet mode
   */
  private enableQuietMode(): void {
    // Suppress non-essential console output
    console.log = (...args: any[]) => {
      // Only allow JSON output in quiet mode
      if (this.isJson() && args.length === 1 && typeof args[0] === 'string') {
        try {
          JSON.parse(args[0])
          this.originalConsole.log(...args)
        } catch {
          // Not JSON, suppress
        }
      }
    }

    console.info = () => {}
    console.debug = () => {}
    console.warn = () => {}

    // Keep error output
    console.error = this.originalConsole.error
  }

  /**
   * Restore console methods
   */
  restoreConsole(): void {
    console.log = this.originalConsole.log
    console.error = this.originalConsole.error
    console.warn = this.originalConsole.warn
    console.info = this.originalConsole.info
    console.debug = this.originalConsole.debug
  }

  /**
   * Output based on mode
   */
  output(data: any, options: { format?: 'json' | 'text' | 'table' } = {}): void {
    if (this.isJson() || options.format === 'json') {
      this.originalConsole.log(JSON.stringify(data, null, 2))
    } else if (options.format === 'table' && Array.isArray(data)) {
      console.table(data)
    } else if (typeof data === 'string') {
      this.originalConsole.log(data)
    } else {
      this.originalConsole.log(data)
    }
  }
}

// Export singleton instance
export const globalOptions = GlobalOptionsManager.getInstance()

/**
 * Add global options to a command
 */
export function addGlobalOptions(command: Command): Command {
  return command
    .option('--verbose', 'Enable verbose output')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('--dry-run', 'Preview changes without executing')
    .option('--config <path>', 'Path to configuration file')
    .option('--no-color', 'Disable colored output')
    .option('--json', 'Output results as JSON')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts() as GlobalOptions
      globalOptions.setOptions(opts)

      // Log command execution in verbose mode
      if (globalOptions.isVerbose() && !globalOptions.isJson()) {
        const commandPath = thisCommand
          .parent?.name ? `${thisCommand.parent.name} ${thisCommand.name()}` : thisCommand.name()
        logger.debug(`Executing command: ${commandPath}`)
        logger.debug(`Options: ${JSON.stringify(opts, null, 2)}`)
      }

      // Show dry-run warning
      if (globalOptions.isDryRun() && !globalOptions.isJson()) {
        console.log(prism.yellow('⚠️  DRY RUN MODE - No changes will be made'))
        console.log('')
      }
    })
}

/**
 * Wrapper for dry-run operations
 */
export async function withDryRun<T>(
  operation: () => Promise<T>,
  preview: () => void | Promise<void>,
  options: { message?: string } = {}
): Promise<T | undefined> {
  if (globalOptions.isDryRun()) {
    const message = options.message || 'Would execute'

    if (!globalOptions.isJson()) {
      console.log(prism.cyan(`[DRY RUN] ${message}:`))
      console.log('')
    }

    await preview()

    if (!globalOptions.isJson()) {
      console.log('')
      console.log(prism.gray('(No changes made in dry-run mode)'))
    }

    return undefined
  }

  return operation()
}

/**
 * Log verbose message
 */
export function verbose(message: string, data?: any): void {
  if (globalOptions.isVerbose() && !globalOptions.isQuiet() && !globalOptions.isJson()) {
    if (data !== undefined) {
      logger.debug(`${message}:`, data)
    } else {
      logger.debug(message)
    }
  }
}

/**
 * Log debug information
 */
export function debug(message: string, data?: any): void {
  if (globalOptions.isVerbose() && !globalOptions.isQuiet() && !globalOptions.isJson()) {
    if (data !== undefined) {
      console.log(prism.gray(`[DEBUG] ${message}:`), data)
    } else {
      console.log(prism.gray(`[DEBUG] ${message}`))
    }
  }
}

/**
 * Conditionally execute based on options
 */
export function when(
  condition: 'verbose' | 'quiet' | 'dryRun' | 'json',
  callback: () => void
): void {
  const shouldExecute = {
    verbose: globalOptions.isVerbose(),
    quiet: globalOptions.isQuiet(),
    dryRun: globalOptions.isDryRun(),
    json: globalOptions.isJson()
  }[condition]

  if (shouldExecute) {
    callback()
  }
}

/**
 * Format output based on global options
 */
export function formatOutput<T>(
  data: T,
  options: {
    json?: (data: T) => any
    text?: (data: T) => string
    table?: (data: T) => any[]
  }
): void {
  if (globalOptions.isJson() && options.json) {
    globalOptions.output(options.json(data), { format: 'json' })
  } else if (options.table && !globalOptions.isJson()) {
    globalOptions.output(options.table(data), { format: 'table' })
  } else if (options.text && !globalOptions.isJson()) {
    globalOptions.output(options.text(data))
  } else {
    globalOptions.output(data)
  }
}

/**
 * Confirmation with dry-run support
 */
export async function confirmWithDryRun(
  message: string,
  defaultValue = false
): Promise<boolean> {
  if (globalOptions.isDryRun()) {
    if (!globalOptions.isJson()) {
      console.log(prism.cyan(`[DRY RUN] Would prompt: ${message}`))
      console.log(prism.gray(`(Would use default: ${defaultValue})`))
    }
    return defaultValue
  }

  if (globalOptions.isQuiet() || globalOptions.isJson()) {
    return defaultValue
  }

  const { confirm } = await import('@xec-sh/kit')
  return confirm(message, { defaultValue })
}

/**
 * Command execution summary
 */
export class ExecutionSummary {
  private steps: Array<{
    name: string
    status: 'pending' | 'success' | 'skipped' | 'failed'
    message?: string
    duration?: number
  }> = []
  private startTime = Date.now()

  /**
   * Add a step
   */
  addStep(
    name: string,
    status: 'pending' | 'success' | 'skipped' | 'failed' = 'pending',
    message?: string
  ): void {
    this.steps.push({ name, status, message })
  }

  /**
   * Update step status
   */
  updateStep(
    name: string,
    status: 'success' | 'skipped' | 'failed',
    message?: string
  ): void {
    const step = this.steps.find(s => s.name === name)
    if (step) {
      step.status = status
      if (message) step.message = message
      step.duration = Date.now() - this.startTime
    }
  }

  /**
   * Display summary
   */
  display(): void {
    if (globalOptions.isQuiet() || globalOptions.isJson()) {
      if (globalOptions.isJson()) {
        globalOptions.output({
          steps: this.steps,
          duration: Date.now() - this.startTime,
          success: this.steps.every(s => s.status !== 'failed')
        })
      }
      return
    }

    console.log('')
    console.log(prism.bold('Execution Summary:'))
    console.log(prism.gray('─'.repeat(60)))

    this.steps.forEach(step => {
      const icon = {
        success: prism.green('✓'),
        failed: prism.red('✗'),
        skipped: prism.yellow('○'),
        pending: prism.gray('◌')
      }[step.status]

      const name = step.status === 'failed'
        ? prism.red(step.name)
        : step.status === 'skipped'
        ? prism.yellow(step.name)
        : step.name

      console.log(`  ${icon} ${name}`)

      if (step.message && (globalOptions.isVerbose() || step.status === 'failed')) {
        console.log(`    ${prism.gray(step.message)}`)
      }
    })

    console.log(prism.gray('─'.repeat(60)))

    const totalDuration = Date.now() - this.startTime
    const failed = this.steps.filter(s => s.status === 'failed').length
    const success = this.steps.filter(s => s.status === 'success').length
    const skipped = this.steps.filter(s => s.status === 'skipped').length

    console.log(`Total: ${this.steps.length} steps`)
    if (success > 0) console.log(prism.green(`  ✓ ${success} succeeded`))
    if (skipped > 0) console.log(prism.yellow(`  ○ ${skipped} skipped`))
    if (failed > 0) console.log(prism.red(`  ✗ ${failed} failed`))
    console.log(prism.gray(`Duration: ${this.formatDuration(totalDuration)}`))
    console.log('')
  }

  /**
   * Format duration
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ${seconds % 60}s`
  }
}