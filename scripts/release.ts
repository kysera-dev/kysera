#!/usr/bin/env tsx

/**
 * Unified release script for Kysera monorepo
 *
 * This script handles:
 * - Version synchronization across all packages
 * - Changelog generation — aggregates ALL commits since the last release tag,
 *   grouped by conventional-commit type/scope, with breaking-change detection
 *   (`type!:` marker and `BREAKING CHANGE:` footers) and dedupe against
 *   entries already present in CHANGELOG.md
 * - Building and testing
 * - Publishing to npm (idempotent: already-published versions are skipped;
 *   prereleases go to the `next` dist-tag)
 * - Git tagging and GitHub releases (commit + tag happen BEFORE publish so a
 *   failed publish never leaves npm ahead of git)
 *
 * Options:
 * --list-packages, --list  List all packages with relative paths and exit
 * --version <x.y.z>        Release as the given version (skips the prompt)
 * --skip-tests             Skip running tests
 * --skip-build             Skip building packages
 * --skip-publish           Skip publishing to npm
 * --dry-run                Simulate release without modifying anything
 * --force                  Allow a non-primary branch or older version; tree must stay clean
 * --yes                    Accept release/push prompts (requires --version)
 * --github-release         Create the GitHub Release after a successful push
 * --github-only            Finish GitHub for an existing remote tag; never publish npm
 * --provenance             Publish with npm provenance attestation. Also
 *                          auto-enabled only when GitHub Actions OIDC is available.
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { glob } from 'glob'
import { prism, select, text, confirm } from '@xec-sh/kit'
import semver from 'semver'
import {
  command,
  releaseTag,
  assertReleaseHead,
  verifyRemoteTag,
  pushReleaseRefs,
  createGithubRelease,
  localReleaseCommit
} from './release-safety.js'
import { stageReleaseArtifact, registryArtifactMatches, verifyArtifact, acquireReleaseLock, type ReleaseArtifact } from './release-artifacts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const REPO_URL = 'https://github.com/kysera-dev/kysera'
const CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG.md')

const CHANGELOG_HEADER = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`

interface Package {
  name: string
  version: string
  path: string
  private: boolean
}

interface ReleaseOptions {
  version?: string
  skipTests?: boolean
  skipBuild?: boolean
  skipPublish?: boolean
  dryRun?: boolean
  force?: boolean
  listPackages?: boolean
  provenance?: boolean
  yes?: boolean
  githubRelease?: boolean
  githubOnly?: boolean
}

/**
 * Extract a printable message from an unknown thrown value
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Execute command with proper error handling
 */
function exec(cmd: string, options: { cwd?: string; silent?: boolean } = {}): string {
  const { cwd = ROOT_DIR, silent = false } = options

  try {
    // Typed as string (encoding set), but with stdio 'inherit' Node actually
    // returns null — the annotation reflects the runtime, not the lib types.
    const result = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit'
    }) as string | null
    return result?.trim() ?? ''
  } catch (error) {
    if (!silent) {
      console.error(prism.red(`❌ Command failed: ${cmd}`))
      console.error(errorMessage(error))
    }
    throw error
  }
}

/**
 * Get all packages in the monorepo
 */
async function getAllPackages(): Promise<Package[]> {
  const packages: Package[] = []

  // Get package.json files only from workspace directories
  // Use explicit patterns to avoid finding packages outside workspace
  const packagePaths = await glob('{packages,apps,examples}/*/package.json', {
    cwd: ROOT_DIR,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.test-*/**', '**/test-*/**']
  })

  for (const pkgPath of packagePaths) {
    const fullPath = path.join(ROOT_DIR, pkgPath)
    const packageDir = path.dirname(fullPath)

    try {
      const content = await fs.readFile(fullPath, 'utf-8')
      const pkg = JSON.parse(content) as {
        name?: string
        version?: string
        private?: boolean
      }

      // Skip packages without a name
      if (!pkg.name) {
        continue
      }

      // Skip root package.json
      if (packageDir === ROOT_DIR) {
        continue
      }

      // Only include packages that belong to @kysera scope or examples
      if (!pkg.name.startsWith('@kysera/') && !packageDir.includes('/examples/')) {
        continue
      }

      packages.push({
        name: pkg.name,
        version: pkg.version ?? '0.0.0',
        path: packageDir,
        private: pkg.private ?? false
      })
    } catch (error) {
      throw new Error(`Cannot read workspace manifest ${pkgPath}`, { cause: error })
    }
  }

  return packages
}

/**
 * List all packages with their relative paths
 */
async function listPackages(): Promise<void> {
  const packages = await getAllPackages()

  console.log(prism.bold(prism.cyan('\n📦 Kysera Monorepo Packages\n')))

  const publishable = packages.filter(pkg => !pkg.private)
  const private_pkgs = packages.filter(pkg => pkg.private)

  if (publishable.length > 0) {
    console.log(prism.bold(prism.green(`Publishable packages (${publishable.length}):\n`)))
    for (const pkg of publishable) {
      const relativePath = path.relative(ROOT_DIR, pkg.path)
      console.log(`  ${prism.cyan(pkg.name.padEnd(30))} ${prism.gray(relativePath)}`)
    }
  }

  if (private_pkgs.length > 0) {
    console.log(prism.bold(prism.yellow(`\nPrivate packages (${private_pkgs.length}):\n`)))
    for (const pkg of private_pkgs) {
      const relativePath = path.relative(ROOT_DIR, pkg.path)
      console.log(`  ${prism.yellow(pkg.name.padEnd(30))} ${prism.gray(relativePath)}`)
    }
  }

  console.log(prism.gray(`\nTotal: ${packages.length} packages\n`))
}

/**
 * Get current version from root package.json
 */
async function getCurrentVersion(): Promise<string> {
  const rootPkg = JSON.parse(await fs.readFile(path.join(ROOT_DIR, 'package.json'), 'utf-8')) as {
    version: string
  }
  return rootPkg.version
}

/**
 * Update version in package.json
 */
async function updatePackageVersion(packagePath: string, version: string): Promise<void> {
  const pkgJsonPath = path.join(packagePath, 'package.json')
  const content = await fs.readFile(pkgJsonPath, 'utf-8')
  const pkg = JSON.parse(content) as Record<string, unknown> & {
    version?: string
  }

  pkg.version = version

  // Update workspace dependencies to use the new version
  const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
  for (const field of depFields) {
    const deps = pkg[field] as Record<string, string> | undefined
    if (deps) {
      for (const [depName, depVersion] of Object.entries(deps)) {
        if (depName.startsWith('@kysera/') && depVersion.startsWith('workspace:')) {
          // Keep workspace protocol (pnpm rewrites it at pack time)
          continue
        } else if (depName.startsWith('@kysera/')) {
          // Update to new version
          deps[depName] = `^${version}`
        }
      }
    }
  }

  await fs.writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n')
}

/**
 * Check git status
 */
function checkGitStatus(options: ReleaseOptions): void {
  const status = exec('git status --porcelain', { silent: true })

  if (status && !options.dryRun) {
    console.error(prism.red('❌ Working directory is not clean:'))
    console.error(status)
    throw new Error('Please commit or stash your changes')
  }

  const branch = exec('git branch --show-current', { silent: true })
  if (branch !== 'main' && branch !== 'master' && !options.force) {
    throw new Error(`Must be on main branch (currently on ${branch})`)
  }
}

// ============================================================================
// Changelog generation
// ============================================================================

interface ParsedCommit {
  hash: string
  /** Full original subject line (used for dedupe against CHANGELOG.md) */
  rawSubject: string
  /** Conventional type, normalized ('other' when non-conventional/unknown) */
  type: string
  scope: string | null
  subject: string
  breaking: boolean
  /** First line of a `BREAKING CHANGE:` body footer, if present */
  breakingNote: string | null
}

const CONVENTIONAL_COMMIT_RE = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/
const KNOWN_TYPES = new Set([
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'test',
  'build',
  'ci',
  'chore',
  'style',
  'revert'
])

const COMMIT_SECTIONS: readonly { types: readonly string[]; title: string }[] = [
  { types: ['feat'], title: '### ✨ Features' },
  { types: ['fix'], title: '### 🐛 Bug Fixes' },
  { types: ['perf'], title: '### ⚡ Performance' },
  { types: ['refactor'], title: '### ♻️ Refactoring' },
  { types: ['docs'], title: '### 📚 Documentation' },
  { types: ['test'], title: '### 🧪 Tests' },
  { types: ['build', 'ci', 'chore', 'style', 'revert'], title: '### 🔧 Maintenance' },
  { types: ['other'], title: '### 📝 Other Changes' }
]

/**
 * Find the tag the changelog should aggregate from.
 *
 * Uses the HIGHEST semver `v*` tag rather than `git describe` — describe
 * walks topology from HEAD and silently picks whatever tag is nearest,
 * which breaks when a tag was ever placed on the wrong commit.
 * When releasing a stable version, prerelease tags are ignored so the
 * final notes cover the whole rc/beta period.
 */
export function findBaseTag(newVersion: string, root = ROOT_DIR): string | null {
  const tagOutput = command(root, 'git', ['tag', '--merged', 'HEAD', '--list', 'v*'])

  const releasingStable = semver.prerelease(newVersion) === null
  const candidates = tagOutput
    .split('\n')
    .map(tag => ({ tag: tag.trim(), version: semver.clean(tag.trim()) }))
    .filter((entry): entry is { tag: string; version: string } => entry.version !== null)
    .filter(entry => semver.lt(entry.version, newVersion))
    .filter(entry => !releasingStable || semver.prerelease(entry.version) === null)
    .sort((a, b) => semver.rcompare(a.version, b.version))

  return candidates[0]?.tag ?? null
}

/**
 * Read and parse all commits in `baseTag..HEAD` (full history when null).
 * Merge commits and `chore(release)` commits are excluded.
 */
export function readCommitsSince(baseTag: string | null, root = ROOT_DIR): ParsedCommit[] {
  const range = baseTag ? `${baseTag}..HEAD` : 'HEAD'
  const raw = command(root, 'git', ['log', range, '--format=%H%x1f%s%x1f%b%x1e'])

  const commits: ParsedCommit[] = []

  for (const record of raw.split('\x1e')) {
    const [hashField, subjectField, bodyField = ''] = record.split('\x1f')
    const hash = hashField?.trim() ?? ''
    const rawSubject = subjectField?.trim() ?? ''
    if (!hash || !rawSubject) continue
    if (rawSubject.startsWith('Merge ')) continue
    if (rawSubject.startsWith('chore(release)')) continue

    const match = CONVENTIONAL_COMMIT_RE.exec(rawSubject)
    let type = 'other'
    let scope: string | null = null
    let subject = rawSubject
    if (match) {
      const parsedType = (match[1] ?? '').toLowerCase()
      if (KNOWN_TYPES.has(parsedType)) {
        type = parsedType
      }
      // Empty-after-trim intentionally collapses to the fallback
      const trimmedScope = match[2]?.trim() ?? ''
      scope = trimmedScope === '' ? null : trimmedScope
      const trimmedSubject = match[4]?.trim() ?? ''
      subject = trimmedSubject === '' ? rawSubject : trimmedSubject
    }

    const bodyBreak = /^BREAKING[ -]CHANGES?:?[ \t]*(.*)$/m.exec(bodyField)
    const trimmedNote = bodyBreak?.[1]?.trim() ?? ''
    const breakingNote = trimmedNote === '' ? null : trimmedNote

    commits.push({
      hash,
      rawSubject,
      type,
      scope,
      subject,
      breaking: Boolean(match?.[3]) || bodyBreak !== null,
      breakingNote
    })
  }

  return commits
}

/**
 * Publishable packages that changed since the base tag
 */
export function collectAffectedPackages(baseTag: string | null, packages: Package[], root = ROOT_DIR): string[] {
  if (!baseTag) return packages.filter(pkg => !pkg.private).map(pkg => pkg.name.replace('@kysera/', '')).sort()
  const changed = command(root, 'git', ['diff', '--name-only', `${baseTag}..HEAD`])

  const files = changed.split('\n').filter(Boolean)
  const affected = new Set<string>()
  for (const pkg of packages) {
    if (pkg.private) continue
    const rel = path.relative(root, pkg.path) + '/'
    if (files.some(file => file.startsWith(rel))) {
      affected.add(pkg.name.replace('@kysera/', ''))
    }
  }

  return [...affected].sort()
}

function formatCommitLine(commit: ParsedCommit): string {
  const scopePrefix = commit.scope ? `**${commit.scope}:** ` : ''
  return `- ${scopePrefix}${commit.subject} (${commit.hash.slice(0, 7)})`
}

/** Cluster same-scope entries together; unscoped entries go last */
function sortByScope(commits: ParsedCommit[]): ParsedCommit[] {
  return [...commits].sort((a, b) => {
    if (a.scope === b.scope) return 0
    if (a.scope === null) return 1
    if (b.scope === null) return -1
    return a.scope.localeCompare(b.scope)
  })
}

export async function readExistingChangelog(file = CHANGELOG_PATH): Promise<string> {
  try {
    return await fs.readFile(file, 'utf-8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
    throw error
  }
}

/**
 * Generate the changelog entry for a release: every commit since the last
 * release tag, deduplicated against commit hashes already present in
 * CHANGELOG.md (protects against misplaced historical tags re-surfacing
 * already-released commits).
 */
async function generateChangelog(version: string, packages: Package[]): Promise<string> {
  const date = new Date().toISOString().split('T')[0]
  const baseTag = findBaseTag(version)
  const existing = await readExistingChangelog()

  const commits = readCommitsSince(baseTag).filter(commit => !existing.includes(`(${commit.hash.slice(0, 7)})`))

  let changelog = `## [${version}] - ${date}\n\n`

  const headerParts: string[] = []
  const affected = collectAffectedPackages(baseTag, packages)
  if (affected.length > 0) {
    headerParts.push(`Packages: ${affected.join(', ')}`)
  }
  if (baseTag) {
    headerParts.push(`[${baseTag}...v${version}](${REPO_URL}/compare/${baseTag}...v${version})`)
  }
  if (headerParts.length > 0) {
    changelog += `_${headerParts.join(' · ')}_\n\n`
  }

  const breaking = commits.filter(commit => commit.breaking)
  if (breaking.length > 0) {
    changelog += '### ⚠️ BREAKING CHANGES\n\n'
    for (const commit of sortByScope(breaking)) {
      changelog += `${formatCommitLine(commit)}\n`
      if (commit.breakingNote) {
        changelog += `  - ${commit.breakingNote}\n`
      }
    }
    changelog += '\n'
  }

  for (const section of COMMIT_SECTIONS) {
    const items = commits.filter(commit => section.types.includes(commit.type))
    if (items.length === 0) continue

    changelog += `${section.title}\n\n`
    for (const commit of sortByScope(items)) {
      changelog += `${formatCommitLine(commit)}\n`
    }
    changelog += '\n'
  }

  if (commits.length === 0) {
    changelog += '- No user-facing changes recorded.\n'
  }

  return changelog.trimEnd() + '\n'
}

/**
 * Insert a generated entry at the top of CHANGELOG.md
 */
async function updateChangelog(entry: string): Promise<void> {
  let existingContent = await readExistingChangelog()
  if (!existingContent) {
    existingContent = CHANGELOG_HEADER
  }

  const lines = existingContent.split('\n')
  const insertIndex = lines.findIndex(line => line.startsWith('## ['))

  if (insertIndex > 0) {
    lines.splice(insertIndex, 0, entry)
  } else {
    lines.push(entry)
  }

  await fs.writeFile(CHANGELOG_PATH, lines.join('\n'))
}

/**
 * Prompt for version
 */
async function promptVersion(currentVersion: string): Promise<string> {
  const versionType = await select({
    message: `Current version is ${currentVersion}. Select version type:`,
    options: [
      { label: `Patch (${semver.inc(currentVersion, 'patch')})`, value: 'patch' },
      { label: `Minor (${semver.inc(currentVersion, 'minor')})`, value: 'minor' },
      { label: `Major (${semver.inc(currentVersion, 'major')})`, value: 'major' },
      { label: 'Prerelease', value: 'prerelease' },
      { label: 'Custom', value: 'custom' }
    ]
  })

  let newVersion: string

  if (versionType === 'custom') {
    const customVersion = await text({
      message: 'Enter custom version:',
      validate: value => {
        if (!semver.valid(value)) {
          return 'Invalid version format'
        }
        return undefined
      }
    })
    newVersion = customVersion as string
  } else if (versionType === 'prerelease') {
    const prereleaseId = await select({
      message: 'Select prerelease type:',
      options: [
        { label: 'Alpha', value: 'alpha' },
        { label: 'Beta', value: 'beta' },
        { label: 'RC', value: 'rc' }
      ]
    })
    // select() may resolve to a cancel symbol — accept only the known ids
    if (typeof prereleaseId !== 'string') {
      throw new Error('Release cancelled')
    }
    newVersion = semver.inc(currentVersion, 'prerelease', prereleaseId) ?? currentVersion
  } else {
    newVersion = semver.inc(currentVersion, versionType as semver.ReleaseType) ?? currentVersion
  }

  return newVersion
}

/**
 * Build all packages
 */
function buildPackages(): void {
  console.log(prism.cyan('🔨 Building packages...'))
  exec('pnpm build')
  console.log(prism.green('✅ Build completed'))
}

/**
 * Run tests
 */
function runTests(): void {
  console.log(prism.cyan('🧪 Running tests...'))
  exec('pnpm test')
  console.log(prism.green('✅ Tests passed'))
}

/**
 * Check whether a version is already on the registry (makes re-runs after a
 * partial publish idempotent)
 */

/**
 * Order packages so dependencies publish before dependents — a mid-run
 * failure then never leaves a package on npm whose @kysera deps are absent.
 * (glob() directory order is not guaranteed; a live run once tried
 * @kysera/cli first.)
 */
export async function sortByDependencyOrder(packages: Package[]): Promise<Package[]> {
  const names = new Set(packages.map(pkg => pkg.name))
  const depsByName = new Map<string, Set<string>>()

  for (const pkg of packages) {
    const manifest = JSON.parse(
      await fs.readFile(path.join(pkg.path, 'package.json'), 'utf-8')
    ) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    const all = {
      ...manifest.dependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies
    }
    depsByName.set(pkg.name, new Set(Object.keys(all).filter(dep => names.has(dep))))
  }

  const ordered: Package[] = []
  const placed = new Set<string>()
  const remaining = [...packages].sort((a, b) => a.name.localeCompare(b.name))

  while (remaining.length > 0) {
    const readyIndex = remaining.findIndex(pkg =>
      [...(depsByName.get(pkg.name) ?? [])].every(dep => placed.has(dep))
    )
    if (readyIndex < 0)
      throw new Error(
        `Cannot release a dependency cycle: ${remaining.map(pkg => pkg.name).join(', ')}`
      )
    const [next] = remaining.splice(readyIndex, 1)
    if (next) {
      ordered.push(next)
      placed.add(next.name)
    }
  }

  return ordered
}

/**
 * Publish packages to npm
 */
async function prepareArtifacts(packages: Package[], version: string): Promise<ReleaseArtifact[]> {
  const artifacts: ReleaseArtifact[] = []
  for (const pkg of await sortByDependencyOrder(packages.filter(pkg => !pkg.private)))
    artifacts.push(await stageReleaseArtifact(ROOT_DIR, pkg, version))
  // A conflict in the last package must fail before publishing the first one.
  for (const artifact of artifacts) registryArtifactMatches(ROOT_DIR, artifact)
  if (command(ROOT_DIR, 'git', ['status', '--porcelain']))
    throw new Error('Packing changed the release tree; publication was not attempted')
  return artifacts
}

async function publishPackages(artifacts: ReleaseArtifact[], version: string, options: ReleaseOptions): Promise<void> {
  const oidc = process.env['GITHUB_ACTIONS'] === 'true' && process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] && process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']
  for (const artifact of artifacts) {
    await verifyArtifact(artifact)
    if (registryArtifactMatches(ROOT_DIR, artifact)) {
      console.log(prism.gray(`  ${artifact.name}@${version}: npm archive verified, skipping`))
      continue
    }
    // Publish the archive that was checked; lifecycle scripts cannot rebuild or repack it.
    command(ROOT_DIR, 'npm', ['publish', artifact.file, '--access', 'public', '--ignore-scripts',
      '--tag', semver.prerelease(version) ? 'next' : 'latest',
      ...(options.provenance || oidc ? ['--provenance'] : [])])
    let verified = false
    for (let attempt = 0; attempt < 4; attempt++) {
      if (registryArtifactMatches(ROOT_DIR, artifact)) { verified = true; break }
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    if (!verified) throw new Error(`Published ${artifact.name}, but npm visibility is unconfirmed; resume this same version`)
    console.log(prism.green(`  ${artifact.name}@${version}: published and verified`))
  }
}

/**
 * Commit release changes and create the tag.
 *
 * Runs BEFORE publish: if this step fails, nothing has reached npm yet.
 * The tag must land on the release commit — v0.8.8's tag ended up on the
 * wrong commit precisely because tagging wasn't tied to a verified commit.
 */
function commitAndTag(version: string, options: ReleaseOptions, releaseFiles: string[]): void {
  if (options.dryRun) {
    console.log(prism.yellow(`\n[DRY RUN] Would commit and tag v${version}`))
    return
  }

  console.log(prism.cyan(`\n🏷️  Committing and tagging v${version}...`))

  assertReleaseHead(ROOT_DIR, version)
  const changed = command(ROOT_DIR, 'git', ['diff', '--name-only']).split('\n').filter(Boolean)
  const unexpected = changed.filter(file => !releaseFiles.includes(file))
  if (unexpected.length)
    throw new Error(`Release changed unexpected files: ${unexpected.join(', ')}`)
  if (localReleaseCommit(ROOT_DIR, version) && changed.length)
    throw new Error(
      'A tagged release changed during preparation; refusing to publish a different tree under the same version'
    )
  command(ROOT_DIR, 'git', ['add', '--', ...releaseFiles])
  const staged = exec('git status --porcelain', { silent: true })
  if (staged) {
    exec(`git commit -m "chore(release): v${version}"`)
  } else {
    console.log(prism.gray('  Nothing to commit (release changes already committed)'))
  }

  const tagExists = (() => {
    try {
      exec(`git rev-parse -q --verify refs/tags/v${version}`, { silent: true })
      return true
    } catch {
      return false
    }
  })()

  if (tagExists) {
    assertReleaseHead(ROOT_DIR, version)
    console.log(prism.gray(`  Tag v${version} already exists at HEAD — verified`))
  } else {
    exec(`git tag -a v${version} -m "Release v${version}"`)
  }

  console.log(prism.green(`✅ Tagged v${version}`))
}

/**
 * Push commits and tags to the remote
 */
async function pushRelease(version: string, options: ReleaseOptions): Promise<boolean> {
  if (options.dryRun) {
    console.log(
      prism.yellow(`[DRY RUN] Would atomically push the current branch and v${version} only`)
    )
    return false
  }

  const shouldPush =
    options.yes === true
      ? true
      : await confirm({
          message: `Push the current branch and v${version} to origin?`,
          initialValue: true
        })

  if (shouldPush !== true) return false
  pushReleaseRefs(ROOT_DIR, version)
  console.log(prism.green('✅ Pushed release branch and current tag'))
  return true
}

/**
 * Parse CLI arguments
 */
export function parseArgs(args: string[]): ReleaseOptions {
  const flags = new Set([
    '--skip-tests',
    '--skip-build',
    '--skip-publish',
    '--dry-run',
    '--force',
    '--list-packages',
    '--list',
    '--provenance',
    '--yes',
    '--github-release',
    '--github-only'
  ])
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg) throw new Error('Empty release argument')
    if (arg === '--version') {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error('--version requires a value')
      continue
    }
    if (!flags.has(arg) && !arg.startsWith('--version='))
      throw new Error(`Unknown release option: ${arg}`)
  }
  if (args.filter(arg => arg === '--version' || arg.startsWith('--version=')).length > 1)
    throw new Error('Specify --version once')
  const options: ReleaseOptions = {
    skipTests: args.includes('--skip-tests'),
    skipBuild: args.includes('--skip-build'),
    skipPublish: args.includes('--skip-publish'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    listPackages: args.includes('--list-packages') || args.includes('--list'),
    provenance: args.includes('--provenance'),
    yes: args.includes('--yes'),
    githubRelease: args.includes('--github-release'),
    githubOnly: args.includes('--github-only')
  }

  const versionFlagIndex = args.indexOf('--version')
  const flagValue = versionFlagIndex !== -1 ? args[versionFlagIndex + 1] : undefined
  if (flagValue) {
    options.version = flagValue
  }
  const eqValue = args.find(arg => arg.startsWith('--version='))?.slice('--version='.length)
  if (eqValue) {
    options.version = eqValue
  }
  if (args.some(arg => arg === '--version=')) throw new Error('--version requires a value')
  if ((options.yes || options.githubOnly) && !options.version)
    throw new Error('--yes and --github-only require --version')
  if (options.version) releaseTag(options.version)

  return options
}

/**
 * Main release flow
 */
async function main(): Promise<void> {
  console.log(prism.bold(prism.cyan('\n🚀 Kysera Monorepo Release\n')))

  const options = parseArgs(process.argv.slice(2))

  if (options.githubOnly) {
    const version = options.version
    if (!version) throw new Error('--github-only requires --version')
    if (!localReleaseCommit(ROOT_DIR, version))
      throw new Error('The selected release tag is missing locally')
    if (options.dryRun) {
      console.log(
        `[DRY RUN] Would verify remote v${version} and create its missing GitHub Release; npm and working files remain untouched`
      )
      return
    }
    if (
      !options.yes &&
      (await confirm({
        message: `Finish GitHub Release v${version} without publishing npm?`,
        initialValue: true
      })) !== true
    )
      return
    console.log(await createGithubRelease(ROOT_DIR, version, 'kysera-dev/kysera'))
    return
  }

  // Handle --list-packages flag
  if (options.listPackages) {
    await listPackages()
    return
  }

  const unlock = options.dryRun ? null : await acquireReleaseLock(ROOT_DIR)
  try {
    // 1. Check git status
    console.log(prism.cyan('📋 Checking environment...'))
    checkGitStatus(options)
    console.log(
      prism.green(
        options.dryRun ? '✅ Git state inspected (read-only plan)' : '✅ Git status clean'
      )
    )

    // 2. Get current version and packages
    const currentVersion = await getCurrentVersion()
    const packages = await getAllPackages()

    console.log(prism.gray(`Current version: ${currentVersion}`))
    console.log(prism.gray(`Found ${packages.length} packages`))

    // 3. Resolve new version (flag or prompt)
    const newVersion = options.version ?? (await promptVersion(currentVersion))

    releaseTag(newVersion)
    assertReleaseHead(ROOT_DIR, newVersion)
    await sortByDependencyOrder(packages.filter(pkg => !pkg.private))
    if (!options.dryRun) verifyRemoteTag(ROOT_DIR, newVersion)
    if (semver.eq(newVersion, currentVersion)) {
      // Resume mode: versions were already bumped by a previous run that
      // failed mid-publish. Everything downstream is idempotent (published
      // packages are skipped, existing tag/commit/changelog are kept).
      console.log(
        prism.yellow(`⚠️  Version ${newVersion} matches current — resuming interrupted release`)
      )
    } else if (!options.force && !semver.gt(newVersion, currentVersion)) {
      throw new Error(
        `Version ${newVersion} must be greater than current ${currentVersion} (use --force to override)`
      )
    }

    console.log(prism.bold(prism.green(`\n📦 Releasing version ${newVersion}\n`)))

    // 4. Generate changelog and show it BEFORE mutating anything.
    // On resume the entry already exists — keep it untouched.
    let changelogEntry: string | null = null
    if ((await readExistingChangelog()).includes(`## [${newVersion}]`)) {
      console.log(prism.gray(`📄 CHANGELOG.md already has a ${newVersion} entry — keeping it`))
    } else {
      changelogEntry = await generateChangelog(newVersion, packages)
      console.log(prism.bold(prism.cyan('📄 Changelog preview:\n')))
      console.log(changelogEntry)
    }

    if (!options.dryRun && !options.version && changelogEntry) {
      const proceed = await confirm({
        message: `Release v${newVersion} with the changelog above?`,
        initialValue: true
      })
      if (proceed !== true) {
        console.log(prism.yellow('Release cancelled'))
        return
      }
    }

    // 5. Update versions + changelog (skipped entirely in dry-run)
    if (options.dryRun) {
      console.log(prism.yellow('[DRY RUN] Skipping version and changelog writes'))
    } else {
      console.log(prism.cyan('📝 Updating package versions...'))

      await updatePackageVersion(ROOT_DIR, newVersion)
      for (const pkg of packages) {
        await updatePackageVersion(pkg.path, newVersion)
        console.log(prism.gray(`  Updated ${pkg.name} to ${newVersion}`))
      }
      console.log(prism.green('✅ Versions updated'))

      if (changelogEntry) {
        await updateChangelog(changelogEntry)
        console.log(prism.green('✅ Changelog updated'))
      }
    }

    // 6. Build packages
    if (!options.skipBuild && !options.dryRun) {
      buildPackages()
    }

    // 7. Run tests
    if (!options.skipTests && !options.dryRun) {
      runTests()
    }

    // 8. Commit + tag first — npm must never be ahead of git
    if (!options.dryRun) exec('pnpm install --lockfile-only --ignore-scripts')
    commitAndTag(newVersion, options, [
      'package.json',
      'CHANGELOG.md',
      'pnpm-lock.yaml',
      ...packages.map(pkg => path.relative(ROOT_DIR, path.join(pkg.path, 'package.json')))
    ])

    const artifacts = !options.dryRun && !options.skipPublish
      ? await prepareArtifacts(packages, newVersion) : []

    // Publish immutable Git refs before npm; a rejected push cannot leave npm ahead.
    const pushed = await pushRelease(newVersion, options)
    if (!options.skipPublish) {
      if (!pushed && !options.dryRun)
        throw new Error(
          'Release is prepared locally. Push its branch and tag before publishing npm; resume with the same --version'
        )
      if (options.dryRun) console.log('[DRY RUN] Would pack, verify npm archives and publish missing packages')
      else await publishPackages(artifacts, newVersion, options)
    }
    if (options.githubRelease && pushed)
      console.log(await createGithubRelease(ROOT_DIR, newVersion, 'kysera-dev/kysera'))

    // 11. Success!
    console.log(
      prism.bold(
        prism.green(
          options.dryRun
            ? '\nDry run completed; no release actions executed.\n'
            : pushed
              ? '\nRelease packages and Git refs completed.\n'
              : '\nLocal release prepared; remote Git push remains pending.\n'
        )
      )
    )
    if (!options.dryRun) {
      console.log(
        `npm: ${options.skipPublish ? 'skipped by request' : 'published or already present'}`
      )
      console.log(`Git refs: ${pushed ? 'pushed' : 'pending'}`)
      if (!options.githubRelease || !pushed)
        console.log(
          `Finish GitHub only: bun run ./scripts/release.ts --version ${newVersion} --github-only`
        )
    }
  } catch (error) {
    console.error(prism.red('\n❌ Release failed:'))
    console.error(errorMessage(error))
    process.exitCode = 1
  } finally { await unlock?.() }
}

// Importing planning helpers for tests must never start a release.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error: unknown) => {
    console.error(prism.red('Fatal error:'), errorMessage(error))
    process.exit(1)
  })
