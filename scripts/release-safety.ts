import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import semver from 'semver'

/** Operational arguments never pass through a shell. Network calls are bounded. */
export function command(root: string, executable: string, args: string[]): string {
  return execFileSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000
  }).trim()
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

export function isRegistryNotFound(error: unknown): boolean {
  if (!(error instanceof Error) || !('stdout' in error)) return false
  try {
    const output: unknown = JSON.parse(String(error.stdout))
    if (!output || typeof output !== 'object' || !('error' in output)) return false
    const detail = output.error
    return Boolean(
      detail && typeof detail === 'object' && 'code' in detail && detail.code === 'E404'
    )
  } catch {
    return false
  }
}

export function registryHasVersion(root: string, name: string, version: string): boolean {
  releaseTag(version)
  try {
    const result: unknown = JSON.parse(
      command(root, 'npm', ['view', `${name}@${version}`, 'version', '--json'])
    )
    if (result !== version) throw new Error(`Unexpected registry response for ${name}@${version}`)
    return true
  } catch (error) {
    if (isRegistryNotFound(error)) return false
    throw new Error(`Cannot verify ${name}@${version}; publication was not attempted`, {
      cause: error
    })
  }
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
