import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile, rename, rm, chmod } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import semver from 'semver'
import { command, releaseTag, isRegistryNotFound, registryErrorCode } from './release-safety.js'

type Run = typeof command
export interface ReleaseArtifact {
  schema: 1
  commit: string
  name: string
  version: string
  file: string
  integrity: string
}
export const archiveIntegrity = (bytes: Buffer): string =>
  'sha512-' + createHash('sha512').update(bytes).digest('base64')
const missing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

const npmRegistry = 'https://registry.npmjs.org/'
const registryArgs = ['--registry', npmRegistry, '--@kysera:registry=' + npmRegistry]

/** Validate the immutable version metadata before considering an upload. */
export function registryArtifactMatches(
  root: string, artifact: ReleaseArtifact, run: Run = command
): boolean {
  let data: unknown
  try {
    data = JSON.parse(run(root, 'npm', ['view', `${artifact.name}@${artifact.version}`, '--json', '--prefer-online', ...registryArgs]))
  } catch (error) {
    if (isRegistryNotFound(error)) return false
    throw new Error(`Cannot verify ${artifact.name}@${artifact.version}; publication was not attempted`, { cause: error })
  }
  if (!data || typeof data !== 'object' || !('name' in data) || data.name !== artifact.name || !('version' in data) || data.version !== artifact.version ||
      !('dist' in data) || !data.dist || typeof data.dist !== 'object' || !('integrity' in data.dist) ||
      typeof data.dist.integrity !== 'string' || !data.dist.integrity.split(/\s+/).includes(artifact.integrity)) {
    throw new Error(`Registry artifact differs from ${artifact.name}@${artifact.version}. Refusing to skip or replace an immutable release; recover the original archive or use a new version.`)
  }
  return true
}

export async function verifyArtifact(artifact: ReleaseArtifact): Promise<void> {
  if (archiveIntegrity(await readFile(artifact.file)) !== artifact.integrity)
    throw new Error(`Release archive was modified: ${artifact.file}`)
}

interface PublicationOptions {
  run?: Run
  provenance?: boolean
  otp?: () => Promise<string>
  progress?: (message: string) => void
  confirmationTimeoutMs?: number
  confirmationIntervalMs?: number
}

function channelVersion(root: string, name: string, tag: string, run: Run): string | undefined {
  try {
    const tags: unknown = JSON.parse(run(root, 'npm', ['view', `${name}@${tag}`, 'dist-tags', '--json', '--prefer-online', ...registryArgs]))
    if (!tags || typeof tags !== 'object' || Array.isArray(tags)) throw new Error(`Invalid channel response for ${name}`)
    const current = (tags as Record<string, unknown>)[tag]
    if (current === undefined) return undefined
    if (typeof current === 'string' && semver.valid(current) === current) return current
    throw new Error(`Invalid npm ${tag} channel for ${name}`)
  } catch (error) {
    if (isRegistryNotFound(error)) return undefined
    throw error
  }
}

async function downloadable(root: string, artifact: ReleaseArtifact, run: Run): Promise<boolean> {
  const directory = await mkdtemp(path.join(tmpdir(), 'kysera-registry-check-'))
  try {
    const packed: unknown = JSON.parse(run(root, 'npm', ['pack', `${artifact.name}@${artifact.version}`, '--ignore-scripts',
      '--json', '--prefer-online', '--pack-destination', directory, '--cache', path.join(directory, 'cache'), ...registryArgs]))
    const entry: unknown = Array.isArray(packed) ? packed[0] : undefined
    const filename = entry && typeof entry === 'object' && 'filename' in entry ? entry.filename : undefined
    if (typeof filename !== 'string' || path.basename(filename) !== filename || !filename.endsWith('.tgz') ||
        archiveIntegrity(await readFile(path.join(directory, filename))) !== artifact.integrity)
      throw new Error(`Downloaded npm archive differs from the prepared ${artifact.name}@${artifact.version}`)
    return true
  } catch (error) {
    if (isRegistryNotFound(error)) return false
    throw error
  } finally { await rm(directory, { recursive: true, force: true }) }
}

/** A registry reservation can precede public metadata and the downloadable tarball by minutes. */
export async function publishReleaseArtifact(root: string, artifact: ReleaseArtifact, options: PublicationOptions = {}): Promise<void> {
  const run = options.run ?? command
  const timeout = options.confirmationTimeoutMs ?? 30 * 60_000
  const interval = options.confirmationIntervalMs ?? 15_000
  if (!Number.isSafeInteger(timeout) || timeout < 0 || !Number.isSafeInteger(interval) || interval < 1)
    throw new Error('Invalid publication confirmation interval')
  const { name, version, integrity, commit } = artifact
  const tag = semver.prerelease(version) ? 'next' : 'latest'
  await verifyArtifact(artifact)
  const marker = artifact.file + '.publication.json'
  let pending = false
  try {
    const saved = JSON.parse(await readFile(marker, 'utf8')) as Record<string, unknown> | null
    if (saved?.['registry'] !== npmRegistry || saved['name'] !== name || saved['version'] !== version || saved['commit'] !== commit || saved['integrity'] !== integrity)
      throw new Error(`Invalid saved publication receipt for ${name}`)
    pending = true
  } catch (error) { if (!missing(error)) throw error }
  if (!pending && !registryArtifactMatches(root, artifact, run)) {
    const current = channelVersion(root, name, tag, run)
    if (current && semver.gt(current, version)) throw new Error(`Publishing ${name}@${version} would move ${tag} backwards from ${current}`)
    let otp: string | undefined
    for (let attempt = 1; ; attempt++) {
      options.progress?.(`Publishing ${name}@${version} (${tag}, attempt ${attempt})`)
      try {
        run(root, 'npm', ['publish', artifact.file, '--json', '--access', 'public', '--ignore-scripts', '--tag', tag,
          ...(options.provenance ? ['--provenance'] : []), ...registryArgs], otp ? { ...process.env, npm_config_otp: otp } : undefined)
      } catch (error) {
        const code = registryErrorCode(error)
        if (code === 'EOTP' && options.otp && attempt < 3) {
          otp = await options.otp()
          if (!/^\d{6,8}$/.test(otp)) throw new Error('Invalid one-time password', { cause: error })
          continue
        }
        if (code !== 'E409' && code !== 'EPUBLISHCONFLICT' && !registryArtifactMatches(root, artifact, run)) throw error
      }
      await writeFile(marker + '.next', JSON.stringify({ registry: npmRegistry, name, version, commit, integrity }), { mode: 0o600, flush: true })
      await rename(marker + '.next', marker)
      break
    }
  }
  const deadline = Date.now() + timeout
  let downloaded = false, nextNotice = 0, waitingFor = 'version metadata'
  for (;;) {
    if (!downloaded && registryArtifactMatches(root, artifact, run)) {
      waitingFor = 'downloadable tarball'
      downloaded = await downloadable(root, artifact, run)
    }
    if (downloaded) {
      const current = channelVersion(root, name, tag, run)
      if (current && semver.gte(current, version)) return
      waitingFor = `${tag} channel (currently ${current ?? 'unset'})`
    }
    const now = Date.now(), remaining = deadline - now
    if (remaining <= 0) throw new Error(`Registry confirmation pending for ${name}@${version} (${waitingFor}). Resume the same version to continue checking.`)
    if (now >= nextNotice) {
      options.progress?.(`Waiting for ${name}@${version}: ${waitingFor} (${Math.ceil(remaining / 60_000)} min remaining)`)
      nextNotice = now + 60_000
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(interval, remaining)))
  }
}

/** Pack once after tagging; resumes use these same bytes, even if a rebuild is nondeterministic. */
export async function stageReleaseArtifact(
  root: string,
  pkg: { name: string; path: string },
  version: string,
  run: Run = command
): Promise<ReleaseArtifact> {
  releaseTag(version)
  if (!/^@kysera\/[a-z0-9-]+$/.test(pkg.name)) throw new Error(`Unexpected release package: ${pkg.name}`)
  const commit = run(root, 'git', ['rev-parse', 'HEAD'])
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid release commit')
  const directory = path.join(root, '.release-artifacts', version, commit)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const base = pkg.name.slice('@kysera/'.length)
  const file = path.join(directory, base + '.tgz')
  const record = path.join(directory, base + '.json')
  let savedText: string | undefined
  try { savedText = await readFile(record, 'utf8') } catch (error) { if (!missing(error)) throw error }
  if (savedText !== undefined) {
    const saved = JSON.parse(savedText) as Omit<ReleaseArtifact, 'schema'> & { schema: number }
    if (saved.schema !== 1 || saved.commit !== commit || saved.name !== pkg.name || saved.version !== version || saved.file !== base + '.tgz' ||
        typeof saved.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(saved.integrity))
      throw new Error(`Invalid cached release identity: ${record}`)
    const verified: ReleaseArtifact = { ...saved, schema: 1, file }
    await verifyArtifact(verified)
    return verified
  }

  const temporary = await mkdtemp(path.join(directory, '.pack-'))
  try {
    run(pkg.path, 'pnpm', ['--config.ignore-scripts=true', 'pack', '--pack-destination', temporary])
    const archives = (await readdir(temporary)).filter(name => name.endsWith('.tgz'))
    const archiveName = archives[0]
    if (archives.length !== 1 || !archiveName) throw new Error(`Expected one archive for ${pkg.name}`)
    const packed = path.join(temporary, archiveName)
    const manifest = JSON.parse(run(root, 'tar', ['-xOf', packed, 'package/package.json'])) as Record<string, unknown>
    if (manifest['name'] !== pkg.name || manifest['version'] !== version || manifest['private'])
      throw new Error(`Packed identity differs from ${pkg.name}@${version}`)
    for (const key of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      if (Object.values((manifest[key] ?? {}) as Record<string, unknown>).some(value => typeof value !== 'string' || /^(workspace:|file:|link:)/.test(value)))
        throw new Error(`Packed ${pkg.name} contains unpublished local ${key}`)
    }
    const entries = new Set(run(root, 'tar', ['-tzf', packed]).split('\n'))
    const targets = (value: unknown): string[] => typeof value === 'string' ? [value]
      : value && typeof value === 'object' ? Object.values(value).flatMap(targets) : []
    for (const target of [manifest['main'], manifest['types'], manifest['bin'], manifest['exports']].flatMap(targets)) {
      if (target.startsWith('#') || target.includes('*')) continue
      if (!entries.has('package/' + target.replace(/^\.\//, '')))
        throw new Error(`Packed ${pkg.name} is missing exported entry: ${target}`)
    }
    const artifact: ReleaseArtifact = { schema: 1, commit, name: pkg.name, version, file, integrity: archiveIntegrity(await readFile(packed)) }
    // Never overwrite an earlier attempt's archive with different bytes.
    try {
      if (archiveIntegrity(await readFile(file)) !== artifact.integrity) throw new Error(`Incomplete release archive conflicts: ${file}`)
    } catch (error) { if (!missing(error)) throw error }
    await chmod(packed, 0o444)
    await rename(packed, file)
    const journal = path.join(temporary, 'record.json')
    await writeFile(journal, JSON.stringify({ ...artifact, file: path.basename(file) }, null, 2) + '\n', { mode: 0o600 })
    await rename(journal, record)
    return artifact
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

/** One writer per checkout. A killed release leaves an inspectable lock; no PID-based stealing. */
export async function acquireReleaseLock(root: string): Promise<() => Promise<void>> {
  const dir = path.join(root, '.release-artifacts')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const lock = path.join(dir, 'running')
  try { await mkdir(lock, { mode: 0o700 }) }
  catch (error) { throw new Error(`Release is locked: ${lock}. Inspect the previous process before removing this lock.`, { cause: error }) }
  try { await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 }) }
  catch (error) { await rm(lock, { recursive: true, force: true }); throw error }
  return () => rm(lock, { recursive: true, force: true })
}
