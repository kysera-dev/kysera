#!/usr/bin/env tsx

/**
 * Synchronize all package versions in the monorepo.
 *
 * Target version comes from argv (`tsx scripts/sync-versions.ts 0.9.1`) or,
 * when omitted, from the root package.json — never from a hardcoded string
 * (a stale constant here once made this script a downgrade foot-gun).
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { glob } from 'glob'
import { prism } from '@xec-sh/kit'
import semver from 'semver'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

interface PackageManifest {
  version?: string
  [key: string]: unknown
}

function isDependencyMap(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function resolveTargetVersion(): Promise<string> {
  const fromArgv = process.argv[2]
  if (fromArgv) {
    if (!semver.valid(fromArgv)) {
      throw new Error(`Invalid target version: ${fromArgv}`)
    }
    return fromArgv
  }

  const rootPkg = JSON.parse(
    await fs.readFile(path.join(ROOT_DIR, 'package.json'), 'utf-8')
  ) as PackageManifest
  if (!rootPkg.version || !semver.valid(rootPkg.version)) {
    throw new Error(`Root package.json has no valid version (got: ${String(rootPkg.version)})`)
  }
  return rootPkg.version
}

function syncDependencyRanges(pkg: PackageManifest, targetVersion: string): void {
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[field]
    if (!isDependencyMap(deps)) continue

    for (const [depName, depVersion] of Object.entries(deps)) {
      if (!depName.startsWith('@kysera/')) continue
      // Keep workspace protocol for local development
      if (depVersion === 'workspace:*' || depVersion === 'workspace:^') continue
      deps[depName] = `^${targetVersion}`
    }
  }
}

async function syncVersions(): Promise<void> {
  const targetVersion = await resolveTargetVersion()

  console.log(prism.bold(prism.cyan('\n📦 Synchronizing package versions...\n')))

  const packagePaths = await glob('**/package.json', {
    cwd: ROOT_DIR,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '.test-*/**']
  })

  console.log(prism.gray(`Found ${packagePaths.length} package.json files`))
  console.log(prism.gray(`Target version: ${targetVersion}\n`))

  for (const pkgPath of packagePaths) {
    const fullPath = path.join(ROOT_DIR, pkgPath)
    const relPath = path.relative(ROOT_DIR, fullPath)

    try {
      const content = await fs.readFile(fullPath, 'utf-8')
      const pkg = JSON.parse(content) as PackageManifest
      const oldVersion = pkg.version

      pkg.version = targetVersion
      syncDependencyRanges(pkg, targetVersion)

      await fs.writeFile(fullPath, JSON.stringify(pkg, null, 2) + '\n')

      if (oldVersion !== targetVersion) {
        console.log(prism.green(`✅ ${relPath}: ${oldVersion ?? '(none)'} → ${targetVersion}`))
      } else {
        console.log(prism.gray(`⏭️  ${relPath}: already at ${targetVersion}`))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(prism.red(`❌ Failed to update ${relPath}: ${message}`))
    }
  }

  console.log(prism.bold(prism.green('\n✨ Version synchronization complete!\n')))
}

// Run the script
syncVersions().catch((error: unknown) => {
  console.error(prism.red('Fatal error:'), error)
  process.exit(1)
})
