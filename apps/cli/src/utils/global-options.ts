import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { logger } from './logger.js'
import { configureOutput, diag, diagVerbose, isVerboseMode, isQuietMode } from './output.js'

export interface GlobalOptions {
  verbose?: boolean
  quiet?: boolean
  dryRun?: boolean
  config?: string
  color?: boolean
  json?: boolean
}

let dryRunEnabled = false

/** True when --dry-run was passed for this invocation. */
export function isDryRun(): boolean {
  return dryRunEnabled
}

/** Reset global option state (used by tests). */
export function resetGlobalOptions(): void {
  dryRunEnabled = false
}

/**
 * Global option keys that are pushed from the root command down into the
 * invoked subcommand, so `kysera --json migrate status` and
 * `kysera migrate status --json` behave identically. A flag given on the
 * subcommand always wins.
 */
const PROPAGATED_KEYS = ['json', 'verbose', 'quiet', 'config', 'dryRun'] as const

/**
 * Apply global options for this invocation: propagate root flags to the
 * invoked subcommand, configure output mode, and set the logger level.
 */
export function applyGlobalOptions(rootCommand: Command, actionCommand: Command): void {
  const rootOpts = rootCommand.opts<Record<string, unknown>>()

  if (actionCommand !== rootCommand) {
    for (const key of PROPAGATED_KEYS) {
      const rootValue = rootOpts[key]
      if (rootValue === undefined) continue
      const source = actionCommand.getOptionValueSource(key)
      if (source === undefined || source === 'default') {
        actionCommand.setOptionValue(key, rootValue)
      }
    }
  }

  const leafOpts = actionCommand.opts<Record<string, unknown>>()
  const pick = (key: string): unknown => (leafOpts[key] !== undefined ? leafOpts[key] : rootOpts[key])

  const json = pick('json') === true
  const quiet = pick('quiet') === true
  const verbose = pick('verbose') === true
  dryRunEnabled = pick('dryRun') === true

  configureOutput({ json, quiet, verbose })
  logger.setLevel(verbose ? 'debug' : quiet ? 'error' : 'info')

  if (rootOpts['color'] === false || leafOpts['color'] === false) {
    // Standard mechanism understood by color libraries (prism/chalk/etc.)
    process.env['NO_COLOR'] = '1'
    logger.setColors(false)
  }

  if (dryRunEnabled && !json) {
    diag(prism.yellow('DRY RUN MODE - No changes will be made'))
  }
}

/**
 * Add the global options to the root command.
 */
export function addGlobalOptions(command: Command): Command {
  return command
    .option('--verbose', 'Enable verbose output')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('--dry-run', 'Preview changes without executing')
    .option('--config <path>', 'Path to configuration file')
    .option('--no-color', 'Disable colored output')
    .option('--json', 'Output results as JSON')
    .hook('preAction', (thisCommand, actionCommand) => {
      applyGlobalOptions(thisCommand, actionCommand)
    })
}

/**
 * Log verbose diagnostic message (stderr, only with --verbose).
 */
export function verbose(message: string, data?: unknown): void {
  if (!isVerboseMode() || isQuietMode()) return
  if (data !== undefined) {
    logger.debug(`${message}:`, data)
  } else {
    logger.debug(message)
  }
}

/**
 * Log debug information (stderr, only with --verbose).
 */
export function debug(message: string, data?: unknown): void {
  if (data !== undefined) {
    diagVerbose(`[DEBUG] ${message}: ${JSON.stringify(data)}`)
  } else {
    diagVerbose(`[DEBUG] ${message}`)
  }
}
