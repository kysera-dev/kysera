import chalk from 'chalk'

/**
 * Color utilities for consistent CLI output styling
 */

// Status colors
export const success = chalk.green
export const error = chalk.red
export const warning = chalk.yellow
export const info = chalk.blue
export const debug = chalk.gray

// Emphasis colors
export const bold = chalk.bold
export const dim = chalk.dim
export const italic = chalk.italic
export const underline = chalk.underline
export const strikethrough = chalk.strikethrough

// Semantic colors
export const primary = chalk.cyan
export const secondary = chalk.magenta
export const accent = chalk.yellow
export const muted = chalk.gray

// Specific use colors
export const command = chalk.cyan
export const flag = chalk.yellow
export const value = chalk.green
export const path = chalk.blue
export const url = chalk.blue.underline
export const code = chalk.gray
export const highlight = chalk.bgYellow.black

// Status indicators
export const tick = chalk.green('✔')
export const cross = chalk.red('✖')
export const bullet = chalk.gray('•')
export const arrow = chalk.gray('→')
export const pipe = chalk.gray('│')

/**
 * Format a command for display
 */
export function formatCommand(cmd: string): string {
  return command(cmd)
}

/**
 * Format a flag/option for display
 */
export function formatFlag(flag: string): string {
  return flag(flag)
}

/**
 * Format a file path for display
 */
export function formatPath(p: string): string {
  return path(p)
}

/**
 * Format a URL for display
 */
export function formatUrl(u: string): string {
  return url(u)
}

/**
 * Format code for display
 */
export function formatCode(c: string): string {
  return code(c)
}

/**
 * Format an error message
 */
export function formatError(message: string): string {
  return error(message)
}

/**
 * Format a success message
 */
export function formatSuccess(message: string): string {
  return success(message)
}

/**
 * Format a warning message
 */
export function formatWarning(message: string): string {
  return warning(message)
}

/**
 * Format an info message
 */
export function formatInfo(message: string): string {
  return info(message)
}

/**
 * Create a gradient text (requires terminal support)
 */
export function gradient(text: string, colors: string[] = ['cyan', 'magenta']): string {
  const chars = text.split('')
  const colorFuncs = colors.map(c => (chalk as any)[c])
  const step = Math.max(1, Math.floor(chars.length / (colorFuncs.length - 1)))

  return chars.map((char, i) => {
    const colorIndex = Math.min(Math.floor(i / step), colorFuncs.length - 1)
    return colorFuncs[colorIndex](char)
  }).join('')
}

/**
 * Create a rainbow text
 */
export function rainbow(text: string): string {
  const colors = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta']
  const chars = text.split('')

  return chars.map((char, i) => {
    const color = colors[i % colors.length]
    return (chalk as any)[color](char)
  }).join('')
}

/**
 * Box drawing characters
 */
export const box = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  cross: '┼',
  leftT: '├',
  rightT: '┤',
  topT: '┬',
  bottomT: '┴'
}

/**
 * Create a simple box around text
 */
export function createBox(text: string, padding: number = 1): string {
  const lines = text.split('\n')
  const maxLength = Math.max(...lines.map(l => l.length))
  const paddedWidth = maxLength + (padding * 2)

  const top = box.topLeft + box.horizontal.repeat(paddedWidth) + box.topRight
  const bottom = box.bottomLeft + box.horizontal.repeat(paddedWidth) + box.bottomRight
  const paddingStr = ' '.repeat(padding)

  const content = lines.map(line => {
    const padded = paddingStr + line.padEnd(maxLength, ' ') + paddingStr
    return box.vertical + padded + box.vertical
  }).join('\n')

  return [top, content, bottom].join('\n')
}

/**
 * Create a header with divider
 */
export function createHeader(text: string, width: number = 80): string {
  const padding = Math.max(0, Math.floor((width - text.length - 2) / 2))
  const line = '═'.repeat(width)
  const header = '═'.repeat(padding) + ' ' + text + ' ' + '═'.repeat(width - padding - text.length - 2)

  return chalk.cyan(header)
}

/**
 * Create a divider line
 */
export function createDivider(width: number = 80, char: string = '─'): string {
  return chalk.gray(char.repeat(width))
}

/**
 * Format a key-value pair
 */
export function formatKeyValue(key: string, value: any, keyWidth: number = 20): string {
  const formattedKey = chalk.gray(key.padEnd(keyWidth, '.'))
  const formattedValue = value === null || value === undefined
    ? chalk.gray('none')
    : chalk.white(String(value))

  return `${formattedKey} ${formattedValue}`
}

/**
 * Strip all colors from text
 */
export function stripColors(text: string): string {
  return chalk.stripColor(text)
}

/**
 * Check if colors are supported
 */
export function supportsColor(): boolean {
  return chalk.supportsColor !== false
}