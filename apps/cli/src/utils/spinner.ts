import ora, { Ora } from 'ora'
import chalk from 'chalk'
import figures from 'figures'

export interface SpinnerOptions {
  text?: string
  color?: 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray'
  spinner?: string
  indent?: number
}

class Spinner {
  private ora: Ora
  private startTime?: number

  constructor(options: SpinnerOptions = {}) {
    this.ora = ora({
      text: options.text || 'Loading...',
      color: options.color || 'cyan',
      spinner: options.spinner || 'dots',
      indent: options.indent || 0
    })
  }

  start(text?: string): this {
    if (text) {
      this.ora.text = text
    }
    this.startTime = Date.now()
    this.ora.start()
    return this
  }

  stop(): this {
    this.ora.stop()
    return this
  }

  succeed(text?: string): this {
    const duration = this.getDuration()
    if (text) {
      this.ora.succeed(text + (duration ? chalk.gray(` (${duration})`) : ''))
    } else {
      this.ora.succeed(this.ora.text + (duration ? chalk.gray(` (${duration})`) : ''))
    }
    return this
  }

  fail(text?: string): this {
    const duration = this.getDuration()
    if (text) {
      this.ora.fail(text + (duration ? chalk.gray(` (${duration})`) : ''))
    } else {
      this.ora.fail(this.ora.text + (duration ? chalk.gray(` (${duration})`) : ''))
    }
    return this
  }

  warn(text?: string): this {
    const duration = this.getDuration()
    if (text) {
      this.ora.warn(text + (duration ? chalk.gray(` (${duration})`) : ''))
    } else {
      this.ora.warn(this.ora.text + (duration ? chalk.gray(` (${duration})`) : ''))
    }
    return this
  }

  info(text?: string): this {
    const duration = this.getDuration()
    if (text) {
      this.ora.info(text + (duration ? chalk.gray(` (${duration})`) : ''))
    } else {
      this.ora.info(this.ora.text + (duration ? chalk.gray(` (${duration})`) : ''))
    }
    return this
  }

  update(text: string): this {
    this.ora.text = text
    return this
  }

  clear(): this {
    this.ora.clear()
    return this
  }

  isSpinning(): boolean {
    return this.ora.isSpinning
  }

  private getDuration(): string | null {
    if (!this.startTime) return null
    const duration = Date.now() - this.startTime
    if (duration < 1000) {
      return `${duration}ms`
    } else if (duration < 60000) {
      return `${(duration / 1000).toFixed(1)}s`
    } else {
      const minutes = Math.floor(duration / 60000)
      const seconds = ((duration % 60000) / 1000).toFixed(0)
      return `${minutes}m ${seconds}s`
    }
  }
}

/**
 * Create a new spinner
 */
export function createSpinner(options: SpinnerOptions = {}): Spinner {
  return new Spinner(options)
}

/**
 * Run an async task with a spinner
 */
export async function withSpinner<T>(
  task: () => Promise<T>,
  options: {
    start?: string
    succeed?: string | ((result: T) => string)
    fail?: string | ((error: Error) => string)
  } = {}
): Promise<T> {
  const spinner = createSpinner({ text: options.start || 'Processing...' })
  spinner.start()

  try {
    const result = await task()
    const successText = typeof options.succeed === 'function'
      ? options.succeed(result)
      : options.succeed
    spinner.succeed(successText)
    return result
  } catch (error) {
    const failText = typeof options.fail === 'function'
      ? options.fail(error as Error)
      : options.fail || (error as Error).message
    spinner.fail(failText)
    throw error
  }
}

/**
 * Run multiple async tasks with progress indication
 */
export async function withProgress<T>(
  tasks: Array<{
    name: string
    task: () => Promise<T>
  }>
): Promise<T[]> {
  const results: T[] = []
  const total = tasks.length

  for (let i = 0; i < tasks.length; i++) {
    const { name, task } = tasks[i]
    const spinner = createSpinner({
      text: `[${i + 1}/${total}] ${name}`
    })

    spinner.start()

    try {
      const result = await task()
      results.push(result)
      spinner.succeed(`[${i + 1}/${total}] ${name}`)
    } catch (error) {
      spinner.fail(`[${i + 1}/${total}] ${name}: ${(error as Error).message}`)
      throw error
    }
  }

  return results
}

/**
 * Display a progress bar for long-running operations
 */
export class ProgressBar {
  private current: number = 0
  private total: number
  private width: number
  private description: string
  private startTime: number

  constructor(total: number, description: string = 'Progress', width: number = 40) {
    this.total = total
    this.description = description
    this.width = width
    this.startTime = Date.now()
  }

  update(current: number, text?: string): void {
    this.current = Math.min(current, this.total)
    this.render(text)
  }

  increment(text?: string): void {
    this.update(this.current + 1, text)
  }

  complete(text?: string): void {
    this.update(this.total, text)
    console.log() // New line after completion
  }

  private render(text?: string): void {
    const percent = Math.floor((this.current / this.total) * 100)
    const filled = Math.floor((this.current / this.total) * this.width)
    const empty = this.width - filled

    const bar = chalk.green('█').repeat(filled) + chalk.gray('░').repeat(empty)
    const progress = `${this.current}/${this.total}`
    const time = this.getElapsedTime()

    process.stdout.write('\r')
    process.stdout.write(
      `${this.description} ${bar} ${chalk.cyan(percent + '%')} ${chalk.gray(progress)} ${chalk.gray(time)}`
    )

    if (text) {
      process.stdout.write(` ${chalk.gray(text)}`)
    }

    if (this.current === this.total) {
      process.stdout.write(` ${chalk.green(figures.tick)}`)
    }
  }

  private getElapsedTime(): string {
    const elapsed = Date.now() - this.startTime
    if (elapsed < 1000) {
      return `${elapsed}ms`
    } else if (elapsed < 60000) {
      return `${(elapsed / 1000).toFixed(1)}s`
    } else {
      const minutes = Math.floor(elapsed / 60000)
      const seconds = ((elapsed % 60000) / 1000).toFixed(0)
      return `${minutes}m ${seconds}s`
    }
  }
}

/**
 * Create a progress bar
 */
export function createProgressBar(
  total: number,
  description?: string,
  width?: number
): ProgressBar {
  return new ProgressBar(total, description, width)
}