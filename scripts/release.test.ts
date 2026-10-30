import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  command,
  pushReleaseRefs,
  assertReleaseHead,
  releaseNotes,
  releaseTag,
  isRegistryNotFound
} from './release-safety.js'
import { parseArgs, sortByDependencyOrder } from './release.js'

async function fixture(): Promise<{ root: string; remote: string; close: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'kysera-release-test-'))
  const root = join(directory, 'work'),
    remote = join(directory, 'remote.git')
  await mkdir(root)
  command(root, 'git', ['init', '-b', 'main'])
  command(root, 'git', ['config', 'user.email', 'test@example.invalid'])
  command(root, 'git', ['config', 'user.name', 'Release test'])
  command(root, 'git', ['config', 'commit.gpgsign', 'false'])
  command(root, 'git', ['config', 'tag.gpgsign', 'false'])
  command(root, 'git', ['init', '--bare', remote])
  command(root, 'git', ['remote', 'add', 'origin', remote])
  command(root, 'git', ['commit', '--allow-empty', '-m', 'initial'])
  command(root, 'git', ['push', 'origin', 'HEAD:refs/heads/main'])
  return { root, remote, close: () => rm(directory, { recursive: true, force: true }) }
}

test('pushes exactly the release tag, ignores divergent old tags and supports a repeat', async () => {
  const f = await fixture()
  try {
    command(f.root, 'git', ['tag', '-a', 'v0.3.0', '-m', 'original'])
    command(f.root, 'git', ['push', 'origin', 'refs/tags/v0.3.0'])
    const old = command(f.remote, 'git', ['rev-parse', 'refs/tags/v0.3.0'])
    command(f.root, 'git', ['tag', '-f', '-a', 'v0.3.0', '-m', 'local rewritten history'])
    command(f.root, 'git', ['commit', '--allow-empty', '-m', 'release'])
    command(f.root, 'git', ['tag', '-a', 'v0.10.1', '-m', 'release'])
    command(f.root, 'git', ['tag', '-a', 'unrelated', '-m', 'unrelated'])
    command(f.root, 'git', ['config', 'push.followTags', 'true'])
    pushReleaseRefs(f.root, '0.10.1')
    pushReleaseRefs(f.root, '0.10.1')
    assert.equal(command(f.remote, 'git', ['rev-parse', 'refs/tags/v0.3.0']), old)
    assert.equal(command(f.remote, 'git', ['tag', '--list', 'unrelated']), '')
    assert.equal(
      command(f.remote, 'git', ['rev-parse', 'refs/tags/v0.10.1^{commit}']),
      command(f.root, 'git', ['rev-parse', 'HEAD'])
    )
  } finally {
    await f.close()
  }
})

test('rejects a current-tag conflict without advancing the remote branch', async () => {
  const f = await fixture()
  try {
    command(f.root, 'git', ['tag', '-a', 'v0.10.1', '-m', 'published'])
    command(f.root, 'git', ['push', 'origin', 'refs/tags/v0.10.1'])
    const before = command(f.remote, 'git', ['rev-parse', 'refs/heads/main'])
    command(f.root, 'git', ['commit', '--allow-empty', '-m', 'different code'])
    command(f.root, 'git', ['tag', '-f', '-a', 'v0.10.1', '-m', 'different'])
    assert.throws(() => pushReleaseRefs(f.root, '0.10.1'), /differ/)
    assert.equal(command(f.remote, 'git', ['rev-parse', 'refs/heads/main']), before)
  } finally {
    await f.close()
  }
})

test('rejects resuming npm from code newer than the existing release tag', async () => {
  const f = await fixture()
  try {
    command(f.root, 'git', ['tag', 'v0.10.1'])
    command(f.root, 'git', ['commit', '--allow-empty', '-m', 'later changes'])
    assert.throws(() => assertReleaseHead(f.root, '0.10.1'), /does not point to HEAD/)
  } finally {
    await f.close()
  }
})

test('a rejected branch push cannot partially publish a new release tag', async () => {
  const f = await fixture()
  try {
    const old = command(f.root, 'git', ['rev-parse', 'HEAD'])
    command(f.root, 'git', ['commit', '--allow-empty', '-m', 'remote work'])
    command(f.root, 'git', ['push', 'origin', 'HEAD:refs/heads/main'])
    command(f.root, 'git', ['switch', '-c', 'release-fixture', old])
    command(f.root, 'git', ['commit', '--allow-empty', '-m', 'divergent release'])
    command(f.root, 'git', ['tag', 'v0.10.1'])
    command(f.root, 'git', ['branch', '-D', 'main'])
    command(f.root, 'git', ['branch', '-m', 'main'])
    assert.throws(() => pushReleaseRefs(f.root, '0.10.1'), /Command failed/)
    assert.equal(command(f.remote, 'git', ['tag', '--list', 'v0.10.1']), '')
  } finally {
    await f.close()
  }
})

test('only registry E404 means a version can be published', () => {
  assert.equal(
    isRegistryNotFound(
      Object.assign(new Error('missing'), { stdout: JSON.stringify({ error: { code: 'E404' } }) })
    ),
    true
  )
  for (const code of ['E401', 'E403', 'ETIMEDOUT', 'EAI_AGAIN']) {
    assert.equal(
      isRegistryNotFound(
        Object.assign(new Error(code), { stdout: JSON.stringify({ error: { code } }) })
      ),
      false
    )
  }
  assert.equal(isRegistryNotFound(new Error('network unavailable')), false)
})

test('rejects ambiguous arguments and noncanonical versions', () => {
  for (const args of [
    ['--version'],
    ['--version='],
    ['--yes'],
    ['--github-only'],
    ['--typo'],
    ['--version=1.0.0=oops'],
    ['--version=1.0.0', '--version=2.0.0']
  ])
    assert.throws(() => parseArgs(args))
  assert.deepEqual(parseArgs(['--github-only', '--version', '0.10.1']).version, '0.10.1')
  assert.throws(() => releaseTag('v0.10.1'))
  assert.equal(releaseTag('1.0.0-rc.1'), 'v1.0.0-rc.1')
})

test('GitHub notes contain only the chosen immutable version', () => {
  const notes =
    '# Changelog\n\n## [0.10.2] - later\nnew\n\n## [0.10.1] - date\nfixed\n\n## [0.10.0] - older\nold\n'
  assert.equal(releaseNotes(notes, '0.10.1'), '## [0.10.1] - date\nfixed\n')
  assert.throws(() => releaseNotes(notes, '0.9.0'), /Missing changelog/)
})

test('dependency cycles fail before release mutation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kysera-order-test-'))
  try {
    const packages = []
    for (const [name, other] of [
      ['a', 'b'],
      ['b', 'a']
    ] as const) {
      const path = join(directory, name)
      await mkdir(path)
      await writeFile(
        join(path, 'package.json'),
        JSON.stringify({ dependencies: { ['@kysera/' + other]: 'workspace:*' } })
      )
      packages.push({ name: '@kysera/' + name, version: '1.0.0', path, private: false })
    }
    await assert.rejects(sortByDependencyOrder(packages), /dependency cycle/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('resumes after the remote release branch advances without rewinding it', async () => {
  const f = await fixture()
  try {
    command(f.root, 'git', ['tag', 'v0.10.1'])
    pushReleaseRefs(f.root, '0.10.1')
    command(f.root, 'git', ['switch', '-c', 'later'])
    command(f.root, 'git', ['commit', '--allow-empty', '-m', 'later work'])
    command(f.root, 'git', ['push', 'origin', 'HEAD:refs/heads/main'])
    const later = command(f.remote, 'git', ['rev-parse', 'refs/heads/main'])
    command(f.root, 'git', ['switch', 'main'])
    pushReleaseRefs(f.root, '0.10.1')
    assert.equal(command(f.remote, 'git', ['rev-parse', 'refs/heads/main']), later)
  } finally {
    await f.close()
  }
})

test('real dry-run entry point leaves files, tags and remote refs unchanged', async () => {
  const f = await fixture()
  try {
    await mkdir(join(f.root, 'scripts'))
    for (const file of ['release.ts', 'release-safety.ts']) {
      await writeFile(join(f.root, 'scripts', file), await readFile(new URL(file, import.meta.url)))
    }
    await symlink(
      new URL('../node_modules', import.meta.url).pathname,
      join(f.root, 'node_modules')
    )
    await writeFile(join(f.root, '.gitignore'), 'node_modules\n')
    await writeFile(
      join(f.root, 'package.json'),
      JSON.stringify({ name: 'release-fixture', version: '0.10.1', private: true, type: 'module' })
    )
    command(f.root, 'git', ['add', '.'])
    command(f.root, 'git', ['commit', '-m', 'release fixture'])
    const before = command(f.root, 'git', ['rev-parse', 'HEAD'])
    const remote = command(f.remote, 'git', ['rev-parse', 'refs/heads/main'])
    const output = command(f.root, process.execPath, [
      '--import',
      'tsx',
      'scripts/release.ts',
      '--version',
      '0.10.2',
      '--dry-run',
      '--yes'
    ])
    assert.match(output, /Dry run completed/)
    assert.equal(command(f.root, 'git', ['status', '--porcelain']), '')
    assert.equal(command(f.root, 'git', ['rev-parse', 'HEAD']), before)
    assert.equal(command(f.root, 'git', ['tag', '--list', 'v0.10.2']), '')
    assert.equal(command(f.remote, 'git', ['rev-parse', 'refs/heads/main']), remote)
  } finally {
    await f.close()
  }
})
