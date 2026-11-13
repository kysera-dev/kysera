import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Command } from 'commander'
import Sqlite from 'better-sqlite3'
import { confirm, CANCEL_SYMBOL } from '@xec-sh/kit'
import { softDeletedCommand } from '@/commands/query/soft-deleted.js'
import { restoreCommand } from '@/commands/audit/restore.js'
import { circuitBreakerCommand } from '@/commands/debug/circuit-breaker.js'
import { initCommand as auditInitCommand } from '@/commands/audit/init.js'
import { generateCommand as rlsGenerateCommand } from '@/commands/rls/generate.js'
import { migrationCommand as rlsMigrationCommand } from '@/commands/rls/migration.js'
import { addGlobalOptions, resetGlobalOptions } from '@/utils/global-options.js'
import { resetOutput } from '@/utils/output.js'

vi.mock('@xec-sh/kit', async importOriginal => {
  const actual = await importOriginal<typeof import('@xec-sh/kit')>()
  return { ...actual, confirm: vi.fn() }
})

const originalCwd = process.cwd()
const originalTTY = [process.stdin.isTTY, process.stdout.isTTY]
let directory: string
let selectedFile: string
let configFile: string
let stdout: string
function setTTY(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
}
function readRows(file: string, sql: string): unknown[] {
  const db = new Sqlite(file)
  try {
    return db.prepare(sql).all()
  } finally {
    db.close()
  }
}
async function invoke(command: Command, args: string[]): Promise<Command> {
  const root = addGlobalOptions(new Command())
  root.addCommand(command)
  return root.exitOverride().parseAsync([command.name(), ...args], { from: 'user' })
}
beforeEach(async () => {
  vi.clearAllMocks()
  resetOutput()
  resetGlobalOptions()
  directory = await mkdtemp(join(tmpdir(), 'kysera-confirm-sql-'))
  process.chdir(directory)
  selectedFile = join(directory, 'selected.db')
  configFile = join(directory, 'selected.config.json')
  await writeFile(
    configFile,
    JSON.stringify({ database: { dialect: 'sqlite', database: selectedFile } })
  )
  await writeFile(
    join(directory, 'kysera.config.json'),
    JSON.stringify({ database: { dialect: 'sqlite', database: join(directory, 'default.db') } })
  )
  for (const file of [selectedFile, join(directory, 'default.db')]) {
    const db = new Sqlite(file)
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT);
      INSERT INTO users VALUES (1, 'keep', NULL), (2, 'deleted', '2026-01-01');
      CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, table_name TEXT, entity_id TEXT, operation TEXT,
        old_values TEXT, new_values TEXT, changed_by TEXT, changed_at TEXT, metadata TEXT);
      INSERT INTO audit_logs VALUES (1, 'users', '1', 'INSERT', NULL, '{"id":1}', 'test', '2026-01-01', NULL);
      CREATE TABLE circuit_breaker_state (service TEXT PRIMARY KEY, state TEXT, failure_count INTEGER,
        success_count INTEGER, last_failure TEXT, last_success TEXT, next_retry TEXT, error_threshold INTEGER,
        reset_timeout INTEGER, half_open_requests INTEGER, updated_at TEXT);
      INSERT INTO circuit_breaker_state VALUES ('api', 'open', 5, 0, '2026-01-01', NULL, NULL, 3, 1000, 0, 'before');
      INSERT INTO circuit_breaker_state VALUES ('cache', 'open', 8, 0, '2026-01-01', NULL, NULL, 3, 1000, 0, 'before');
    `)
    db.close()
  }
  setTTY(true)
  stdout = ''
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    stdout += String(chunk)
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  vi.spyOn(console, 'log').mockImplementation((...values) => {
    stdout += values.join(' ') + '\n'
  })
})
afterEach(async () => {
  process.chdir(originalCwd)
  Object.defineProperty(process.stdin, 'isTTY', { value: originalTTY[0], configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: originalTTY[1], configurable: true })
  resetOutput()
  resetGlobalOptions()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

const operations: Array<[string, () => Command, string[]]> = [
  ['purge', softDeletedCommand, ['--table', 'users', '--purge']],
  ['audit restore', restoreCommand, ['1']],
  ['breaker reset', circuitBreakerCommand, ['--action', 'reset', '--service', 'api']]
]
describe.each(operations)('%s with a real private database', (_name, factory, args) => {
  it.each([false, CANCEL_SYMBOL])(
    'preserves users, audit history and breaker states after %s',
    async answer => {
      vi.mocked(confirm).mockResolvedValue(answer)
      const before = await readFile(selectedFile)
      await invoke(factory(), [...args, '--config', configFile])
      expect(confirm).toHaveBeenCalledOnce()
      expect(await readFile(selectedFile)).toEqual(before)
    }
  )
  it.each(['json', 'pipe'])('refuses %s without touching the database', async mode => {
    if (mode === 'pipe') setTTY(false)
    const before = await readFile(selectedFile)
    await expect(
      invoke(factory(), [...args, '--config', configFile, ...(mode === 'json' ? ['--json'] : [])])
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    expect(confirm).not.toHaveBeenCalled()
    expect(await readFile(selectedFile)).toEqual(before)
    expect(stdout).toBe('')
  })
})
it('explicit JSON purge removes only deleted records and retains audit history', async () => {
  await invoke(softDeletedCommand(), [
    '--table',
    'users',
    '--purge',
    '--force',
    '--json',
    '--config',
    configFile
  ])
  expect(JSON.parse(stdout)).toEqual({ table: 'users', purged: 1 })
  expect(readRows(selectedFile, 'SELECT id FROM users')).toEqual([{ id: 1 }])
  expect(readRows(selectedFile, 'SELECT id FROM audit_logs')).toEqual([{ id: 1 }])
})
it('explicit JSON restore emits only its result and records the new audit event', async () => {
  await invoke(restoreCommand(), ['1', '--force', '--json', '--config', configFile])
  expect(JSON.parse(stdout)).toMatchObject({
    success: true,
    auditLogId: '1',
    restoreAction: 'DELETE'
  })
  expect(readRows(selectedFile, 'SELECT id FROM users')).toEqual([{ id: 2 }])
  expect(readRows(selectedFile, 'SELECT operation FROM audit_logs ORDER BY id')).toEqual([
    { operation: 'INSERT' },
    { operation: 'DELETE' }
  ])
})
it('breaker reset writes only the requested service in the explicitly selected database', async () => {
  const fallbackBefore = await readFile(join(directory, 'default.db'))
  await invoke(circuitBreakerCommand(), [
    '--action',
    'reset',
    '--service',
    'api',
    '--force',
    '--json',
    '--config',
    configFile
  ])
  expect(JSON.parse(stdout)).toEqual({ action: 'reset', services: ['api'] })
  expect(await readFile(join(directory, 'default.db'))).toEqual(fallbackBefore)
  expect(
    readRows(
      selectedFile,
      'SELECT service,state,failure_count FROM circuit_breaker_state ORDER BY service'
    )
  ).toEqual([
    { service: 'api', state: 'closed', failure_count: 0 },
    { service: 'cache', state: 'open', failure_count: 8 }
  ])
})
it('failed breaker persistence rejects without claiming success and preserves state', async () => {
  const db = new Sqlite(selectedFile)
  db.exec(
    "CREATE TRIGGER deny_reset BEFORE UPDATE ON circuit_breaker_state BEGIN SELECT RAISE(ABORT, 'denied'); END;"
  )
  db.close()
  await expect(
    invoke(circuitBreakerCommand(), [
      '--action',
      'reset',
      '--service',
      'api',
      '--force',
      '--json',
      '--config',
      configFile
    ])
  ).rejects.toThrow('denied')
  expect(stdout).toBe('')
  expect(
    readRows(selectedFile, "SELECT state FROM circuit_breaker_state WHERE service='api'")
  ).toEqual([{ state: 'open' }])
})
it('missing breaker table reports an empty observation rather than synthetic healthy services', async () => {
  const db = new Sqlite(selectedFile)
  db.exec('DROP TABLE circuit_breaker_state')
  db.close()
  await invoke(circuitBreakerCommand(), ['--json', '--config', configFile])
  expect(JSON.parse(stdout)).toEqual([])
})
it.each(['audit', 'rls-sql', 'rls-migration'])(
  'declared %s dry-run produces a preview without new files',
  async kind => {
    const postgresConfig = join(directory, 'postgres.config.json')
    await writeFile(
      postgresConfig,
      JSON.stringify({ database: { dialect: 'postgres', database: 'not-connected' } })
    )
    const schema = join(directory, 'rls-schema.js')
    await writeFile(
      schema,
      'export default { users: { policies: [{ type: "allow", operation: "read", condition: () => true, using: "true", role: "app_user" }] } }'
    )
    const before = await readdir(directory)
    if (kind === 'audit')
      await invoke(auditInitCommand(), ['--config', configFile, '--dry-run', '--json'])
    else if (kind === 'rls-sql')
      await invoke(rlsGenerateCommand(), [
        schema,
        '--config',
        postgresConfig,
        '--output',
        join(directory, 'policies.sql'),
        '--dry-run',
        '--json'
      ])
    else
      await invoke(rlsMigrationCommand(), [
        schema,
        '--config',
        postgresConfig,
        '--dry-run',
        '--json'
      ])
    expect(JSON.parse(stdout)).toMatchObject({ dryRun: true })
    expect(await readdir(directory)).toEqual(before)
  }
)
