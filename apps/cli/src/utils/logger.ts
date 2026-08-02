import { prism, strip } from '@xec-sh/kit'
import { format } from 'node:util'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerOptions {
  level?: LogLevel
  colors?: boolean
  timestamps?: boolean
  json?: boolean
}

/**
 * Diagnostic logger. All leveled output (debug/info/warn/error/success)
 * goes to stderr so stdout stays reserved for command data; `log()` and
 * `table()` write data to stdout.
 */
class Logger {
  public level: LogLevel = 'info'
  public colors = true
  public timestamps = false
  public json = false

  private readonly levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  }

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info'
    this.colors = options.colors !== false
    this.timestamps = options.timestamps ?? false
    this.json = options.json ?? false

    // Disable colors if not in TTY or if NO_COLOR is set
    if (!process.stderr.isTTY || process.env.NO_COLOR) {
      this.colors = false
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.level]
  }

  private formatTimestamp(): string {
    return new Date().toISOString()
  }

  private write(level: LogLevel | 'success', message: string, ...args: unknown[]): void {
    const formatted = format(message, ...args)

    if (this.json) {
      console.error(
        JSON.stringify({ level, message: strip(formatted), timestamp: this.formatTimestamp() })
      )
      return
    }

    let output = ''
    if (this.timestamps) {
      output += this.colors
        ? prism.gray(`[${this.formatTimestamp()}] `)
        : `[${this.formatTimestamp()}] `
    }
    output += `${this.getLevelTag(level)} ${formatted}`
    console.error(output)
  }

  private getLevelTag(level: LogLevel | 'success'): string {
    if (!this.colors) {
      return `[${level.toUpperCase()}]`
    }

    switch (level) {
      case 'debug':
        return prism.gray('[DEBUG]')
      case 'info':
        return prism.blue('[INFO]')
      case 'warn':
        return prism.yellow('[WARN]')
      case 'error':
        return prism.red('[ERROR]')
      case 'success':
        return prism.green('[OK]')
    }
  }

  public debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      this.write('debug', message, ...args)
    }
  }

  public info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      this.write('info', message, ...args)
    }
  }

  public warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      this.write('warn', message, ...args)
    }
  }

  public error(message: string | Error, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      const text = message instanceof Error ? message.message : message
      this.write('error', text, ...args)
      if (message instanceof Error && this.level === 'debug' && message.stack) {
        console.error(this.colors ? prism.gray(message.stack) : message.stack)
      }
    }
  }

  public success(message: string, ...args: unknown[]): void {
    // Success is always shown (like info level)
    if (this.shouldLog('info')) {
      this.write('success', message, ...args)
    }
  }

  public log(message: string, ...args: unknown[]): void {
    // Raw data output without level prefix (stdout)
    console.log(format(message, ...args))
  }

  public newline(): void {
    console.error('')
  }

  public clear(): void {
    if (process.stdout.isTTY) {
      process.stdout.write('\x1Bc')
    }
  }

  public group(label?: string): void {
    if (label) {
      console.log(this.colors ? prism.bold(label) : label)
    }
    console.group()
  }

  public groupEnd(): void {
    console.groupEnd()
  }

  public table(data: unknown, columns?: string[]): void {
    console.table(data, columns)
  }

  public setLevel(level: LogLevel): void {
    this.level = level
  }

  public setColors(enabled: boolean): void {
    this.colors = enabled
  }

  public setTimestamps(enabled: boolean): void {
    this.timestamps = enabled
  }

  public setJson(enabled: boolean): void {
    this.json = enabled
  }
}

// Create default logger instance
export const logger = new Logger({
  level: (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info',
  colors: process.env.FORCE_COLOR !== '0',
  timestamps: process.env.LOG_TIMESTAMPS === 'true',
  json: process.env.LOG_FORMAT === 'json'
})

// Export for creating custom loggers
export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options)
}
