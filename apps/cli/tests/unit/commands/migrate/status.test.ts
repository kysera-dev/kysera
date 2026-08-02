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

import { statusCommand } from '../../../../src/commands/migrate/status.js'
import { getDatabaseConnection } from '../../../../src/utils/database.js'
import { loadConfig } from '../../../../src/config/loader.js'
import { MigrationRunner } from '../../../../src/commands/migrate/runner.js'
import { CLIError } from '../../../../src/utils/errors.js'
import { resetOutput } from '../../../../src/utils/output.js'
import type { MigrationStatusEntry } from '../../../../src/commands/migrate/runner.js'

function installRunnerMock(entries: MigrationStatusEntry[] = []): { getStatusEntries: Mock } {
  const instance = {
    getStatusEntries: vi.fn().mockResolvedValue(entries)
  }
  ;(MigrationRunner as unknown as Mock).mockImplementation(function (this: object) {
    Object.assign(this, instance)
    return this
  })
  return instance
}

const executedEntry: MigrationStatusEntry = {
  name: '20240101000000_init',
  timestamp: '20240101000000',
  status: 'executed',
  executedAt: new Date('2024-01-02T03:04:05Z'),
  checksum: 'abc',
  currentChecksum: 'abc',
  path: '/migrations/20240101000000_init.ts'
}

const pendingEntry: MigrationStatusEntry = {
  name: '20240202000000_more',
  timestamp: '20240202000000',
  status: 'pending',
  executedAt: null,
  checksum: null,
  currentChecksum: 'def',
  path: '/migrations/20240202000000_more.ts'
}

function captureStdout(): string[] {
  const writes: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
    writes.push(String(chunk))
    return true
  }) as never)
  return writes
}

describe('migrate status command', () => {
  let command: Command
  let mockDb: { destroy: Mock }

  beforeEach(() => {
    vi.clearAllMocks()
    resetOutput()
    process.env['NODE_ENV'] = 'test'

    mockDb = { destroy: vi.fn().mockResolvedValue(undefined) }

    ;(getDatabaseConnection as Mock).mockResolvedValue(mockDb)
    ;(loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', connection: 'postgres://user:secret@localhost/test' },
      migrations: { directory: './migrations', tableName: 'migrations' }
    })
    installRunnerMock()

    command = statusCommand()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('status')
    })

    it('should have a description', () => {
      expect(command.description()).toContain('Show migration status')
    })

    it.each(['--json', '--verbose', '--config', '--schema'])('should have %s option', flag => {
      expect(command.options.find(o => o.long === flag)).toBeDefined()
    })
  })

  describe('text output', () => {
    it('should render executed and pending sections', async () => {
      installRunnerMock([executedEntry, pendingEntry])
      const writes = captureStdout()

      await command.parseAsync(['node', 'test'])

      const text = writes.join('')
      expect(text).toContain('Migration Status')
      expect(text).toContain('20240101000000_init')
      expect(text).toContain('(executed)')
      expect(text).toContain('20240202000000_more')
      expect(text).toContain('(pending)')
    })
  })

  describe('json output', () => {
    it('should emit the stable CI shape', async () => {
      installRunnerMock([executedEntry, pendingEntry])
      const writes = captureStdout()

      await command.parseAsync(['node', 'test', '--json'])

      const payload = JSON.parse(writes.join(''))
      expect(payload.total).toBe(2)
      expect(payload.table).toBe('migrations')
      expect(payload.dialect).toBe('postgres')
      expect(payload.executed).toEqual([
        {
          name: '20240101000000_init',
          executedAt: '2024-01-02T03:04:05.000Z',
          checksum: 'abc'
        }
      ])
      expect(payload.pending).toEqual([
        { name: '20240202000000_more', path: '/migrations/20240202000000_more.ts' }
      ])
      expect(payload.database).toBeUndefined()
    })

    it('should redact credentials in verbose connection info', async () => {
      installRunnerMock([])
      const writes = captureStdout()

      await command.parseAsync(['node', 'test', '--json', '--verbose'])

      const text = writes.join('')
      expect(text).not.toContain('secret')
      const payload = JSON.parse(text)
      expect(payload.database.connection).toContain('***')
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

    it('should wrap runner failures in CLIError', async () => {
      ;(MigrationRunner as unknown as Mock).mockImplementation(function (this: object) {
        Object.assign(this, {
          getStatusEntries: vi.fn().mockRejectedValue(new Error('query failed'))
        })
        return this
      })

      await expect(command.parseAsync(['node', 'test'])).rejects.toThrow(
        'Failed to get migration status'
      )
    })
  })

  describe('cleanup', () => {
    it('should close the database connection after execution', async () => {
      await command.parseAsync(['node', 'test'])
      expect(mockDb.destroy).toHaveBeenCalled()
    })

    it('should honor a custom config path', async () => {
      await command.parseAsync(['node', 'test', '--config', './custom-config.ts'])
      expect(loadConfig).toHaveBeenCalledWith('./custom-config.ts')
    })
  })
})
