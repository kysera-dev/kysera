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
 * --force                  Force release even with uncommitted changes
 * --provenance             Publish with npm provenance attestation. Also
 *                          auto-enabled when the CI env var is set (GitHub
 *                          Actions OIDC); local publishes stay unchanged.
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { glob } from 'glob'
import { prism, select, text, confirm } from '@xec-sh/kit'
import semver from 'semver'

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
    } catch {
      // Skip invalid package.json files
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
  const depFields = ['dependencies', 'devDependencies', 'peerDependencies']
  for (const field of depFields) {
    const deps = pkg[field] as Record<string, string> | undefined
    if (deps) {
      for (const [depName, depVersion] of Object.entries(deps)) {
        if (depName.startsWith('@kysera/') && depVersion === 'workspace:*') {
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

  if (status && !options.force) {
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
function findBaseTag(newVersion: string): string | null {
  let tagOutput = ''
  try {
    tagOutput = exec(`git tag --list 'v*'`, { silent: true })
  } catch {
    return null
  }

  const releasingStable = semver.prerelease(newVersion) === null
  const candidates = tagOutput
    .split('\n')
    .map(tag => ({ tag: tag.trim(), version: semver.clean(tag.trim()) }))
    .filter((entry): entry is { tag: string; version: string } => entry.version !== null)
    .filter(entry => !releasingStable || semver.prerelease(entry.version) === null)
    .sort((a, b) => semver.rcompare(a.version, b.version))

  return candidates[0]?.tag ?? null
}

/**
 * Read and parse all commits in `baseTag..HEAD` (full history when null).
 * Merge commits and `chore(release)` commits are excluded.
 */
function readCommitsSince(baseTag: string | null): ParsedCommit[] {
  const range = baseTag ? `${baseTag}..HEAD` : 'HEAD'
  let raw = ''
  try {
    // \x1f (unit sep) between fields, \x1e (record sep) between commits —
    // bodies are multi-line, so --oneline parsing would drop them
    raw = exec(`git log ${range} --format="%H%x1f%s%x1f%b%x1e"`, { silent: true })
  } catch {
    return []
  }

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
function collectAffectedPackages(baseTag: string | null, packages: Package[]): string[] {
  if (!baseTag) return []

  let changed = ''
  try {
    changed = exec(`git diff --name-only ${baseTag}..HEAD`, { silent: true })
  } catch {
    return []
  }

  const files = changed.split('\n').filter(Boolean)
  const affected = new Set<string>()
  for (const pkg of packages) {
    if (pkg.private) continue
    const rel = path.relative(ROOT_DIR, pkg.path) + '/'
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

async function readExistingChangelog(): Promise<string> {
  try {
    return await fs.readFile(CHANGELOG_PATH, 'utf-8')
  } catch {
    return ''
  }
}

/**
 * Generate the changelog entry for a release: every commit since the last
 * release tag, deduplicated against subjects already present in
 * CHANGELOG.md (protects against misplaced historical tags re-surfacing
 * already-released commits).
 */
async function generateChangelog(version: string, packages: Package[]): Promise<string> {
  const date = new Date().toISOString().split('T')[0]
  const baseTag = findBaseTag(version)
  const existing = await readExistingChangelog()

  const commits = readCommitsSince(baseTag).filter(commit => !existing.includes(commit.rawSubject))

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
function isAlreadyPublished(name: string, version: string): boolean {
  try {
    const result = exec(`npm view ${name}@${version} version`, { silent: true })
    return result === version
  } catch {
    return false
  }
}

/**
 * Order packages so dependencies publish before dependents — a mid-run
 * failure then never leaves a package on npm whose @kysera deps are absent.
 * (glob() directory order is not guaranteed; a live run once tried
 * @kysera/cli first.)
 */
async function sortByDependencyOrder(packages: Package[]): Promise<Package[]> {
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
    // readyIndex === -1 would mean a dependency cycle — emit head to make progress
    const [next] = remaining.splice(readyIndex === -1 ? 0 : readyIndex, 1)
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
async function publishPackages(
  packages: Package[],
  version: string,
  options: ReleaseOptions
): Promise<void> {
  const publishable = await sortByDependencyOrder(packages.filter(pkg => !pkg.private))
  // Never let a prerelease hijack the `latest` dist-tag
  const distTagArg = semver.prerelease(version) ? ' --tag next' : ''
  // Provenance attestation: opt-in locally (--provenance), automatic in CI
  const provenanceArg = options.provenance || process.env['CI'] ? ' --provenance' : ''

  console.log(prism.cyan(`\n📦 Publishing ${publishable.length} packages...`))

  for (const pkg of publishable) {
    if (options.dryRun) {
      console.log(prism.yellow(`  [DRY RUN] Would publish ${pkg.name}@${version}`))
      continue
    }

    if (isAlreadyPublished(pkg.name, version)) {
      console.log(prism.gray(`  ⏭  ${pkg.name}@${version} already on npm — skipping`))
      continue
    }

    console.log(prism.gray(`  Publishing ${pkg.name}@${version}...`))
    try {
      exec(`pnpm publish --access public --no-git-checks${distTagArg}${provenanceArg}`, {
        cwd: pkg.path
      })
      console.log(prism.green(`  ✅ ${pkg.name}@${version} published`))
    } catch (error) {
      console.error(prism.red(`  ❌ Failed to publish ${pkg.name}: ${errorMessage(error)}`))
      throw error
    }
  }
}

/**
 * Commit release changes and create the tag.
 *
 * Runs BEFORE publish: if this step fails, nothing has reached npm yet.
 * The tag must land on the release commit — v0.8.8's tag ended up on the
 * wrong commit precisely because tagging wasn't tied to a verified commit.
 */
function commitAndTag(version: string, options: ReleaseOptions): void {
  if (options.dryRun) {
    console.log(prism.yellow(`\n[DRY RUN] Would commit and tag v${version}`))
    return
  }

  console.log(prism.cyan(`\n🏷️  Committing and tagging v${version}...`))

  exec('git add -A')
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
    console.log(prism.gray(`  Tag v${version} already exists — skipping`))
  } else {
    exec(`git tag -a v${version} -m "Release v${version}"`)
  }

  console.log(prism.green(`✅ Tagged v${version}`))
}

/**
 * Push commits and tags to the remote
 */
async function pushRelease(options: ReleaseOptions): Promise<void> {
  if (options.dryRun) {
    console.log(prism.yellow('[DRY RUN] Would push to remote'))
    return
  }

  const shouldPush = await confirm({
    message: 'Push to remote?',
    initialValue: true
  })

  if (shouldPush) {
    exec('git push')
    exec('git push --tags')
    console.log(prism.green('✅ Pushed to remote'))
  }
}

/**
 * Parse CLI arguments
 */
function parseArgs(args: string[]): ReleaseOptions {
  const options: ReleaseOptions = {
    skipTests: args.includes('--skip-tests'),
    skipBuild: args.includes('--skip-build'),
    skipPublish: args.includes('--skip-publish'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    listPackages: args.includes('--list-packages') || args.includes('--list'),
    provenance: args.includes('--provenance')
  }

  const versionFlagIndex = args.indexOf('--version')
  const flagValue = versionFlagIndex !== -1 ? args[versionFlagIndex + 1] : undefined
  if (flagValue) {
    options.version = flagValue
  }
  const eqValue = args.find(arg => arg.startsWith('--version='))?.split('=')[1]
  if (eqValue) {
    options.version = eqValue
  }

  return options
}

/**
 * Main release flow
 */
async function main(): Promise<void> {
  console.log(prism.bold(prism.cyan('\n🚀 Kysera Monorepo Release\n')))

  const options = parseArgs(process.argv.slice(2))

  // Handle --list-packages flag
  if (options.listPackages) {
    await listPackages()
    return
  }

  try {
    // 1. Check git status
    console.log(prism.cyan('📋 Checking environment...'))
    checkGitStatus(options)
    console.log(prism.green('✅ Git status clean'))

    // 2. Get current version and packages
    const currentVersion = await getCurrentVersion()
    const packages = await getAllPackages()

    console.log(prism.gray(`Current version: ${currentVersion}`))
    console.log(prism.gray(`Found ${packages.length} packages`))

    // 3. Resolve new version (flag or prompt)
    const newVersion = options.version ?? (await promptVersion(currentVersion))

    if (!semver.valid(newVersion)) {
      throw new Error(`Invalid version: ${newVersion}`)
    }
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
      if (!proceed) {
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
    if (!options.skipBuild) {
      buildPackages()
    }

    // 7. Run tests
    if (!options.skipTests) {
      runTests()
    }

    // 8. Commit + tag first — npm must never be ahead of git
    commitAndTag(newVersion, options)

    // 9. Publish to npm
    if (!options.skipPublish) {
      await publishPackages(packages, newVersion, options)
    }

    // 10. Push commits and tags
    await pushRelease(options)

    // 11. Success!
    console.log(prism.bold(prism.green('\n✨ Release completed successfully!\n')))
    console.log(prism.cyan('Next steps:'))
    console.log(`  1. Create GitHub release: ${REPO_URL}/releases/new`)
    console.log(`  2. Use tag: v${newVersion}`)
    console.log('  3. Copy changelog entry for release notes')
    console.log('  4. Announce in Discord/Twitter')
  } catch (error) {
    console.error(prism.red('\n❌ Release failed:'))
    console.error(errorMessage(error))
    process.exit(1)
  }
}

// Run the script
main().catch((error: unknown) => {
  console.error(prism.red('Fatal error:'), errorMessage(error))
  process.exit(1)
})
