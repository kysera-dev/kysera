import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Kysely } from 'kysely'
import type { DatabaseConfig, KyseraConfig } from '../../config/schema.js'
import type { Database } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { findConfigFile } from '../../config/resolver.js'
import { discoverMigrationFiles } from '../migrate/runner.js'

/**
 * Doctor probes. Every probe returns checks instead of throwing: a broken
 * environment is the expected input here, so failures are data, not errors.
 */

export type DoctorStatus = 'pass' | 'warn' | 'fail'

export interface DoctorCheck {
  /** Namespaced id, `<section>.<name>` (e.g. `database.connect`) */
  id: string
  status: DoctorStatus
  detail: string
}

export interface DoctorSummary {
  pass: number
  warn: number
  fail: number
  status: DoctorStatus
}

export interface CliPackageInfo {
  version: string
  engines?: { node?: string }
}

/**
 * Locate the CLI's own package.json by walking up from this module.
 * Works from src (dev/tests), dist (built) and global installs alike.
 */
export function readCliPackage(): CliPackageInfo {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
          name?: string
          version?: string
          engines?: { node?: string }
        }
        if (parsed.name === '@kysera/cli') {
          const info: CliPackageInfo = { version: parsed.version ?? '0.0.0' }
          if (parsed.engines) info.engines = parsed.engines
          return info
        }
      } catch {
        // Unreadable package.json on the way up: keep walking.
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return { version: '0.0.0' }
    dir = parent
  }
}

/**
 * Check a version against a simple `>=x.y.z` constraint (the only form the
 * CLI's engines field uses). Returns null when the constraint has another
 * shape and cannot be evaluated here.
 */
export function satisfiesMinVersion(version: string, range: string): boolean | null {
  const required = /^>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(range.trim())
  if (!required) return null
  const current = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (!current) return null
  const want = [Number(required[1]), Number(required.at(2) ?? '0'), Number(required.at(3) ?? '0')]
  const have = [Number(current[1]), Number(current[2]), Number(current[3])]
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0
    const b = want[i] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return true
}

export interface InstalledPackage {
  version: string
  path: string
}

/**
 * Find a package in the nearest node_modules, walking up from startDir.
 * Reads package.json directly from disk, so pnpm symlinks and packages
 * without an exports entry for package.json both work.
 */
export function findInstalledPackage(name: string, startDir: string): InstalledPackage | null {
  let dir = resolve(startDir)
  for (;;) {
    const pkgPath = join(dir, 'node_modules', ...name.split('/'), 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
        return { version: parsed.version ?? 'unknown', path: dirname(pkgPath) }
      } catch {
        return null
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Runtime section: Node version against the CLI's engines constraint,
 * plus platform information.
 */
export function checkRuntime(pkg: CliPackageInfo = readCliPackage()): DoctorCheck[] {
  const checks: DoctorCheck[] = []
  const nodeVersion = process.versions.node
  const required = pkg.engines?.node

  if (!required) {
    checks.push({
      id: 'runtime.node',
      status: 'warn',
      detail: `v${nodeVersion} (no engines.node constraint found in the CLI package.json)`
    })
  } else {
    const ok = satisfiesMinVersion(nodeVersion, required)
    if (ok === null) {
      checks.push({
        id: 'runtime.node',
        status: 'warn',
        detail: `v${nodeVersion} (cannot evaluate engines constraint '${required}')`
      })
    } else if (ok) {
      checks.push({
        id: 'runtime.node',
        status: 'pass',
        detail: `v${nodeVersion} (satisfies ${required})`
      })
    } else {
      checks.push({
        id: 'runtime.node',
        status: 'fail',
        detail: `v${nodeVersion} does not satisfy required ${required} - upgrade Node.js`
      })
    }
  }

  const bunVersion = (process.versions as { bun?: string }).bun
  const runtimeLabel = bunVersion ? `bun ${bunVersion}` : `node v${nodeVersion}`
  checks.push({
    id: 'runtime.platform',
    status: 'pass',
    detail: `${process.platform} ${process.arch} (${runtimeLabel})`
  })

  return checks
}

export interface ConfigProbeDeps {
  load?: (configPath?: string) => Promise<KyseraConfig>
  find?: () => string | null
}

export interface ConfigProbeResult {
  checks: DoctorCheck[]
  config: KyseraConfig | null
  source: string | null
}

/**
 * Configuration section: which config file won discovery, what environment
 * inputs are visible, and whether the configuration validates. Validation
 * errors (including Zod issues) are reported verbatim.
 */
export async function checkConfig(
  configFlag?: string,
  deps: ConfigProbeDeps = {}
): Promise<ConfigProbeResult> {
  const load = deps.load ?? loadConfig
  const find = deps.find ?? ((): string | null => findConfigFile())
  const checks: DoctorCheck[] = []
  let source: string | null = null

  const envConfigPath = process.env.KYSERA_CONFIG
  if (configFlag) {
    source = resolve(process.cwd(), configFlag)
    const exists = existsSync(source)
    checks.push({
      id: 'config.discovery',
      status: exists ? 'pass' : 'fail',
      detail: exists ? `--config ${source}` : `--config ${source} (file not found)`
    })
  } else if (envConfigPath) {
    source = resolve(process.cwd(), envConfigPath)
    const exists = existsSync(source)
    checks.push({
      id: 'config.discovery',
      status: exists ? 'pass' : 'fail',
      detail: exists ? `KYSERA_CONFIG=${source}` : `KYSERA_CONFIG=${source} (file not found)`
    })
  } else {
    const found = find()
    if (found) {
      source = found
      checks.push({ id: 'config.discovery', status: 'pass', detail: found })
    } else {
      checks.push({
        id: 'config.discovery',
        status: 'warn',
        detail: 'no configuration file found - using built-in defaults'
      })
    }
  }

  const envInputs = [
    process.env.DATABASE_URL ? 'DATABASE_URL set' : 'DATABASE_URL not set',
    existsSync(resolve(process.cwd(), '.env')) ? '.env present' : '.env absent',
    configFlag ? '--config given' : '--config not given'
  ]
  checks.push({ id: 'config.env', status: 'pass', detail: envInputs.join('; ') })

  let config: KyseraConfig | null = null
  try {
    config = await load(configFlag)
    const dialect = config.database?.dialect
    checks.push({
      id: 'config.validation',
      status: 'pass',
      detail: dialect ? `valid (dialect: ${dialect})` : 'valid (no database section)'
    })
  } catch (error) {
    checks.push({
      id: 'config.validation',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error)
    })
  }

  return { checks, config, source }
}

/**
 * A null config means loading/validation failed (that fail check is
 * already reported); a config without a database section is valid but
 * databaseless. Word the dependent skips accordingly.
 */
function skipReason(config: KyseraConfig | null): string {
  return config === null
    ? 'skipped: configuration not loaded'
    : 'skipped: no database configuration'
}

const DRIVER_BY_DIALECT: Record<'postgres' | 'mysql' | 'sqlite', string> = {
  postgres: 'pg',
  mysql: 'mysql2',
  sqlite: 'better-sqlite3'
}

export type DriverImporter = (name: string) => Promise<void>

const importDriverModule: DriverImporter = async name => {
  await import(name)
}

/**
 * Drivers section: is the driver for the configured dialect importable in
 * this environment, and which version resolves.
 */
export async function checkDrivers(
  config: KyseraConfig | null,
  importDriver: DriverImporter = importDriverModule
): Promise<DoctorCheck[]> {
  if (!config?.database) {
    return [{ id: 'drivers.driver', status: 'warn', detail: skipReason(config) }]
  }

  const dialect = config.database.dialect
  const driver = DRIVER_BY_DIALECT[dialect]
  const installed =
    findInstalledPackage(driver, process.cwd()) ??
    findInstalledPackage(driver, dirname(fileURLToPath(import.meta.url)))

  try {
    await importDriver(driver)
    const version = installed ? `v${installed.version}` : 'version unknown'
    return [{ id: `drivers.${driver}`, status: 'pass', detail: `${version} (dialect: ${dialect})` }]
  } catch (error) {
    const message = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)
    return [
      {
        id: `drivers.${driver}`,
        status: 'fail',
        detail: `failed to load: ${message} - try reinstalling dependencies`
      }
    ]
  }
}

export interface DoctorDbHandle {
  db: Kysely<Database>
  close: () => Promise<void>
}

export type DoctorConnector = (dbConfig: DatabaseConfig) => Promise<DoctorDbHandle>

const defaultConnector: DoctorConnector = async dbConfig => {
  const { createDatabaseConnection } = await import('../../utils/database.js')
  const connection = await createDatabaseConnection({ config: dbConfig })
  if ('db' in connection) {
    return { db: connection.db, close: connection.close }
  }
  return {
    db: connection,
    close: async () => {
      await connection.destroy()
    }
  }
}

/**
 * Database section: connectivity with latency, then migration state
 * (migrations table present? executed vs pending counts).
 */
export async function checkDatabase(
  config: KyseraConfig | null,
  connect: DoctorConnector = defaultConnector
): Promise<DoctorCheck[]> {
  if (!config?.database) {
    return [
      { id: 'database.connect', status: 'warn', detail: skipReason(config) },
      { id: 'database.migrations', status: 'warn', detail: skipReason(config) }
    ]
  }

  const checks: DoctorCheck[] = []
  let handle: DoctorDbHandle | null = null

  try {
    handle = await connect(config.database)
    const { sql } = await import('kysely')
    const started = performance.now()
    await sql`SELECT 1`.execute(handle.db)
    const latency = Math.max(1, Math.round(performance.now() - started))
    checks.push({
      id: 'database.connect',
      status: 'pass',
      detail: `connected in ${latency}ms (dialect: ${config.database.dialect})`
    })
  } catch (error) {
    checks.push({
      id: 'database.connect',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error)
    })
    checks.push({
      id: 'database.migrations',
      status: 'warn',
      detail: 'skipped: database not reachable'
    })
    if (handle) {
      await handle.close().catch(() => undefined)
    }
    return checks
  }

  try {
    checks.push(await migrationsCheck(handle.db, config))
  } catch (error) {
    checks.push({
      id: 'database.migrations',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error)
    })
  } finally {
    await handle.close().catch(() => undefined)
  }

  return checks
}

async function migrationsCheck(db: Kysely<Database>, config: KyseraConfig): Promise<DoctorCheck> {
  const tableName = config.migrations?.tableName ?? 'migrations'
  const directory = config.migrations?.directory ?? resolve(process.cwd(), 'migrations')
  const schema = config.migrations?.schema ?? config.database?.schema ?? 'public'
  const files = discoverMigrationFiles(directory)
  const shownDir = relative(process.cwd(), directory) || '.'

  const tables = await db.introspection.getTables({ withInternalKyselyTables: true })
  const candidates = tables.filter(table => table.name === tableName)
  const tableExists =
    schema !== 'public' ? candidates.some(table => table.schema === schema) : candidates.length > 0

  if (!tableExists) {
    return {
      id: 'database.migrations',
      status: 'warn',
      detail:
        `migration table '${tableName}' not found; ${files.length} migration file(s) in ` +
        `${shownDir} - run 'kysera migrate up'`
    }
  }

  const scopedDb = schema === 'public' ? db : db.withSchema(schema)
  const rows = await scopedDb.selectFrom(tableName).select('name').execute()
  const executedNames = new Set(rows.map(row => String(row.name)))
  const pending = files.filter(file => !executedNames.has(file.name)).length
  const counts = `${executedNames.size} executed, ${pending} pending (directory: ${shownDir})`

  if (pending > 0) {
    return {
      id: 'database.migrations',
      status: 'warn',
      detail: `${counts} - run 'kysera migrate up'`
    }
  }
  return { id: 'database.migrations', status: 'pass', detail: counts }
}

const KYSERA_PACKAGES = [
  'audit',
  'core',
  'dal',
  'debug',
  'dialects',
  'executor',
  'infra',
  'migrations',
  'repository',
  'rls',
  'soft-delete',
  'testing',
  'timestamps'
] as const

/**
 * Versions section: @kysera/* packages resolved from the nearest
 * node_modules, compared against the CLI's own version.
 */
export function checkVersions(cliVersion: string, startDir: string = process.cwd()): DoctorCheck[] {
  const checks: DoctorCheck[] = [
    { id: 'versions.cli', status: 'pass', detail: `@kysera/cli v${cliVersion}` }
  ]

  const found: { name: string; version: string }[] = []
  for (const shortName of KYSERA_PACKAGES) {
    const installed = findInstalledPackage(`@kysera/${shortName}`, startDir)
    if (installed) {
      found.push({ name: shortName, version: installed.version })
    }
  }

  if (found.length === 0) {
    checks.push({
      id: 'versions.packages',
      status: 'warn',
      detail: 'no @kysera/* packages found in node_modules (is this a Kysera project?)'
    })
    return checks
  }

  const listing = found.map(pkg => `${pkg.name}@${pkg.version}`).join(', ')
  const drifted = found.filter(pkg => pkg.version !== cliVersion)
  if (drifted.length > 0) {
    checks.push({
      id: 'versions.packages',
      status: 'warn',
      detail: `version drift vs CLI v${cliVersion}: ${listing}`
    })
  } else {
    checks.push({
      id: 'versions.packages',
      status: 'pass',
      detail: `${found.length} package(s) at v${cliVersion}: ${listing}`
    })
  }

  return checks
}

/** Aggregate check counts; overall status is the worst individual status. */
export function summarize(checks: DoctorCheck[]): DoctorSummary {
  let pass = 0
  let warn = 0
  let fail = 0
  for (const check of checks) {
    if (check.status === 'pass') pass++
    else if (check.status === 'warn') warn++
    else fail++
  }
  return { pass, warn, fail, status: fail > 0 ? 'fail' : warn > 0 ? 'warn' : 'pass' }
}
