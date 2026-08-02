import { existsSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { RLSSchema } from '@kysera/rls'
import type { KyseraConfig } from '../../config/schema.js'
import { CLIError } from '../../utils/errors.js'

/**
 * RLS schema as loaded from a user module. The concrete Kysely DB type is
 * unknown to the CLI, so tables are keyed by plain strings.
 */
export type LoadedRLSSchema = RLSSchema<Record<string, unknown>>

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.mts', '.js', '.mjs', '.cjs'])

/**
 * Native RLS generation targets PostgreSQL's CREATE POLICY / row security
 * features; refuse anything else up front with an actionable message.
 */
export function requirePostgresDialect(config: KyseraConfig): void {
  const dialect = config.database?.dialect
  if (dialect === 'postgres') return
  throw new CLIError(
    dialect
      ? `Native RLS is PostgreSQL-only; the configured dialect is '${dialect}'`
      : 'Native RLS is PostgreSQL-only and no database dialect is configured',
    'RLS_DIALECT_ERROR',
    undefined,
    [
      'Set database.dialect to "postgres" in your configuration',
      'For other dialects use the ORM-level rlsPlugin() from @kysera/rls instead'
    ]
  )
}

/**
 * Load the user's RLS schema module via dynamic import.
 *
 * Expected shape: the module default-exports the result of
 * `defineRLSSchema({ table: { policies: [...] } })` (a plain object mapping
 * table names to `{ policies: [...] }` configs). Named exports `rlsSchema`
 * or `schema` are accepted as fallbacks.
 *
 * Compiled `.js`/`.mjs`/`.cjs` modules always work. `.ts`/`.mts` work when
 * the runtime can load TypeScript (Node >= 22.18 with erasable-syntax type
 * stripping, or Bun); otherwise a clear error tells the user to point at
 * compiled output.
 */
export async function loadRLSSchemaModule(modulePath: string): Promise<LoadedRLSSchema> {
  const resolved = resolve(process.cwd(), modulePath)

  if (!existsSync(resolved)) {
    throw new CLIError(`RLS schema module not found: ${resolved}`, 'FILE_NOT_FOUND', undefined, [
      'Pass a path to a module that default-exports your defineRLSSchema(...) result'
    ])
  }

  const ext = extname(resolved)
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new CLIError(
      `Unsupported schema module extension '${ext}': ${resolved}`,
      'RLS_SCHEMA_LOAD_ERROR',
      undefined,
      ['Supported extensions: .ts, .mts, .js, .mjs, .cjs']
    )
  }

  let moduleExports: Record<string, unknown>
  try {
    moduleExports = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = (error as { code?: string }).code
    if (code === 'ERR_UNKNOWN_FILE_EXTENSION' || /unknown file extension/i.test(message)) {
      throw new CLIError(
        `This runtime cannot import '${ext}' modules directly: ${resolved}`,
        'RLS_SCHEMA_LOAD_ERROR',
        undefined,
        [
          'Compile the schema module to .js/.mjs and pass the compiled file',
          'Or run the CLI on Node.js >= 22.18 or Bun, which can import TypeScript modules with erasable syntax'
        ]
      )
    }
    throw new CLIError(
      `Failed to load RLS schema module: ${message}`,
      'RLS_SCHEMA_LOAD_ERROR',
      { module: resolved },
      ['Ensure the module is loadable by this runtime (its own imports must resolve)']
    )
  }

  const candidate = moduleExports.default ?? moduleExports.rlsSchema ?? moduleExports.schema

  if (!isRLSSchemaLike(candidate)) {
    throw new CLIError(
      `Module does not export an RLS schema: ${resolved}`,
      'RLS_SCHEMA_INVALID',
      undefined,
      [
        'Default-export the result of defineRLSSchema({ table: { policies: [...] } })',
        "A named export 'rlsSchema' or 'schema' is also accepted",
        'Each table entry must be an object with a policies array'
      ]
    )
  }

  return candidate
}

function isRLSSchemaLike(value: unknown): value is LoadedRLSSchema {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.values(value)
  if (entries.length === 0) return false
  return entries.every(entry => {
    if (entry === undefined) return true
    if (!entry || typeof entry !== 'object') return false
    return Array.isArray((entry as { policies?: unknown }).policies)
  })
}
