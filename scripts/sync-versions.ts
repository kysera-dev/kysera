#!/usr/bin/env tsx

/**
 * Synchronize all package versions in the monorepo
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { glob } from 'glob'
import chalk from 'chalk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const TARGET_VERSION = '0.3.0'

async function syncVersions() {
  console.log(chalk.bold.cyan('\n📦 Synchronizing package versions...\n'))

  // Get all package.json files
  const packagePaths = await glob('**/package.json', {
    cwd: ROOT_DIR,
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '.test-*/**'
    ]
  })

  console.log(chalk.gray(`Found ${packagePaths.length} package.json files`))
  console.log(chalk.gray(`Target version: ${TARGET_VERSION}\n`))

  for (const pkgPath of packagePaths) {
    const fullPath = path.join(ROOT_DIR, pkgPath)
    const relPath = path.relative(ROOT_DIR, fullPath)

    try {
      const content = await fs.readFile(fullPath, 'utf-8')
      const pkg = JSON.parse(content)
      const oldVersion = pkg.version

      // Update version
      pkg.version = TARGET_VERSION

      // Update @kysera/* dependencies to use the same version
      const depFields = ['dependencies', 'devDependencies', 'peerDependencies']

      for (const field of depFields) {
        if (pkg[field]) {
          for (const [depName, depVersion] of Object.entries(pkg[field])) {
            if (depName.startsWith('@kysera/')) {
              // Keep workspace protocol for local development
              if (depVersion === 'workspace:*' || depVersion === 'workspace:^') {
                continue
              }
              // Update to target version with caret range
              pkg[field][depName] = `^${TARGET_VERSION}`
            }
          }
        }
      }

      // Write back
      await fs.writeFile(
        fullPath,
        JSON.stringify(pkg, null, 2) + '\n'
      )

      if (oldVersion !== TARGET_VERSION) {
        console.log(chalk.green(`✅ ${relPath}: ${oldVersion} → ${TARGET_VERSION}`))
      } else {
        console.log(chalk.gray(`⏭️  ${relPath}: already at ${TARGET_VERSION}`))
      }

    } catch (error) {
      console.error(chalk.red(`❌ Failed to update ${relPath}:`), error)
    }
  }

  console.log(chalk.bold.green('\n✨ Version synchronization complete!\n'))
}

// Run the script
syncVersions().catch(error => {
  console.error(chalk.red('Fatal error:'), error)
  process.exit(1)
})