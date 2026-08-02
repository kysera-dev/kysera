import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { Command } from 'commander'

// Mock external dependencies before importing the module under test
vi.mock('node:fs', () => ({
  existsSync: vi.fn()
}))

vi.mock('../../../../src/utils/database.js', () => ({
  getDatabaseConnection: vi.fn()
}))

vi.mock('../../../../src/config/loader.js', () => ({
  loadConfig: vi.fn()
}))

vi.mock('../../../../src/commands/migrate/runner.js', () => ({
  MigrationRunner: vi.fn()
}))

import { existsSync } from 'node:fs'
import { upCommand, parsePositiveInt } from '../../../../src/commands/migrate/up.js'
import { getDatabaseConnection } from '../../../../src/utils/database.js'
import { loadConfig } from '../../../../src/config/loader.js'
import { MigrationRunner } from '../../../../src/commands/migrate/runner.js'
import { CLIError } from '../../../../src/utils/errors.js'
import { resetOutput } from '../../../../src/utils/output.js'

interface RunnerMock {
  planUp: Mock
  up: Mock
}

function installRunnerMock(overrides: Partial<RunnerMock> = {}): RunnerMock {
  const instance: RunnerMock = {
    planUp: vi.fn().mockResolvedValue([]),
    up: vi
      .fn()
      .mockResolvedValue({ executed: [], skipped: [], failed: [], duration: 0, dryRun: false }),
    ...overrides
  }
  ;(MigrationRunner as unknown as Mock).mockImplementation(function (this: object) {
    Object.assign(this, instance)
    return this
  })
  return instance
}

const pendingFile = (name: string) => ({ name, path: `/migrations/${name}.ts`, timestamp: '' })

describe('migrate up command', () => {
  let command: Command
  let mockDb: { destroy: Mock }

  beforeEach(() => {
    vi.clearAllMocks()
    resetOutput()
    process.env['NODE_ENV'] = 'test'

    mockDb = { destroy: vi.fn().mockResolvedValue(undefined) }

    ;(existsSync as Mock).mockReturnValue(true)
    ;(getDatabaseConnection as Mock).mockResolvedValue(mockDb)
    ;(loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', connection: 'postgres://localhost/test' },
      migrations: { directory: './migrations', tableName: 'kysera_migrations' }
    })
    installRunnerMock()

    command = upCommand()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('up')
    })

    it('should have a description', () => {
      expect(command.description()).toContain('Run pending migrations')
    })

    it.each(['--to', '--steps', '--count', '--dry-run', '--verbose', '--config', '--json', '--schema'])(
      'should have %s option',
      flag => {
        expect(command.options.find(o => o.long === flag)).toBeDefined()
      }
    )
  })

  describe('argument parsing', () => {
    it('parsePositiveInt accepts positive integers', () => {
      expect(parsePositiveInt('3')).toBe(3)
    })

    it.each(['0', '-2', 'abc', '1.5'])('parsePositiveInt rejects %s', value => {
      expect(() => parsePositiveInt(value)).toThrow()
    })
  })

  describe('success scenarios', () => {
    it('should run migrations when pending exist', async () => {
      const runner = installRunnerMock({
        planUp: vi.fn().mockResolvedValue([pendingFile('m1')]),
        up: vi
          .fn()
          .mockResolvedValue({ executed: ['m1'], skipped: [], failed: [], duration: 10, dryRun: false })
      })

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow()
      expect(runner.up).toHaveBeenCalledWith(expect.objectContaining({ to: undefined, steps: undefined }))
    })

    it('should pass --steps through to the runner', async () => {
      const runner = installRunnerMock({
        planUp: vi.fn().mockResolvedValue([pendingFile('m1')])
      })

      await command.parseAsync(['node', 'test', '--steps', '1'])
      expect(runner.up).toHaveBeenCalledWith(expect.objectContaining({ steps: 1 }))
    })

    it('should use --count as alias for --steps', async () => {
      const runner = installRunnerMock({
        planUp: vi.fn().mockResolvedValue([pendingFile('m1')])
      })

      await command.parseAsync(['node', 'test', '--count', '2'])
      expect(runner.up).toHaveBeenCalledWith(expect.objectContaining({ steps: 2 }))
    })

    it('should pass --to through to the runner', async () => {
      const runner = installRunnerMock({
        planUp: vi.fn().mockResolvedValue([pendingFile('target_migration')])
      })

      await command.parseAsync(['node', 'test', '--to', 'target_migration'])
      expect(runner.up).toHaveBeenCalledWith(expect.objectContaining({ to: 'target_migration' }))
    })

    it('should not run when nothing is pending', async () => {
      const runner = installRunnerMock()

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow()
      expect(runner.up).not.toHaveBeenCalled()
    })
  })

  describe('dry run', () => {
    it('should never invoke the runner in dry-run mode', async () => {
      const runner = installRunnerMock({
        planUp: vi.fn().mockResolvedValue([pendingFile('m1'), pendingFile('m2')])
      })

      await command.parseAsync(['node', 'test', '--dry-run'])
      expect(runner.planUp).toHaveBeenCalled()
      expect(runner.up).not.toHaveBeenCalled()
    })

    it('should emit a machine-readable plan with --dry-run --json', async () => {
      installRunnerMock({
        planUp: vi.fn().mockResolvedValue([pendingFile('m1')])
      })
      const writes: string[] = []
      vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
        writes.push(String(chunk))
        return true
      }) as never)

      await command.parseAsync(['node', 'test', '--dry-run', '--json'])

      const payload = JSON.parse(writes.join(''))
      expect(payload.dryRun).toBe(true)
      expect(payload.count).toBe(1)
      expect(payload.plan).toEqual([{ name: 'm1', path: '/migrations/m1.ts' }])
      expect(payload.table).toBe('kysera_migrations')
      expect(payload.dialect).toBe('postgres')
    })
  })

  describe('error handling', () => {
    it('should throw when database config is not found', async () => {
      ;(loadConfig as Mock).mockResolvedValue({})

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(CLIError)
    })

    it('should throw when database connection fails', async () => {
      ;(getDatabaseConnection as Mock).mockResolvedValue(null)

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(CLIError)
    })

    it('should throw when migrations directory does not exist', async () => {
      ;(existsSync as Mock).mockReturnValue(false)

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(CLIError)
    })

    it('should propagate runner failures as CLIError', async () => {
      installRunnerMock({
        planUp: vi.fn().mockResolvedValue([pendingFile('m1')]),
        up: vi
          .fn()
          .mockRejectedValue(new CLIError('Migration m1 failed: boom', 'MIGRATION_FAILED'))
      })

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow('Migration m1 failed')
    })
  })

  describe('cleanup', () => {
    it('should close the database connection after execution', async () => {
      await command.parseAsync(['node', 'test'])
      expect(mockDb.destroy).toHaveBeenCalled()
    })

    it('should close the database connection when the run fails', async () => {
      installRunnerMock({
        planUp: vi.fn().mockRejectedValue(new CLIError('nope', 'DATABASE_ERROR'))
      })

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow()
      expect(mockDb.destroy).toHaveBeenCalled()
    })
  })
})
