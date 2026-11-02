import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [archive, version] = process.argv.slice(2)
if (!archive || !version) throw new Error('Expected a CLI archive and its exact version')
const workspace = fileURLToPath(new URL('../', import.meta.url))
const consumer = await mkdtemp(join(tmpdir(), 'kysera-packed-cli-'))
const run = (exe: string, args: string[]): string => execFileSync(exe, args, { cwd: consumer, encoding: 'utf8', timeout: 120_000 }).trim()
try {
  const tarball = resolve(archive)
  const entries = run('tar', ['-tzf', tarball]).split('\n')
  assert.ok(entries.every(name => name.startsWith('package/') && !name.includes('\\') && !name.split('/').includes('..')), 'Invalid package path')
  run('tar', ['-xzf', tarball])
  const scope = join(consumer, 'node_modules', '@kysera'), cli = join(scope, 'cli')
  await mkdir(scope, { recursive: true })
  await rename(join(consumer, 'package'), cli)
  // The candidate's frozen dependencies are available before its sibling packages reach npm.
  await symlink(join(workspace, 'apps/cli/node_modules'), join(cli, 'node_modules'), 'junction')
  const manifest = JSON.parse(await readFile(join(cli, 'package.json'), 'utf8')) as { name: string; version: string; bin: { kysera: string } }
  assert.equal(manifest.name, '@kysera/cli')
  assert.equal(manifest.version, version)
  assert.equal(run(process.execPath, [join(cli, manifest.bin.kysera), '--version']), version)
  const checkImport = `
    import assert from 'node:assert/strict'
    const events = ['uncaughtException', 'unhandledRejection']
    const listeners = events.map(event => process.listenerCount(event))
    const { defineConfig } = await import('@kysera/cli')
    const config = { database: { dialect: 'sqlite', database: ':memory:' } }
    assert.equal(defineConfig(config), config)
    assert.deepEqual(events.map(event => process.listenerCount(event)), listeners)
    console.log('public API verified')
  `
  assert.equal(run(process.execPath, ['--input-type=module', '--eval', checkImport]), 'public API verified')
  await writeFile(join(consumer, 'consumer.mts'), `
    import { defineConfig, type KyseraConfigInput, type SeedContext } from '@kysera/cli'
    export const config = defineConfig({ database: { dialect: 'sqlite', database: ':memory:' } } satisfies KyseraConfigInput)
    export const isDryRun = (seed: SeedContext) => seed.dryRun
    // @ts-expect-error Invalid dialects must fail at the consuming project's boundary.
    defineConfig({ database: { dialect: 'invalid-dialect' } })
  `)
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { module: 'NodeNext', target: 'ES2022', strict: true, noEmit: true, types: [] }, files: ['consumer.mts']
  }))
  const require = createRequire(join(workspace, 'package.json'))
  run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')])
  console.log(`Verified packed @kysera/cli@${version}: executable, public import and TypeScript declarations`)
} finally { await rm(consumer, { recursive: true, force: true }) }
