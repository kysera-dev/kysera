import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { PassThrough } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import semver from 'semver'

/** Operational arguments never pass through a shell. Network calls are bounded. */
export function command(root: string, executable: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync(executable, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000
  }).trim()
}

/** Keep the first failing assertion even when other packages are still running. */
export async function runReleaseTests(root: string, version: string): Promise<void> {
  const directory = join(root, '.release-artifacts', releaseTag(version).slice(1), 'validation')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, `tests-${Date.now()}-${process.pid}.log`)
  console.log(`Running the full test suite. Transcript: ${file}`)
  const child = spawn('pnpm', ['run', 'test', '--concurrency=2', '--continue=dependencies-successful', '--log-order=grouped'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32',
    env: { ...process.env, VITEST_MAX_WORKERS: '2' }
  })
  const merged = new PassThrough()
  child.stdout.pipe(process.stdout, { end: false })
  child.stderr.pipe(process.stderr, { end: false })
  child.stdout.pipe(merged, { end: false })
  child.stderr.pipe(merged, { end: false })
  const output = pipeline(merged, createWriteStream(file, { flags: 'wx', mode: 0o600 }))
  const closed = (once(child, 'close') as Promise<[number | null, string | null]>).finally(() => merged.end())
  try {
    const [[code, signal]] = await Promise.all([closed, output])
    if (code !== 0) throw new Error(`Kysera tests failed (${signal ?? code}). Full test output: ${file}`)
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    throw error
  }
}

export function releaseTag(version: string): string {
  if (semver.valid(version) !== version)
    throw new Error(`Expected a canonical semver version: ${version}`)
  return `v${version}`
}

export function localReleaseCommit(root: string, version: string): string | null {
  const tag = releaseTag(version)
  if (!command(root, 'git', ['tag', '--list', tag])) return null
  return command(root, 'git', ['rev-parse', `refs/tags/${tag}^{commit}`])
}

/** Resuming npm publication must use the exact source tree that was tagged. */
export function assertReleaseHead(root: string, version: string): void {
  const commit = localReleaseCommit(root, version)
  if (commit && commit !== command(root, 'git', ['rev-parse', 'HEAD'])) {
    throw new Error(
      `Tag ${releaseTag(version)} does not point to HEAD. Use its clean checkout to resume npm publication, or --github-only to finish GitHub without publishing.`
    )
  }
}

/** Read just this tag. Divergent historical tags are intentionally irrelevant. */
export function verifyRemoteTag(root: string, version: string, required = false): boolean {
  const tag = releaseTag(version)
  const ref = `refs/tags/${tag}`
  const remote = command(root, 'git', ['ls-remote', '--tags', 'origin', ref])
  if (!remote) {
    if (required) throw new Error(`Remote tag ${tag} is missing; push the release first`)
    return false
  }
  const commit = localReleaseCommit(root, version)
  if (!commit) throw new Error(`Remote ${tag} already exists; fetch this exact tag before resuming`)
  const localObject = command(root, 'git', ['rev-parse', ref])
  if (remote.split(/\s+/)[0] !== localObject) {
    throw new Error(`Remote and local ${tag} differ. Refusing to replace an existing release tag`)
  }
  return true
}

/** Atomic branch + one tag, even when push.followTags is enabled in user config. */
export function pushReleaseRefs(root: string, version: string): void {
  assertReleaseHead(root, version)
  if (!localReleaseCommit(root, version)) throw new Error('Release tag has not been created')
  const alreadyPushed = verifyRemoteTag(root, version)
  const branch = command(root, 'git', ['branch', '--show-current'])
  if (!branch) throw new Error('Cannot push a release from detached HEAD')
  command(root, 'git', ['check-ref-format', `refs/heads/${branch}`])
  const tag = releaseTag(version)
  if (
    alreadyPushed &&
    command(root, 'git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])
  ) {
    // A partial npm release can resume after the branch has advanced. Fetch
    // into FETCH_HEAD only; never move that branch back to the release commit.
    command(root, 'git', ['fetch', '--no-tags', 'origin', `refs/heads/${branch}`])
    try {
      command(root, 'git', [
        'merge-base',
        '--is-ancestor',
        `refs/tags/${tag}^{commit}`,
        'FETCH_HEAD'
      ])
      return
    } catch (error) {
      if (!(error instanceof Error) || !('status' in error) || error.status !== 1) throw error
    }
  }
  command(root, 'git', [
    '-c',
    'push.followTags=false',
    'push',
    '--atomic',
    'origin',
    `HEAD:refs/heads/${branch}`,
    `refs/tags/${tag}:refs/tags/${tag}`
  ])
}

export function releaseNotes(changelog: string, version: string): string {
  releaseTag(version)
  const lines = changelog.split('\n')
  const start = lines.findIndex(line => line.startsWith(`## [${version}]`))
  if (start < 0) throw new Error(`Missing changelog entry for ${version}`)
  const following = lines.findIndex((line, index) => index > start && line.startsWith('## ['))
  return (
    lines
      .slice(start, following < 0 ? undefined : following)
      .join('\n')
      .trim() + '\n'
  )
}

export function registryErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('stdout' in error)) return
  try {
    const output: unknown = JSON.parse(String(error.stdout))
    if (!output || typeof output !== 'object' || !('error' in output)) return
    const detail = output.error
    if (detail && typeof detail === 'object' && 'code' in detail && typeof detail.code === 'string') return detail.code
    return undefined
  } catch { return undefined }
}

export function isRegistryNotFound(error: unknown): boolean {
  return registryErrorCode(error) === 'E404'
}

/** Finish GitHub from the immutable tag, without rebuilding or touching npm. */
export async function createGithubRelease(
  root: string,
  version: string,
  repository: string
): Promise<string> {
  verifyRemoteTag(root, version, true)
  const tag = releaseTag(version)
  const tags = command(root, 'gh', [
    'api',
    '--paginate',
    `repos/${repository}/releases`,
    '--jq',
    '.[].tag_name'
  ])
  if (!tags.split('\n').includes(tag)) {
    const notes = releaseNotes(command(root, 'git', ['show', `${tag}:CHANGELOG.md`]), version)
    const directory = await mkdtemp(join(tmpdir(), 'kysera-release-'))
    try {
      const file = join(directory, 'notes.md')
      await writeFile(file, notes, { mode: 0o600 })
      command(root, 'gh', [
        'release',
        'create',
        tag,
        '--repo',
        repository,
        '--verify-tag',
        '--title',
        `Kysera ${tag}`,
        '--notes-file',
        file,
        ...(semver.prerelease(version) ? ['--prerelease'] : [])
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  return command(root, 'gh', [
    'release',
    'view',
    tag,
    '--repo',
    repository,
    '--json',
    'url',
    '--jq',
    '.url'
  ])
}
