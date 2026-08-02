import { prism } from '@xec-sh/kit'
import { displayTable } from './table-helper.js'

/**
 * Single output contract for the CLI.
 *
 * - stdout carries data only (JSON, tables, text results)
 * - stderr carries diagnostics (progress notes, warnings, errors)
 * - In JSON mode, errors are emitted to stderr as JSON
 */

export type OutputFormat = 'json' | 'table' | 'text'

interface OutputState {
  json: boolean
  quiet: boolean
  verbose: boolean
}

const state: OutputState = { json: false, quiet: false, verbose: false }

/**
 * Configure output mode for this invocation. Called once from the
 * global preAction hook; later calls merge (e.g. a subcommand's --json).
 */
export function configureOutput(options: {
  json?: boolean
  quiet?: boolean
  verbose?: boolean
}): void {
  if (options.json !== undefined) state.json = options.json
  if (options.quiet !== undefined) state.quiet = options.quiet
  if (options.verbose !== undefined) state.verbose = options.verbose
}

/** Reset output state (used by tests). */
export function resetOutput(): void {
  state.json = false
  state.quiet = false
  state.verbose = false
}

export function isJsonMode(): boolean {
  return state.json
}

export function isQuietMode(): boolean {
  return state.quiet
}

export function isVerboseMode(): boolean {
  return state.verbose
}

export interface OutputOptions<T> {
  /** Force a specific format regardless of global JSON mode */
  format?: OutputFormat
  /** Human-readable rendering; used when not in JSON mode */
  text?: string | ((data: T) => string)
  /** Table rows rendering; used when not in JSON mode */
  table?: Array<Record<string, string>> | ((data: T) => Array<Record<string, string>>)
}

/**
 * Write result data to stdout.
 *
 * JSON mode (global --json or format: 'json') always wins and emits
 * `data` serialized as JSON. Otherwise `table` rows or `text` are used,
 * falling back to a plain rendering of `data`.
 */
export function output<T>(data: T, options: OutputOptions<T> = {}): void {
  if (state.json || options.format === 'json') {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
    return
  }

  if (options.table !== undefined && options.format !== 'text') {
    const rows = typeof options.table === 'function' ? options.table(data) : options.table
    if (rows.length > 0) {
      displayTable(rows)
    }
    return
  }

  if (options.text !== undefined) {
    const text = typeof options.text === 'function' ? options.text(data) : options.text
    process.stdout.write(`${text}\n`)
    return
  }

  if (typeof data === 'string') {
    process.stdout.write(`${data}\n`)
  } else {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
  }
}

/** Diagnostic note on stderr. Suppressed by --quiet. */
export function diag(message: string): void {
  if (state.quiet) return
  process.stderr.write(`${message}\n`)
}

/** Diagnostic note on stderr, only shown with --verbose. */
export function diagVerbose(message: string): void {
  if (!state.verbose || state.quiet) return
  process.stderr.write(`${prism.gray(message)}\n`)
}

/**
 * Emit an error payload. In JSON mode this is a JSON document on stderr;
 * otherwise the given fallback renderer is used (also on stderr).
 */
export function outputError(payload: Record<string, unknown>, fallback?: () => void): void {
  if (state.json) {
    process.stderr.write(`${JSON.stringify({ error: payload }, null, 2)}\n`)
    return
  }
  if (fallback) {
    fallback()
  } else {
    process.stderr.write(`${String(payload['message'] ?? 'Unknown error')}\n`)
  }
}

const URL_CREDENTIALS = /\/\/([^:@/\s]+):([^@/\s]+)@/g

/**
 * Redact credentials embedded in a connection string
 * (`postgres://user:secret@host/db` -> `postgres://user:***@host/db`).
 */
export function redactConnectionString(connection: string): string {
  return connection.replace(URL_CREDENTIALS, '//$1:***@')
}

/**
 * Redact a connection value of any shape (string URL or object with a
 * password property) for safe printing.
 */
export function redactConnection(connection: unknown): unknown {
  if (typeof connection === 'string') {
    return redactConnectionString(connection)
  }
  if (connection && typeof connection === 'object') {
    const record = { ...(connection as Record<string, unknown>) }
    if ('password' in record && record['password'] !== undefined) {
      record['password'] = '***'
    }
    return record
  }
  return connection
}

/**
 * Convert a date-ish value (Date, ISO string, epoch number) to an ISO
 * string, or null when absent/invalid. SQLite returns strings where
 * PostgreSQL returns Date objects; this guards both.
 */
export function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
  }
  return null
}

/** Coerce a date-ish value to a Date, or null when absent/invalid. */
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}
