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

import { downCommand } from '../../../../src/commands/migrate/down.js'
import { getDatabaseConnection } from '../../../../src/utils/database.js'
import { loadConfig } from '../../../../src/config/loader.js'
import { MigrationRunner } from '../../../../src/commands/migrate/runner.js'
import { CLIError } from '../../../../src/utils/errors.js'
import { resetOutput } from '../../../../src/utils/output.js'

interface RunnerMock {
  planDown: Mock
  down: Mock
}

function installRunnerMock(overrides: Partial<RunnerMock> = {}): RunnerMock {
  const instance: RunnerMock = {
    planDown: vi.fn().mockResolvedValue([]),
    down: vi
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

const target = (name: string) => ({ name, path: `/migrations/${name}.ts` })

describe('migrate down command', () => {
  let command: Command
  let mockDb: { destroy: Mock }

  beforeEach(() => {
    vi.clearAllMocks()
    resetOutput()
    process.env['NODE_ENV'] = 'test'

    mockDb = { destroy: vi.fn().mockResolvedValue(undefined) }

    ;(getDatabaseConnection as Mock).mockResolvedValue(mockDb)
    ;(loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', connection: 'postgres://localhost/test' },
      migrations: { directory: './migrations', tableName: 'migrations' }
    })
    installRunnerMock()

    command = downCommand()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('down')
    })

    it('should have a description', () => {
      expect(command.description()).toContain('Rollback migrations')
    })

    it.each([
      '--steps',
      '--count',
      '--to',
      '--all',
      '--dry-run',
      '--force',
      '--verbose',
      '--config',
      '--json',
      '--schema'
    ])('should have %s option', flag => {
      expect(command.options.find(o => o.long === flag)).toBeDefined()
    })
  })

  describe('success scenarios', () => {
    it('should rollback the last migration by default', async () => {
      const runner = installRunnerMock({
        planDown: vi.fn().mockResolvedValue([target('m2')]),
        down: vi.fn().mockResolvedValue({
          executed: ['m2'],
          skipped: [],
          failed: [],
          duration: 5,
          dryRun: false
        })
      })

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow()
      expect(runner.down).toHaveBeenCalledWith(
        expect.objectContaining({ to: undefined, steps: undefined, all: undefined })
      )
    })

    it('should pass --steps through to the runner', async () => {
      const runner = installRunnerMock({
        planDown: vi.fn().mockResolvedValue([target('m2')])
      })

      await command.parseAsync(['node', 'test', '--steps', '1'])
      expect(runner.down).toHaveBeenCalledWith(expect.objectContaining({ steps: 1 }))
    })

    it('should use --count as alias for --steps', async () => {
      const runner = installRunnerMock({
        planDown: vi.fn().mockResolvedValue([target('m1'), target('m2')])
      })

      await command.parseAsync(['node', 'test', '--count', '2'])
      expect(runner.down).toHaveBeenCalledWith(expect.objectContaining({ steps: 2 }))
    })

    it('should pass --to through to the runner', async () => {
      const runner = installRunnerMock({
        planDown: vi.fn().mockResolvedValue([target('m2')])
      })

      await command.parseAsync(['node', 'test', '--to', 'm1'])
      expect(runner.down).toHaveBeenCalledWith(expect.objectContaining({ to: 'm1' }))
    })

    it('should handle nothing to rollback without invoking down', async () => {
      const runner = installRunnerMock()

      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow()
      expect(runner.down).not.toHaveBeenCalled()
    })
  })

  describe('destructive guard', () => {
    it('should refuse --all without --force in non-interactive mode', async () => {
      const runner = installRunnerMock()

      await expect(command.parseAsync(['node', 'test', '--all'])).rejects.toThrow(
        /confirmation|force/i
      )
      expect(runner.down).not.toHaveBeenCalled()
      expect(MigrationRunner).not.toHaveBeenCalled()
    })

    it('should run --all with --force', async () => {
      const runner = installRunnerMock({
        planDown: vi.fn().mockResolvedValue([target('m1'), target('m2')]),
        down: vi.fn().mockResolvedValue({
          executed: ['m2', 'm1'],
          skipped: [],
          failed: [],
          duration: 8,
          dryRun: false
        })
      })

      await expect(command.parseAsync(['node', 'test', '--all', '--force'])).resolves.not.toThrow()
      expect(runner.down).toHaveBeenCalledWith(expect.objectContaining({ all: true }))
    })

    it('should allow --all --dry-run without confirmation', async () => {
      const runner = installRunnerMock({
        planDown: vi.fn().mockResolvedValue([target('m1')])
      })

      await expect(
        command.parseAsync(['node', 'test', '--all', '--dry-run'])
      ).resolves.not.toThrow()
      expect(runner.down).not.toHaveBeenCalled()
    })
  })

  describe('dry run', () => {
    it('should emit a machine-readable plan with --dry-run --json', async () => {
      installRunnerMock({
        planDown: vi.fn().mockResolvedValue([target('m2'), target('m1')])
      })
      const writes: string[] = []
      vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
        writes.push(String(chunk))
        return true
      }) as never)

      await command.parseAsync(['node', 'test', '--steps', '2', '--dry-run', '--json'])

      const payload = JSON.parse(writes.join(''))
      expect(payload.dryRun).toBe(true)
      expect(payload.count).toBe(2)
      expect(payload.plan).toEqual([
        { name: 'm2', path: '/migrations/m2.ts' },
        { name: 'm1', path: '/migrations/m1.ts' }
      ])
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

    it('should propagate rollback failures', async () => {
      installRunnerMock({
        planDown: vi.fn().mockResolvedValue([target('m1')]),
        down: vi
          .fn()
          .mockRejectedValue(new CLIError('Rollback of m1 failed: boom', 'ROLLBACK_FAILED'))
      })

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow('Rollback of m1 failed')
    })
  })

  describe('cleanup', () => {
    it('should close the database connection after execution', async () => {
      await command.parseAsync(['node', 'test'])
      expect(mockDb.destroy).toHaveBeenCalled()
    })
  })
})
