import { spinner as rawSpinner, type SpinnerOptions } from '@xec-sh/kit'
import { logger } from './logger.js'
import { isJsonMode, isQuietMode } from './output.js'

/**
 * Extended spinner result with convenience methods for success/warn/fail
 */
export interface ExtendedSpinnerResult {
  start(msg?: string): void
  stop(msg?: string, code?: number): void
  message(msg?: string): void
  succeed(msg?: string): void
  warn(msg?: string): void
  fail(msg?: string): void
  readonly isCancelled: boolean
  text: string | undefined
}

/**
 * Creates a spinner with extended methods for success/warn/fail.
 *
 * Spinners are diagnostics: in JSON mode, quiet mode, or without a TTY
 * they render nothing animated — progress collapses to logger output on
 * stderr so stdout stays reserved for data.
 */
export function spinner(options?: SpinnerOptions): ExtendedSpinnerResult {
  if (isJsonMode() || isQuietMode() || !process.stdout.isTTY) {
    return inertSpinner()
  }

  const base = rawSpinner(options)
  let currentText: string | undefined

  return {
    start(msg?: string) {
      if (msg) currentText = msg
      base.start(msg)
    },
    stop(msg?: string, _code?: number) {
      if (msg) currentText = msg
      base.stop(msg)
    },
    message(msg?: string) {
      if (msg) currentText = msg
      base.message(msg)
    },
    succeed(msg?: string) {
      const message = msg || currentText
      base.stop(message)
      if (message) {
        logger.success(message)
      }
    },
    warn(msg?: string) {
      const message = msg || currentText
      base.stop(message)
      if (message) {
        logger.warn(message)
      }
    },
    fail(msg?: string) {
      const message = msg || currentText
      base.stop(message)
      if (message) {
        logger.error(message)
      }
    },
    get isCancelled() {
      return base.isCancelled
    },
    get text() {
      return currentText
    },
    set text(value: string | undefined) {
      currentText = value
      if (value) {
        base.message(value)
      }
    }
  }
}

/**
 * Spinner stand-in that reports milestones through the logger (stderr)
 * without any animation.
 */
function inertSpinner(): ExtendedSpinnerResult {
  let currentText: string | undefined

  return {
    start(msg?: string) {
      if (msg) currentText = msg
    },
    stop(msg?: string, _code?: number) {
      if (msg) currentText = msg
    },
    message(msg?: string) {
      if (msg) currentText = msg
    },
    succeed(msg?: string) {
      const message = msg || currentText
      if (message) logger.success(message)
    },
    warn(msg?: string) {
      const message = msg || currentText
      if (message) logger.warn(message)
    },
    fail(msg?: string) {
      const message = msg || currentText
      if (message) logger.error(message)
    },
    get isCancelled() {
      return false
    },
    get text() {
      return currentText
    },
    set text(value: string | undefined) {
      currentText = value
    }
  }
}
