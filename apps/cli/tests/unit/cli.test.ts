/**
 * CLI structure tests.
 *
 * These run against the REAL command tree built by buildProgram() — every
 * command group is registered eagerly, so help output is complete without
 * executing any command. (The previous suite tested a hand-built replica
 * of the old lazy-loading CLI, including its placeholder commands, hello
 * test command and stats command, all of which are gone.)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Command } from 'commander'
import { buildProgram } from '@/cli.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
  version: string
}

const EXPECTED_GROUPS = [
  'init',
  'migrate',
  'generate',
  'db',
  'health',
  'audit',
  'debug',
  'query',
  'repository',
  'test',
  'plugin',
  'schema'
]

describe('CLI', () => {
  let program: Command

  beforeEach(() => {
    program = buildProgram()
    program.exitOverride()
    // Keep commander's own error writes out of the test output
    program.configureOutput({ writeErr: () => {}, writeOut: () => {} })
  })

  describe('basic structure', () => {
    it('has the correct name and description', () => {
      expect(program.name()).toBe('kysera')
      expect(program.description()).toContain('Kysera')
    })

    it('reads its version from package.json (no hardcoded fallback)', () => {
      expect(program.version()).toBe(pkg.version)
      expect(program.version()).not.toBe('0.5.1')
    })
  })

  describe('eager command registration', () => {
    it.each(EXPECTED_GROUPS)('registers the %s command', name => {
      const command = program.commands.find(cmd => cmd.name() === name)
      expect(command).toBeDefined()
      expect(command!.description()).toBeTruthy()
    })

    it('does not register the removed hello and stats dev commands', () => {
      const names = program.commands.map(cmd => cmd.name())
      expect(names).not.toContain('hello')
      expect(names).not.toContain('stats')
    })

    it('has unique command names', () => {
      const names = program.commands.map(cmd => cmd.name())
      expect(new Set(names).size).toBe(names.length)
    })
  })

  describe('complete help output (no lazy placeholders)', () => {
    it('shows all command groups in root help', () => {
      const help = program.helpInformation()
      for (const name of EXPECTED_GROUPS) {
        expect(help).toContain(name)
      }
    })

    it('shows full migrate subcommands in group help', () => {
      const migrate = program.commands.find(cmd => cmd.name() === 'migrate')!
      const help = migrate.helpInformation()
      for (const sub of ['create', 'up', 'down', 'status', 'list', 'reset', 'fresh']) {
        expect(help).toContain(sub)
      }
    })

    it('shows full generate model options in leaf help', () => {
      const generate = program.commands.find(cmd => cmd.name() === 'generate')!
      const model = generate.commands.find(cmd => cmd.name() === 'model')!
      const help = model.helpInformation()
      expect(help).toContain('--output')
      expect(help).toContain('--overwrite')
      expect(help).toContain('--json')
    })

    it('shows subcommands for every group', () => {
      for (const name of EXPECTED_GROUPS) {
        if (name === 'init') continue // init is a leaf command
        const group = program.commands.find(cmd => cmd.name() === name)!
        expect(group.commands.length, `group ${name} should have subcommands`).toBeGreaterThan(0)
      }
    })
  })

  describe('global options', () => {
    it('defines the global flags', () => {
      const flags = program.options.map(o => o.long)
      expect(flags).toEqual(
        expect.arrayContaining([
          '--verbose',
          '--quiet',
          '--dry-run',
          '--config',
          '--no-color',
          '--json',
          '--env'
        ])
      )
    })

    it('shows global options in help output', () => {
      const help = program.helpInformation()
      expect(help).toContain('--verbose')
      expect(help).toContain('--json')
      expect(help).toContain('--config')
    })
  })

  describe('destructive subcommands expose --force', () => {
    it.each([
      ['migrate', 'down'],
      ['migrate', 'reset'],
      ['migrate', 'fresh'],
      ['db', 'reset'],
      ['db', 'restore'],
      ['schema', 'drop']
    ])('%s %s has a --force flag', (groupName, subName) => {
      const group = program.commands.find(cmd => cmd.name() === groupName)!
      const sub = group.commands.find(cmd => cmd.name() === subName)!
      expect(sub.options.map(o => o.long)).toContain('--force')
    })
  })

  describe('unknown command handling', () => {
    it('rejects unknown commands', async () => {
      await expect(program.parseAsync(['node', 'kysera', 'frobnicate'])).rejects.toMatchObject({
        code: 'commander.unknownCommand'
      })
    })
  })

  describe('db console option naming', () => {
    it('uses -e/--execute (no collision with global -q/--quiet)', () => {
      const db = program.commands.find(cmd => cmd.name() === 'db')!
      const consoleCmd = db.commands.find(cmd => cmd.name() === 'console')!
      const flags = consoleCmd.options.map(o => o.long)
      expect(flags).toContain('--execute')
      expect(consoleCmd.options.map(o => o.short)).not.toContain('-q')
    })
  })
})
