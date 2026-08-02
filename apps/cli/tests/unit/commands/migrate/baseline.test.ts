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

import { baselineCommand } from '../../../../src/commands/migrate/baseline.js'
import { getDatabaseConnection } from '../../../../src/utils/database.js'
import { loadConfig } from '../../../../src/config/loader.js'
import { MigrationRunner } from '../../../../src/commands/migrate/runner.js'
import { CLIError } from '../../../../src/utils/errors.js'
import { resetOutput } from '../../../../src/utils/output.js'

interface RunnerMock {
  planUp: Mock
  baseline: Mock
}

function installRunnerMock(overrides: Partial<RunnerMock> = {}): RunnerMock {
  const instance: RunnerMock = {
    planUp: vi.fn().mockResolvedValue([]),
    baseline: vi.fn().mockResolvedValue({ marked: [], skipped: [] }),
    ...overrides
  }
  ;(MigrationRunner as unknown as Mock).mockImplementation(function (this: object) {
    Object.assign(this, instance)
    return this
  })
  return instance
}

describe('migrate baseline command', () => {
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

    command = baselineCommand()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('baseline')
    })

    it.each(['--all', '--json', '--verbose', '--config', '--schema'])(
      'should have %s option',
      flag => {
        expect(command.options.find(o => o.long === flag)).toBeDefined()
      }
    )
  })

  it('should require names or --all', async () => {
    await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(CLIError)
    expect(MigrationRunner).not.toHaveBeenCalled()
  })

  it('should baseline the given names', async () => {
    const runner = installRunnerMock({
      baseline: vi.fn().mockResolvedValue({ marked: ['m1'], skipped: [] })
    })

    await command.parseAsync(['node', 'test', 'm1'])
    expect(runner.baseline).toHaveBeenCalledWith(['m1'])
  })

  it('should baseline every pending migration with --all', async () => {
    const runner = installRunnerMock({
      planUp: vi
        .fn()
        .mockResolvedValue([
          { name: 'm1', path: '/m/m1.ts', timestamp: '' },
          { name: 'm2', path: '/m/m2.ts', timestamp: '' }
        ]),
      baseline: vi.fn().mockResolvedValue({ marked: ['m1', 'm2'], skipped: [] })
    })

    await command.parseAsync(['node', 'test', '--all'])
    expect(runner.baseline).toHaveBeenCalledWith(['m1', 'm2'])
  })

  it('should emit JSON with --json', async () => {
    installRunnerMock({
      baseline: vi.fn().mockResolvedValue({ marked: ['m1'], skipped: ['m0'] })
    })
    const writes: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
      writes.push(String(chunk))
      return true
    }) as never)

    await command.parseAsync(['node', 'test', 'm1', 'm0', '--json'])

    const payload = JSON.parse(writes.join(''))
    expect(payload.marked).toEqual(['m1'])
    expect(payload.skipped).toEqual(['m0'])
    expect(payload.count).toBe(1)
    expect(payload.table).toBe('migrations')
    expect(payload.dialect).toBe('sqlite')
  })

  it('should propagate unknown-migration errors', async () => {
    installRunnerMock({
      baseline: vi.fn().mockRejectedValue(new CLIError('Migration nope not found', 'MIGRATION_NOT_FOUND'))
    })

    await expect(command.parseAsync(['node', 'test', 'nope'])).rejects.toThrow('not found')
  })

  it('should close the database connection after execution', async () => {
    await command.parseAsync(['node', 'test', 'm1'])
    expect(mockDb.destroy).toHaveBeenCalled()
  })
})
