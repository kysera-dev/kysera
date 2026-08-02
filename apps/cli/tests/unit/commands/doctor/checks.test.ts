import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import SqliteDatabase from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import {
  checkConfig,
  checkDatabase,
  checkDrivers,
  checkRuntime,
  checkVersions,
  findInstalledPackage,
  readCliPackage,
  satisfiesMinVersion,
  summarize,
  type DoctorCheck,
  type DoctorConnector
} from '../../../../src/commands/doctor/checks.js'
import { ConfigurationError } from '../../../../src/utils/errors.js'
import type { KyseraConfig } from '../../../../src/config/schema.js'
import type { Database } from '../../../../src/utils/database.js'

const byId = (checks: DoctorCheck[], id: string): DoctorCheck => {
  const found = checks.find(check => check.id === id)
  if (!found) throw new Error(`check '${id}' missing in ${JSON.stringify(checks)}`)
  return found
}

describe('doctor checks', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kysera-doctor-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('satisfiesMinVersion', () => {
    it('accepts a version equal to the minimum', () => {
      expect(satisfiesMinVersion('22.18.0', '>=22.18.0')).toBe(true)
    })

    it('accepts a newer version', () => {
      expect(satisfiesMinVersion('23.1.0', '>=22.18.0')).toBe(true)
      expect(satisfiesMinVersion('22.19.0', '>=22.18.0')).toBe(true)
    })

    it('rejects an older version', () => {
      expect(satisfiesMinVersion('22.17.9', '>=22.18.0')).toBe(false)
      expect(satisfiesMinVersion('20.11.0', '>=22.18.0')).toBe(false)
    })

    it('returns null for constraints it cannot evaluate', () => {
      expect(satisfiesMinVersion('22.18.0', '^22.0.0')).toBeNull()
      expect(satisfiesMinVersion('22.18.0', '>=20 <23')).toBeNull()
      expect(satisfiesMinVersion('not-a-version', '>=22.18.0')).toBeNull()
    })
  })

  describe('readCliPackage', () => {
    it('finds the @kysera/cli package.json with version and engines', () => {
      const pkg = readCliPackage()
      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/)
      expect(pkg.engines?.node).toContain('>=')
    })
  })

  describe('checkRuntime', () => {
    it('passes when the running node satisfies the constraint', () => {
      const checks = checkRuntime({ version: '1.0.0', engines: { node: '>=0.1.0' } })
      expect(byId(checks, 'runtime.node').status).toBe('pass')
    })

    it('fails when the running node is too old for the constraint', () => {
      const checks = checkRuntime({ version: '1.0.0', engines: { node: '>=99.0.0' } })
      const node = byId(checks, 'runtime.node')
      expect(node.status).toBe('fail')
      expect(node.detail).toContain('>=99.0.0')
    })

    it('warns when the engines constraint is missing', () => {
      const checks = checkRuntime({ version: '1.0.0' })
      expect(byId(checks, 'runtime.node').status).toBe('warn')
    })

    it('warns when the engines constraint cannot be evaluated', () => {
      const checks = checkRuntime({ version: '1.0.0', engines: { node: '^22' } })
      const node = byId(checks, 'runtime.node')
      expect(node.status).toBe('warn')
      expect(node.detail).toContain('^22')
    })

    it('always reports the platform as pass', () => {
      const checks = checkRuntime({ version: '1.0.0', engines: { node: '>=99.0.0' } })
      const platform = byId(checks, 'runtime.platform')
      expect(platform.status).toBe('pass')
      expect(platform.detail).toContain(process.platform)
    })
  })

  describe('checkConfig', () => {
    const savedDatabaseUrl = process.env.DATABASE_URL

    afterEach(() => {
      if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = savedDatabaseUrl
    })

    it('reports the discovered config file and valid configuration', async () => {
      const config = { database: { dialect: 'sqlite', database: ':memory:' } } as KyseraConfig
      const result = await checkConfig(undefined, {
        load: () => Promise.resolve(config),
        find: () => '/project/kysera.config.ts'
      })
      expect(byId(result.checks, 'config.discovery').status).toBe('pass')
      expect(byId(result.checks, 'config.discovery').detail).toContain('/project/kysera.config.ts')
      const validation = byId(result.checks, 'config.validation')
      expect(validation.status).toBe('pass')
      expect(validation.detail).toContain('sqlite')
      expect(result.config).toBe(config)
    })

    it('warns when no configuration file is found', async () => {
      const result = await checkConfig(undefined, {
        load: () => Promise.resolve({} as KyseraConfig),
        find: () => null
      })
      const discovery = byId(result.checks, 'config.discovery')
      expect(discovery.status).toBe('warn')
      expect(discovery.detail).toContain('built-in defaults')
    })

    it('turns validation errors into a fail check with the message verbatim', async () => {
      const message =
        'Configuration validation failed:\n  - database.dialect: Invalid enum value'
      const result = await checkConfig(undefined, {
        load: () => Promise.reject(new ConfigurationError(message)),
        find: () => '/project/kysera.config.json'
      })
      const validation = byId(result.checks, 'config.validation')
      expect(validation.status).toBe('fail')
      expect(validation.detail).toBe(message)
      expect(result.config).toBeNull()
    })

    it('fails discovery when an explicit --config path does not exist', async () => {
      const missing = join(tempDir, 'nope.config.json')
      const result = await checkConfig(missing, {
        load: () => Promise.reject(new Error('unreadable')),
        find: () => null
      })
      const discovery = byId(result.checks, 'config.discovery')
      expect(discovery.status).toBe('fail')
      expect(discovery.detail).toContain('file not found')
    })

    it('reports environment inputs (DATABASE_URL, .env, --config)', async () => {
      process.env.DATABASE_URL = 'postgres://user:secret@localhost/app'
      const result = await checkConfig(undefined, {
        load: () => Promise.resolve({} as KyseraConfig),
        find: () => null
      })
      const env = byId(result.checks, 'config.env')
      expect(env.status).toBe('pass')
      expect(env.detail).toContain('DATABASE_URL set')
      expect(env.detail).toContain('--config not given')
      expect(env.detail).not.toContain('secret')
    })
  })

  describe('checkDrivers', () => {
    it('warns when the configuration failed to load', async () => {
      const checks = await checkDrivers(null)
      expect(checks).toHaveLength(1)
      expect(checks[0]!.status).toBe('warn')
      expect(checks[0]!.detail).toContain('configuration not loaded')
    })

    it('warns when a valid configuration has no database section', async () => {
      const checks = await checkDrivers({} as KyseraConfig)
      expect(checks[0]!.status).toBe('warn')
      expect(checks[0]!.detail).toContain('no database configuration')
    })

    it('passes for an importable driver and reports a version', async () => {
      const config = { database: { dialect: 'sqlite', database: ':memory:' } } as KyseraConfig
      const checks = await checkDrivers(config)
      const check = byId(checks, 'drivers.better-sqlite3')
      expect(check.status).toBe('pass')
      expect(check.detail).toMatch(/v\d+\.\d+\.\d+/)
    })

    it('fails when the driver cannot be imported', async () => {
      const config = { database: { dialect: 'postgres', connection: 'x' } } as KyseraConfig
      const checks = await checkDrivers(config, () =>
        Promise.reject(new Error('Cannot find module pg'))
      )
      const check = byId(checks, 'drivers.pg')
      expect(check.status).toBe('fail')
      expect(check.detail).toContain('Cannot find module pg')
    })
  })

  describe('checkDatabase', () => {
    const sqliteConfig = (migrationsDir: string): KyseraConfig =>
      ({
        database: { dialect: 'sqlite', database: ':memory:' },
        migrations: { directory: migrationsDir, tableName: 'migrations' }
      }) as KyseraConfig

    const connectorFor =
      (database: SqliteDatabase.Database): DoctorConnector =>
      () => {
        const db = new Kysely<Database>({ dialect: new SqliteDialect({ database }) })
        return Promise.resolve({
          db,
          close: async () => {
            await db.destroy()
          }
        })
      }

    it('warns twice when there is no usable configuration', async () => {
      const notLoaded = await checkDatabase(null)
      expect(byId(notLoaded, 'database.connect').status).toBe('warn')
      expect(byId(notLoaded, 'database.connect').detail).toContain('configuration not loaded')
      const noDatabase = await checkDatabase({} as KyseraConfig)
      expect(byId(noDatabase, 'database.migrations').status).toBe('warn')
      expect(byId(noDatabase, 'database.migrations').detail).toContain('no database configuration')
    })

    it('turns a connection failure into a fail check and skips migrations', async () => {
      const checks = await checkDatabase(sqliteConfig(tempDir), () =>
        Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432'))
      )
      const connect = byId(checks, 'database.connect')
      expect(connect.status).toBe('fail')
      expect(connect.detail).toContain('ECONNREFUSED')
      expect(byId(checks, 'database.migrations').status).toBe('warn')
      expect(byId(checks, 'database.migrations').detail).toContain('not reachable')
    })

    it('reports latency and a missing migrations table on a fresh database', async () => {
      const migrationsDir = join(tempDir, 'migrations')
      mkdirSync(migrationsDir)
      writeFileSync(join(migrationsDir, '20240101000000_a.ts'), 'export {}')
      const database = new SqliteDatabase(':memory:')
      const checks = await checkDatabase(sqliteConfig(migrationsDir), connectorFor(database))
      const connect = byId(checks, 'database.connect')
      expect(connect.status).toBe('pass')
      expect(connect.detail).toMatch(/connected in \d+ms/)
      const migrations = byId(checks, 'database.migrations')
      expect(migrations.status).toBe('warn')
      expect(migrations.detail).toContain("migration table 'migrations' not found")
      expect(migrations.detail).toContain('1 migration file(s)')
    })

    it('counts executed and pending migrations', async () => {
      const migrationsDir = join(tempDir, 'migrations')
      mkdirSync(migrationsDir)
      writeFileSync(join(migrationsDir, '20240101000000_a.ts'), 'export {}')
      writeFileSync(join(migrationsDir, '20240102000000_b.ts'), 'export {}')
      const database = new SqliteDatabase(':memory:')
      database.exec(
        `CREATE TABLE migrations (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           name TEXT NOT NULL,
           timestamp TEXT,
           executed_at TEXT,
           batch INTEGER
         );
         INSERT INTO migrations (name, timestamp, executed_at, batch)
         VALUES ('20240101000000_a', '20240101000000', '2024-01-01T00:00:00Z', 1);`
      )
      const checks = await checkDatabase(sqliteConfig(migrationsDir), connectorFor(database))
      const migrations = byId(checks, 'database.migrations')
      expect(migrations.status).toBe('warn')
      expect(migrations.detail).toContain('1 executed, 1 pending')
    })

    it('passes when every migration file has been executed', async () => {
      const migrationsDir = join(tempDir, 'migrations')
      mkdirSync(migrationsDir)
      writeFileSync(join(migrationsDir, '20240101000000_a.ts'), 'export {}')
      const database = new SqliteDatabase(':memory:')
      database.exec(
        `CREATE TABLE migrations (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           name TEXT NOT NULL,
           timestamp TEXT,
           executed_at TEXT,
           batch INTEGER
         );
         INSERT INTO migrations (name, timestamp, executed_at, batch)
         VALUES ('20240101000000_a', '20240101000000', '2024-01-01T00:00:00Z', 1);`
      )
      const checks = await checkDatabase(sqliteConfig(migrationsDir), connectorFor(database))
      const migrations = byId(checks, 'database.migrations')
      expect(migrations.status).toBe('pass')
      expect(migrations.detail).toContain('1 executed, 0 pending')
    })
  })

  describe('findInstalledPackage / checkVersions', () => {
    it('finds a package in the nearest node_modules', () => {
      const pkgDir = join(tempDir, 'node_modules', '@kysera', 'core')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ version: '1.2.3' }))
      const nested = join(tempDir, 'src', 'deep')
      mkdirSync(nested, { recursive: true })
      expect(findInstalledPackage('@kysera/core', nested)?.version).toBe('1.2.3')
      expect(findInstalledPackage('@kysera/nonexistent', nested)).toBeNull()
    })

    it('passes when installed packages match the CLI version', () => {
      const pkgDir = join(tempDir, 'node_modules', '@kysera', 'core')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ version: '1.2.3' }))
      const checks = checkVersions('1.2.3', tempDir)
      expect(byId(checks, 'versions.cli').detail).toContain('1.2.3')
      const packages = byId(checks, 'versions.packages')
      expect(packages.status).toBe('pass')
      expect(packages.detail).toContain('core@1.2.3')
    })

    it('warns on version drift against the CLI', () => {
      const pkgDir = join(tempDir, 'node_modules', '@kysera', 'core')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ version: '1.2.3' }))
      const packages = byId(checkVersions('9.9.9', tempDir), 'versions.packages')
      expect(packages.status).toBe('warn')
      expect(packages.detail).toContain('version drift')
    })

    it('warns when no @kysera packages are installed', () => {
      const packages = byId(checkVersions('1.0.0', tempDir), 'versions.packages')
      expect(packages.status).toBe('warn')
      expect(packages.detail).toContain('no @kysera/* packages found')
    })
  })

  describe('summarize', () => {
    it('counts statuses and reports the worst as overall', () => {
      const checks: DoctorCheck[] = [
        { id: 'a.b', status: 'pass', detail: '' },
        { id: 'c.d', status: 'warn', detail: '' },
        { id: 'e.f', status: 'fail', detail: '' }
      ]
      expect(summarize(checks)).toEqual({ pass: 1, warn: 1, fail: 1, status: 'fail' })
      expect(summarize(checks.slice(0, 2)).status).toBe('warn')
      expect(summarize(checks.slice(0, 1)).status).toBe('pass')
      expect(summarize([]).status).toBe('pass')
    })
  })
})
