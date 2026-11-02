import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, cp } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { command } from './release-safety.js'
import { stageReleaseArtifact, registryArtifactMatches, verifyArtifact, archiveIntegrity, publishReleaseArtifact, acquireReleaseLock } from './release-artifacts.js'

test('stages exact publishable archives, reuses them on resume and rejects later modification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kysera-artifacts-'))
  try {
    command(root, 'git', ['init'])
    command(root, 'git', ['-c', 'user.name=Release test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture'])
    const pkg = { name: '@kysera/fixture', path: join(root, 'source') }
    const packed = join(pkg.path, 'package')
    await mkdir(join(packed, 'dist'), { recursive: true })
    await writeFile(join(packed, 'package.json'), JSON.stringify({ name: pkg.name, version: '1.0.0', main: './dist/index.js', dependencies: { '@kysera/core': '1.0.0' } }))
    await writeFile(join(packed, 'dist/index.js'), 'export const version = 1')
    let packs = 0
    const run: typeof command = (cwd, bin, args) => {
      if (bin !== 'pnpm') return command(cwd, bin, args)
      packs++
      assert.ok(args.includes('--config.ignore-scripts=true'))
      return command(pkg.path, 'tar', ['-czf', join(args.at(-1)!, 'fixture.tgz'), 'package'])
    }
    const first = await stageReleaseArtifact(root, pkg, '1.0.0', run)
    assert.equal(first.integrity, archiveIntegrity(await readFile(first.file)))
    await writeFile(join(packed, 'dist/index.js'), 'different build bytes')
    assert.deepEqual(await stageReleaseArtifact(root, pkg, '1.0.0', run), first)
    assert.equal(packs, 1)
    // A restored CI cache must retain the original archive without retaining its old checkout path.
    const restoredRoot = join(root, 'restored-checkout')
    await cp(join(root, '.release-artifacts'), join(restoredRoot, '.release-artifacts'), { recursive: true })
    const restoredRun: typeof command = (cwd, bin, args) => {
      if (bin === 'git' && args[0] === 'rev-parse') return first.commit
      if (bin === 'pnpm') throw new Error('A restored archive must not be repacked')
      return run(cwd, bin, args)
    }
    const restored = await stageReleaseArtifact(restoredRoot, pkg, '1.0.0', restoredRun)
    assert.notEqual(restored.file, first.file)
    assert.equal(restored.integrity, first.integrity)
    assert.deepEqual(await readFile(restored.file), await readFile(first.file))
    assert.equal(registryArtifactMatches(root, first, () => JSON.stringify({ name: first.name, version: '1.0.0', dist: { integrity: first.integrity } })), true)
    assert.throws(() => registryArtifactMatches(root, first, () => JSON.stringify({ name: first.name, version: '1.0.0', dist: { integrity: archiveIntegrity(Buffer.from('different package')) } })), /differs/)
    const missing = () => { throw Object.assign(new Error('not found'), { stdout: JSON.stringify({ error: { code: 'E404' } }) }) }
    assert.equal(registryArtifactMatches(root, first, missing), false)
    const unavailable = () => { throw new Error('network unavailable') }
    assert.throws(() => registryArtifactMatches(root, first, unavailable), /Cannot verify/)
    await chmod(first.file, 0o600); await writeFile(first.file, 'modified')
    await assert.rejects(verifyArtifact(first), /modified/)
    await assert.rejects(stageReleaseArtifact(root, pkg, '1.0.0', run), /modified/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects a missing compiled entry and a local dependency before any publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kysera-artifact-invalid-'))
  try {
    const pkg = { name: '@kysera/fixture', path: root }
    const run: typeof command = (_cwd, bin, args) => {
      if (bin === 'git') return 'a'.repeat(40)
      if (bin === 'pnpm') { command(root, 'touch', [join(args.at(-1)!, 'fixture.tgz')]); return '' }
      if (args[0] === '-xOf') return JSON.stringify({ name: pkg.name, version: '1.0.0', main: './dist/index.js' })
      return 'package/package.json'
    }
    await assert.rejects(stageReleaseArtifact(root, pkg, '1.0.0', run), /missing exported entry/)
    const local: typeof command = (cwd, bin, args) => args[0] === '-xOf'
      ? JSON.stringify({ name: pkg.name, version: '1.0.0', dependencies: { local: 'workspace:*' } })
      : run(cwd, bin, args)
    await assert.rejects(stageReleaseArtifact(root, pkg, '1.0.0', local), /unpublished local dependencies/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('serializes release writers and leaves dry-run paths outside the lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kysera-release-lock-'))
  try {
    const release = await acquireReleaseLock(root)
    await assert.rejects(acquireReleaseLock(root), /Release is locked/)
    await release()
    await (await acquireReleaseLock(root))()
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const outcome of ['accepted', 'reserved', 'otp']) {
  test(`resumes a ${outcome} upload and verifies the downloadable archive before its channel`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'kysera-publication-'))
    try {
      const bytes = Buffer.from('sealed archive'), file = join(root, 'fixture.tgz')
      await writeFile(file, bytes)
      const artifact = { schema: 1 as const, commit: 'a'.repeat(40), name: '@kysera/fixture', version: '1.0.0', file, integrity: archiveIntegrity(bytes) }
      const observed = { writes: 0, downloads: 0 }
      let metadata = false, tarball = false, channel = '0.9.0'
      const npmError = (code: string) => Object.assign(new Error(code), { stdout: JSON.stringify({ error: { code } }) })
      const run: typeof command = (_cwd, bin, args, env) => {
        assert.equal(bin, 'npm')
        if (args[0] === 'publish') {
          observed.writes++
          if (outcome === 'otp' && !env?.['npm_config_otp']) throw npmError('EOTP')
          if (outcome === 'otp') assert.ok(!args.includes(env?.['npm_config_otp'] ?? ''))
          if (outcome === 'reserved') throw npmError('E409')
          return ''
        }
        if (args.includes('dist-tags')) return JSON.stringify({ latest: channel })
        if (args[0] === 'pack') {
          if (!tarball) throw npmError('E404')
          const directory = args[args.indexOf('--pack-destination') + 1]!
          assert.equal(args[args.indexOf('--cache') + 1], join(directory, 'cache'))
          observed.downloads++
          writeFileSync(join(directory, 'fixture.tgz'), bytes)
          return JSON.stringify([{ filename: 'fixture.tgz' }])
        }
        if (!metadata) throw npmError('E404')
        return JSON.stringify({ name: artifact.name, version: artifact.version, dist: { integrity: artifact.integrity } })
      }
      const options = { run, confirmationTimeoutMs: 0, otp: async () => '123456' }
      await assert.rejects(publishReleaseArtifact(root, artifact, options), /version metadata/)
      const attempts = observed.writes
      assert.equal(attempts, outcome === 'otp' ? 2 : 1)
      await assert.rejects(publishReleaseArtifact(root, artifact, options), /version metadata/)
      metadata = true
      await assert.rejects(publishReleaseArtifact(root, artifact, options), /downloadable tarball/)
      tarball = true
      await assert.rejects(publishReleaseArtifact(root, artifact, options), /latest channel/)
      channel = '1.0.1'
      await publishReleaseArtifact(root, artifact, options)
      assert.equal(observed.writes, attempts)
      assert.equal(observed.downloads, 2)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}
