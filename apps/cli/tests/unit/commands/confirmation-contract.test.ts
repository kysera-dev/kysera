import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Command } from 'commander'
import { confirm, select, text, group, CANCEL_SYMBOL } from '@xec-sh/kit'
import { configureOutput, resetOutput } from '@/utils/output.js'
import { addGlobalOptions, resetGlobalOptions } from '@/utils/global-options.js'
import { loadConfig, saveConfig } from '@/config/loader.js'
import { getDatabaseConnection } from '@/utils/database.js'
import { createCommand } from '@/commands/schema/create.js'
import { cloneCommand } from '@/commands/schema/clone.js'
import { configPluginCommand } from '@/commands/plugin/config.js'
import { enablePluginCommand } from '@/commands/plugin/enable.js'
import { disablePluginCommand } from '@/commands/plugin/disable.js'
import { inspectRepositoryCommand } from '@/commands/repository/inspect.js'
import { validateRepositoryCommand } from '@/commands/repository/validate.js'
import { showMethodsCommand } from '@/commands/repository/methods.js'
import { initCommand } from '@/commands/init/index.js'

const adapter = vi.hoisted(() => ({
  schemaExists: vi.fn(),
  createSchema: vi.fn(),
  cloneSchema: vi.fn(),
  getSchemaInfo: vi.fn()
}))
vi.mock('@xec-sh/kit', async importOriginal => {
  const actual = await importOriginal<typeof import('@xec-sh/kit')>()
  return {
    ...actual,
    // Prompts and terminal rendering are controlled here; the native PTY test
    // exercises the real Kit renderer with actual tty.ReadStream methods.
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn(), isCancelled: false })),
    confirm: vi.fn(),
    select: vi.fn(),
    text: vi.fn(),
    group: vi.fn()
  }
})
vi.mock('@/config/loader.js', () => ({ loadConfig: vi.fn(), saveConfig: vi.fn() }))
vi.mock('@/utils/database.js', () => ({ getDatabaseConnection: vi.fn() }))
vi.mock('@kysera/dialects', () => ({
  createPostgresAdapter: () => adapter,
  getTenantSchemaName: (id: string) => `tenant_${id}`
}))

const beforeTTY = [process.stdin.isTTY, process.stdout.isTTY]
const cwd = process.cwd()
let directory: string
let destroy: ReturnType<typeof vi.fn>
let stdout: string
function tty(enabled: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: enabled, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: enabled, configurable: true })
}
function invoke(command: Command, args: string[]): Promise<Command> {
  return command.exitOverride().parseAsync(args, { from: 'user' })
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetOutput()
  resetGlobalOptions()
  tty(true)
  directory = await mkdtemp(join(tmpdir(), 'kysera-confirm-'))
  process.chdir(directory)
  await mkdir(join(directory, 'node_modules/@kysera/soft-delete'), { recursive: true })
  await mkdir(join(directory, 'src'), { recursive: true })
  await writeFile(join(directory, 'src/UserRepository.ts'), 'export class UserRepository {}')
  vi.mocked(loadConfig).mockResolvedValue({
    database: { dialect: 'postgres' },
    plugins: { '@kysera/soft-delete': { enabled: true, column: 'old_column' } }
  } as Awaited<ReturnType<typeof loadConfig>>)
  vi.mocked(saveConfig).mockResolvedValue(undefined)
  destroy = vi.fn().mockResolvedValue(undefined)
  vi.mocked(getDatabaseConnection).mockResolvedValue({ destroy } as unknown as Awaited<
    ReturnType<typeof getDatabaseConnection>
  >)
  adapter.schemaExists.mockImplementation((_db: unknown, name: string) =>
    Promise.resolve(name === 'source')
  )
  adapter.createSchema.mockResolvedValue(true)
  adapter.getSchemaInfo.mockResolvedValue({ tableCount: 0, sizeBytes: 0 })
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
  process.chdir(cwd)
  Object.defineProperty(process.stdin, 'isTTY', { value: beforeTTY[0], configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: beforeTTY[1], configurable: true })
  resetOutput()
  resetGlobalOptions()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

const confirmationCases: Array<[string, () => Command, string[]]> = [
  ['schema create', createCommand, ['new_schema']],
  ['schema clone', cloneCommand, ['source', 'target']],
  ['plugin reset', configPluginCommand, ['@kysera/soft-delete', '--reset']],
  ['plugin enable all', enablePluginCommand, ['--all']],
  ['plugin disable all', disablePluginCommand, ['--all']]
]

describe.each(confirmationCases)('%s', (_name, command, args) => {
  it.each([false, CANCEL_SYMBOL])(
    'does not write after refusal or cancellation (%s)',
    async answer => {
      vi.mocked(confirm).mockResolvedValue(answer)
      await invoke(command(), args)
      expect(confirm).toHaveBeenCalledOnce()
      expect(saveConfig).not.toHaveBeenCalled()
      expect(adapter.createSchema).not.toHaveBeenCalled()
      expect(adapter.cloneSchema).not.toHaveBeenCalled()
    }
  )
  it.each(['pipe', 'json'])('refuses without explicit confirmation in %s mode', async mode => {
    if (mode === 'pipe') tty(false)
    else configureOutput({ json: true })
    await expect(invoke(command(), args)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    expect(confirm).not.toHaveBeenCalled()
    expect(saveConfig).not.toHaveBeenCalled()
    expect(adapter.createSchema).not.toHaveBeenCalled()
    expect(adapter.cloneSchema).not.toHaveBeenCalled()
    if (_name.startsWith('schema')) expect(destroy).toHaveBeenCalledOnce()
  })
})

it('schema --force is explicit permission even with NODE_ENV=test and no TTY', async () => {
  tty(false)
  await invoke(createCommand(), ['new_schema', '--force'])
  expect(adapter.createSchema).toHaveBeenCalledOnce()
  expect(confirm).not.toHaveBeenCalled()
  expect(destroy).toHaveBeenCalledOnce()
})
it('plugin reset --json requires --force, then emits exactly one JSON result', async () => {
  await expect(
    invoke(configPluginCommand(), ['@kysera/soft-delete', '--reset', '--json'])
  ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
  expect(saveConfig).not.toHaveBeenCalled()
  stdout = ''
  await invoke(configPluginCommand(), ['@kysera/soft-delete', '--reset', '--json', '--force'])
  expect(saveConfig).toHaveBeenCalledOnce()
  expect(JSON.parse(stdout)).toMatchObject({ plugin: '@kysera/soft-delete', reset: true })
})

it.each([
  ['plugin config', configPluginCommand],
  ['plugin disable', disablePluginCommand],
  ['repository inspect', inspectRepositoryCommand],
  ['repository methods', showMethodsCommand]
] as const)('%s ends on a cancelled selection', async (_name, factory) => {
  vi.mocked(select).mockResolvedValue(CANCEL_SYMBOL)
  await invoke(factory(), [])
  expect(select).toHaveBeenCalledOnce()
  expect(saveConfig).not.toHaveBeenCalled()
})
it('plugin enable ends on a cancelled selection before attempting validation', async () => {
  vi.mocked(loadConfig).mockResolvedValue({ plugins: {} } as Awaited<ReturnType<typeof loadConfig>>)
  vi.mocked(select).mockResolvedValue(CANCEL_SYMBOL)
  await invoke(enablePluginCommand(), [])
  expect(select).toHaveBeenCalledOnce()
  expect(saveConfig).not.toHaveBeenCalled()
})
it('editing cannot open prompts in JSON mode', async () => {
  await expect(
    invoke(configPluginCommand(), ['@kysera/soft-delete', '--edit', '--json'])
  ).rejects.toMatchObject({ code: 'INTERACTION_REQUIRED' })
  expect(text).not.toHaveBeenCalled()
  expect(saveConfig).not.toHaveBeenCalled()
})
it.each(['text', 'boolean'])('cancelled %s edit never commits earlier answers', async kind => {
  vi.mocked(text).mockResolvedValue(kind === 'text' ? CANCEL_SYMBOL : 'new_column')
  vi.mocked(confirm).mockResolvedValue(CANCEL_SYMBOL)
  await invoke(configPluginCommand(), ['@kysera/soft-delete', '--edit'])
  expect(saveConfig).not.toHaveBeenCalled()
})
it('init cancellation in a later group field creates no project directory', async () => {
  vi.mocked(group).mockResolvedValue({
    projectName: 'never-created',
    template: 'basic',
    database: CANCEL_SYMBOL
  } as never)
  await expect(invoke(initCommand(), [])).rejects.toMatchObject({ code: 'CANCELLED' })
  await expect(readFile(join(directory, 'never-created/package.json'))).rejects.toMatchObject({
    code: 'ENOENT'
  })
})
it('init stops the published Kit group through onCancel', async () => {
  vi.mocked(group).mockImplementation(async (_prompts, options) => {
    options?.onCancel?.({ results: {} })
    throw new Error('onCancel must stop the group')
  })
  await expect(invoke(initCommand(), [])).rejects.toMatchObject({ code: 'CANCELLED' })
})
it('root --dry-run cannot silently permit an unsupported schema write', async () => {
  const root = addGlobalOptions(new Command())
  root.addCommand(createCommand())
  await expect(
    invoke(root, ['--dry-run', 'create', 'new_schema', '--force'])
  ).rejects.toMatchObject({ code: 'DRY_RUN_UNSUPPORTED' })
  expect(loadConfig).not.toHaveBeenCalled()
  expect(adapter.createSchema).not.toHaveBeenCalled()
})

it.each([
  ['create', createCommand, ['new_schema']],
  ['clone', cloneCommand, ['source', 'target']]
] as const)('schema %s emits one JSON result with explicit force', async (_name, factory, args) => {
  const command = factory()
  const root = addGlobalOptions(new Command()).addCommand(command)
  await root.parseAsync([command.name(), ...args, '--force', '--json'], { from: 'user' })
  expect(JSON.parse(stdout)).toBeTypeOf('object')
  expect(confirm).not.toHaveBeenCalled()
})
it('unsupported init JSON fails before creating files', async () => {
  configureOutput({ json: true })
  await expect(
    invoke(initCommand(), ['never-created', '--no-install', '--no-git'])
  ).rejects.toMatchObject({ code: 'JSON_OUTPUT_UNSUPPORTED' })
  await expect(readFile(join(directory, 'never-created/package.json'))).rejects.toMatchObject({
    code: 'ENOENT'
  })
})

it.each([false, CANCEL_SYMBOL, 'json', 'force'])(
  'repository fixes require explicit permission (%s) and release the database',
  async answer => {
    const file = join(directory, 'src/UserRepository.ts')
    const original =
      "interface UserEntity { id: number; }\nexport class UserRepository { tableName = 'users' }"
    await writeFile(file, original)
    const columns = [
      { name: 'id', type: 'integer', nullable: 'NO' },
      { name: 'name', type: 'text', nullable: 'NO' }
    ]
    const connection = {
      destroy,
      selectFrom(table: string) {
        const query = {
          select() {
            return query
          },
          where() {
            return query
          },
          async execute() {
            return table.endsWith('.tables') ? [{ table_name: 'users' }] : columns
          },
          async executeTakeFirst() {
            return columns[1]
          }
        }
        return query
      }
    }
    vi.mocked(getDatabaseConnection).mockResolvedValue(
      connection as unknown as Awaited<ReturnType<typeof getDatabaseConnection>>
    )
    if (answer === 'json') {
      await expect(invoke(validateRepositoryCommand(), ['--fix', '--json'])).rejects.toMatchObject({
        code: 'CONFIRMATION_REQUIRED'
      })
    } else {
      vi.mocked(confirm).mockResolvedValue(answer === 'force' ? false : answer)
      configureOutput({ json: true })
      if (answer !== 'force') configureOutput({ json: false })
      await invoke(validateRepositoryCommand(), [
        '--fix',
        ...(answer === 'force' ? ['--force', '--json'] : [])
      ])
    }
    expect(destroy).toHaveBeenCalledOnce()
    if (answer === 'force') {
      expect(await readFile(file, 'utf8')).toContain('name: string;')
      expect(JSON.parse(stdout)).toBeInstanceOf(Array)
    } else expect(await readFile(file, 'utf8')).toBe(original)
  }
)
