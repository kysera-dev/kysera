import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile, rename, rm, chmod } from 'node:fs/promises'
import path from 'node:path'
import { command, releaseTag, isRegistryNotFound } from './release-safety.js'

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

/** An npm version is reusable only if its complete immutable archive matches. */
export function registryArtifactMatches(
  root: string, artifact: ReleaseArtifact, run: Run = command
): boolean {
  let data: unknown
  try {
    data = JSON.parse(run(root, 'npm', ['view', `${artifact.name}@${artifact.version}`, '--json']))
  } catch (error) {
    if (isRegistryNotFound(error)) return false
    throw new Error(`Cannot verify ${artifact.name}@${artifact.version}; publication was not attempted`, { cause: error })
  }
  if (!data || typeof data !== 'object' || !('version' in data) || data.version !== artifact.version ||
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
