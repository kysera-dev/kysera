/**
 * Global options tests.
 *
 * The old GlobalOptionsManager singleton (env-var writes, console.log
 * monkey-patching for quiet mode, KYSERA_CONFIG writes) was removed.
 * These tests cover the replacement contract: one preAction hook that
 * configures output state and pushes root-level flags down into the
 * invoked subcommand so trailing and leading global flags behave the
 * same.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import {
  addGlobalOptions,
  applyGlobalOptions,
  isDryRun,
  resetGlobalOptions,
  verbose,
  debug
} from '@/utils/global-options.js'
import {
  configureOutput,
  isJsonMode,
  isQuietMode,
  isVerboseMode,
  resetOutput
} from '@/utils/output.js'
import { logger } from '@/utils/logger.js'

function buildProgram(subOptions: Array<[string, string]> = []): {
  program: Command
  getActionOpts: () => Record<string, unknown>
} {
  const program = new Command()
  program.exitOverride()
  addGlobalOptions(program)

  let actionOpts: Record<string, unknown> = {}
  const sub = new Command('sub')
  for (const [flags, description] of subOptions) {
    sub.option(flags, description)
  }
  sub.action(function (this: Command) {
    actionOpts = this.opts()
  })
  program.addCommand(sub)

  return { program, getActionOpts: () => actionOpts }
}

describe('global options', () => {
  beforeEach(() => {
    resetOutput()
    resetGlobalOptions()
    logger.setLevel('info')
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetOutput()
    resetGlobalOptions()
    logger.setLevel('info')
  })

  describe('flag definitions', () => {
    it('defines the global flags on the command', () => {
      const program = new Command()
      addGlobalOptions(program)
      const flags = program.options.map(o => o.long)
      expect(flags).toContain('--verbose')
      expect(flags).toContain('--quiet')
      expect(flags).toContain('--dry-run')
      expect(flags).toContain('--config')
      expect(flags).toContain('--no-color')
      expect(flags).toContain('--json')
    })
  })

  describe('root flag propagation', () => {
    it('pushes root --json down into the invoked subcommand', async () => {
      const { program, getActionOpts } = buildProgram([['--json', 'json output']])
      await program.parseAsync(['node', 'test', '--json', 'sub'])
      expect(getActionOpts()['json']).toBe(true)
      expect(isJsonMode()).toBe(true)
    })

    it('honors --json as a trailing flag on the subcommand', async () => {
      const { program, getActionOpts } = buildProgram([['--json', 'json output']])
      await program.parseAsync(['node', 'test', 'sub', '--json'])
      expect(getActionOpts()['json']).toBe(true)
      expect(isJsonMode()).toBe(true)
    })

    it('pushes root --config down into the invoked subcommand', async () => {
      const { program, getActionOpts } = buildProgram([['-c, --config <path>', 'config path']])
      await program.parseAsync(['node', 'test', '--config', './my.config.ts', 'sub'])
      expect(getActionOpts()['config']).toBe('./my.config.ts')
    })

    it('lets a subcommand flag override the root value', async () => {
      const { program, getActionOpts } = buildProgram([['-c, --config <path>', 'config path']])
      await program.parseAsync([
        'node',
        'test',
        '--config',
        './root.ts',
        'sub',
        '--config',
        './leaf.ts'
      ])
      expect(getActionOpts()['config']).toBe('./leaf.ts')
    })

    it('propagates verbose and quiet flags', async () => {
      const { program } = buildProgram()
      await program.parseAsync(['node', 'test', '--verbose', 'sub'])
      expect(isVerboseMode()).toBe(true)
      expect(logger.level).toBe('debug')
    })
  })

  describe('quiet mode', () => {
    it('sets the logger to error level without touching console', async () => {
      const originalLog = console.log
      const { program } = buildProgram()
      await program.parseAsync(['node', 'test', '--quiet', 'sub'])
      expect(isQuietMode()).toBe(true)
      expect(logger.level).toBe('error')
      // Quiet mode must never monkey-patch console
      expect(console.log).toBe(originalLog)
    })
  })

  describe('dry-run mode', () => {
    it('tracks dry-run state for the invocation', async () => {
      const { program } = buildProgram()
      expect(isDryRun()).toBe(false)
      await program.parseAsync(['node', 'test', '--dry-run', 'sub'])
      expect(isDryRun()).toBe(true)
    })
  })

  describe('applyGlobalOptions', () => {
    it('configures output from merged root and leaf options', () => {
      const root = new Command()
      addGlobalOptions(root)
      root.setOptionValue('json', true)
      applyGlobalOptions(root, root)
      expect(isJsonMode()).toBe(true)
    })
  })

  describe('verbose/debug helpers', () => {
    it('verbose() is silent unless verbose mode is on', () => {
      const debugSpy = vi.spyOn(logger, 'debug')
      verbose('hidden message')
      expect(debugSpy).not.toHaveBeenCalled()

      configureOutput({ verbose: true })
      logger.setLevel('debug')
      verbose('visible message')
      expect(debugSpy).toHaveBeenCalled()
    })

    it('debug() writes only in verbose mode', () => {
      const stderrSpy = process.stderr.write as unknown as ReturnType<typeof vi.fn>
      debug('hidden')
      const callsBefore = stderrSpy.mock.calls.length
      configureOutput({ verbose: true })
      debug('shown', { key: 'value' })
      expect(stderrSpy.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })
})
