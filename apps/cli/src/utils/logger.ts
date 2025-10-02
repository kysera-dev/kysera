import chalk from 'chalk'
import stripAnsi from 'strip-ansi'
import { format } from 'node:util'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerOptions {
  level?: LogLevel
  colors?: boolean
  timestamps?: boolean
  json?: boolean
}

class Logger {
  public level: LogLevel = 'info'
  public colors: boolean = true
  public timestamps: boolean = false
  public json: boolean = false

  private readonly levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  }

  constructor(options: LoggerOptions = {}) {
    this.level = options.level || 'info'
    this.colors = options.colors !== false
    this.timestamps = options.timestamps || false
    this.json = options.json || false

    // Disable colors if not in TTY or if NO_COLOR is set
    if (!process.stdout.isTTY || process.env.NO_COLOR) {
      this.colors = false
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.level]
  }

  private formatTimestamp(): string {
    const now = new Date()
    return now.toISOString()
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
    const formattedMessage = format(message, ...args)

    if (this.json) {
      const entry = {
        level,
        message: stripAnsi(formattedMessage),
        timestamp: this.formatTimestamp()
      }
      return JSON.stringify(entry)
    }

    let output = ''

    if (this.timestamps) {
      output += chalk.gray(`[${this.formatTimestamp()}] `)
    }

    const levelTag = this.getLevelTag(level)
    output += `${levelTag} ${formattedMessage}`

    return output
  }

  private getLevelTag(level: LogLevel): string {
    if (!this.colors) {
      return `[${level.toUpperCase()}]`
    }

    switch (level) {
      case 'debug':
        return chalk.gray('[DEBUG]')
      case 'info':
        return chalk.blue('[INFO]')
      case 'warn':
        return chalk.yellow('[WARN]')
      case 'error':
        return chalk.red('[ERROR]')
    }
  }

  public debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, ...args))
    }
  }

  public info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, ...args))
    }
  }

  public warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, ...args))
    }
  }

  public error(message: string | Error, ...args: any[]): void {
    if (this.shouldLog('error')) {
      if (message instanceof Error) {
        console.error(this.formatMessage('error', message.message, ...args))
        if (this.level === 'debug' && message.stack) {
          console.error(chalk.gray(message.stack))
        }
      } else {
        console.error(this.formatMessage('error', message, ...args))
      }
    }
  }

  public success(message: string, ...args: any[]): void {
    // Success is always shown (like info level)
    if (this.shouldLog('info')) {
      const formattedMessage = format(message, ...args)
      if (this.json) {
        const entry = {
          level: 'success',
          message: stripAnsi(formattedMessage),
          timestamp: this.formatTimestamp()
        }
        console.log(JSON.stringify(entry))
      } else {
        let output = ''
        if (this.timestamps) {
          output += chalk.gray(`[${this.formatTimestamp()}] `)
        }
        output += chalk.green('✔') + ' ' + formattedMessage
        console.log(output)
      }
    }
  }

  public log(message: string, ...args: any[]): void {
    // Raw log without level prefix
    console.log(format(message, ...args))
  }

  public newline(): void {
    console.log('')
  }

  public clear(): void {
    if (process.stdout.isTTY) {
      process.stdout.write('\x1Bc')
    }
  }

  public group(label?: string): void {
    if (label) {
      console.log(this.colors ? chalk.bold(label) : label)
    }
    console.group()
  }

  public groupEnd(): void {
    console.groupEnd()
  }

  public table(data: any, columns?: string[]): void {
    console.table(data, columns)
  }
}

// Create default logger instance
export const logger = new Logger({
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
  colors: process.env.FORCE_COLOR !== '0',
  timestamps: process.env.LOG_TIMESTAMPS === 'true',
  json: process.env.LOG_FORMAT === 'json'
})

// Export for creating custom loggers
export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options)
}