import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { Command } from 'commander'

vi.mock('../../../../src/utils/database.js', () => ({
  getDatabaseConnection: vi.fn()
}))

vi.mock('../../../../src/config/loader.js', () => ({
  loadConfig: vi.fn()
}))

vi.mock('../../../../src/commands/migrate/runner.js', () => ({
  MigrationRunner: vi.fn()
}))

import { verifyCommand } from '../../../../src/commands/migrate/verify.js'
import { getDatabaseConnection } from '../../../../src/utils/database.js'
import { loadConfig } from '../../../../src/config/loader.js'
import { MigrationRunner } from '../../../../src/commands/migrate/runner.js'
import { CLIError } from '../../../../src/utils/errors.js'
import { resetOutput } from '../../../../src/utils/output.js'
import type { VerifyReport } from '../../../../src/commands/migrate/runner.js'

interface RunnerMock {
  verify: Mock
  adoptChecksums: Mock
}

const cleanReport: VerifyReport = { ok: true, checked: 2, pending: 1, issues: [] }

function installRunnerMock(overrides: Partial<RunnerMock> = {}): RunnerMock {
  const instance: RunnerMock = {
    verify: vi.fn().mockResolvedValue(cleanReport),
    adoptChecksums: vi.fn().mockResolvedValue([]),
    ...overrides
  }
  ;(MigrationRunner as unknown as Mock).mockImplementation(function (this: object) {
    Object.assign(this, instance)
    return this
  })
  return instance
}

function captureStdout(): string[] {
  const writes: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
    writes.push(String(chunk))
    return true
  }) as never)
  return writes
}

describe('migrate verify command', () => {
  let command: Command
  let mockDb: { destroy: Mock }

  beforeEach(() => {
    vi.clearAllMocks()
    resetOutput()
    process.env['NODE_ENV'] = 'test'

    mockDb = { destroy: vi.fn().mockResolvedValue(undefined) }

    ;(getDatabaseConnection as Mock).mockResolvedValue(mockDb)
    ;(loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'sqlite', database: './test.db' },
      migrations: { directory: './migrations', tableName: 'migrations' }
    })
    installRunnerMock()

    command = verifyCommand()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('verify')
    })

    it.each(['--update', '--json', '--verbose', '--config', '--schema'])(
      'should have %s option',
      flag => {
        expect(command.options.find(o => o.long === flag)).toBeDefined()
      }
    )
  })

  it('should pass when there is no drift', async () => {
    const runner = installRunnerMock()

    await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow()
    expect(runner.verify).toHaveBeenCalled()
    expect(runner.adoptChecksums).not.toHaveBeenCalled()
  })

  it('should emit the report as JSON', async () => {
    installRunnerMock()
    const writes = captureStdout()

    await command.parseAsync(['node', 'test', '--json'])

    const payload = JSON.parse(writes.join(''))
    expect(payload.ok).toBe(true)
    expect(payload.checked).toBe(2)
    expect(payload.pending).toBe(1)
    expect(payload.issues).toEqual([])
    expect(payload.table).toBe('migrations')
    expect(payload.dialect).toBe('sqlite')
  })

  it('should fail with MIGRATION_DRIFT when a migration was modified', async () => {
    installRunnerMock({
      verify: vi.fn().mockResolvedValue({
        ok: false,
        checked: 1,
        pending: 0,
        issues: [{ name: 'm1', kind: 'modified', expected: 'aaa', actual: 'bbb', path: '/m/m1.ts' }]
      } satisfies VerifyReport)
    })
    captureStdout()

    await expect(command.parseAsync(['node', 'test'])).rejects.toThrow('Migration drift detected')
  })

  it('should not fail for unknown checksums alone', async () => {
    installRunnerMock({
      verify: vi.fn().mockResolvedValue({
        ok: true,
        checked: 1,
        pending: 0,
        issues: [{ name: 'm1', kind: 'unknown_checksum', path: '/m/m1.ts' }]
      } satisfies VerifyReport)
    })
    captureStdout()

    await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow()
  })

  it('should adopt missing checksums with --update', async () => {
    const runner = installRunnerMock({
      adoptChecksums: vi.fn().mockResolvedValue(['m1'])
    })
    captureStdout()

    await command.parseAsync(['node', 'test', '--update'])
    expect(runner.adoptChecksums).toHaveBeenCalled()
  })

  it('should wrap unexpected failures in CLIError', async () => {
    installRunnerMock({
      verify: vi.fn().mockRejectedValue(new Error('io error'))
    })

    await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(CLIError)
  })

  it('should close the database connection after execution', async () => {
    await command.parseAsync(['node', 'test'])
    expect(mockDb.destroy).toHaveBeenCalled()
  })
})
