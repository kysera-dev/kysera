import { spinner as rawSpinner, type SpinnerOptions, log } from '@xec-sh/kit'

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
 * Creates a spinner with extended methods for success/warn/fail
 * This wraps @xec-sh/kit spinner to provide a more convenient API
 */
export function spinner(options?: SpinnerOptions): ExtendedSpinnerResult {
  const base = rawSpinner(options)
  let currentText: string | undefined

  return {
    start(msg?: string) {
      if (msg) currentText = msg
      base.start(msg)
    },
    stop(msg?: string, code?: number) {
      if (msg) currentText = msg
      base.stop(msg, code)
    },
    message(msg?: string) {
      if (msg) currentText = msg
      base.message(msg)
    },
    succeed(msg?: string) {
      const message = msg || currentText
      base.stop(message, 0)
      if (message) {
        log.success(message)
      }
    },
    warn(msg?: string) {
      const message = msg || currentText
      base.stop(message, 0)
      if (message) {
        log.warn(message)
      }
    },
    fail(msg?: string) {
      const message = msg || currentText
      base.stop(message, 1)
      if (message) {
        log.error(message)
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
