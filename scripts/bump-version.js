#!/usr/bin/env node

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '..');

/**
 * Bump version in package.json
 * @param {string} filePath - Path to package.json
 * @param {string} version - New version
 */
function updatePackageVersion(filePath, version) {
  const pkg = JSON.parse(readFileSync(filePath, 'utf-8'));
  const oldVersion = pkg.version;
  pkg.version = version;

  // Update workspace dependencies to match new version
  const depFields = ['dependencies', 'devDependencies', 'peerDependencies'];

  for (const field of depFields) {
    if (pkg[field]) {
      for (const [name, ver] of Object.entries(pkg[field])) {
        if (name.startsWith('@holon/') && ver === 'workspace:*') {
        } else if (name.startsWith('@holon/') && ver.includes(oldVersion)) {
          // Update version reference
          pkg[field][name] = `^${version}`;
        }
      }
    }
  }

  writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ Updated ${filePath.replace(rootDir + '/', '')} from ${oldVersion} to ${version}`);
}

/**
 * Get all package.json files in the monorepo
 */
function getAllPackageJsonFiles() {
  const files = [];

  // Root package.json
  files.push(join(rootDir, 'package.json'));

  // Package directories
  const packagesDir = join(rootDir, 'packages');
  if (statSync(packagesDir).isDirectory()) {
    const packages = readdirSync(packagesDir);
    for (const pkg of packages) {
      const pkgPath = join(packagesDir, pkg);
      if (statSync(pkgPath).isDirectory()) {
        const packageJsonPath = join(pkgPath, 'package.json');
        try {
          statSync(packageJsonPath);
          files.push(packageJsonPath);
        } catch {
          // No package.json, skip
        }
      }
    }
  }

  // Apps directory if exists
  const appsDir = join(rootDir, 'apps');
  try {
    if (statSync(appsDir).isDirectory()) {
      const apps = readdirSync(appsDir);
      for (const app of apps) {
        const appPath = join(appsDir, app);
        if (statSync(appPath).isDirectory()) {
          const packageJsonPath = join(appPath, 'package.json');
          try {
            statSync(packageJsonPath);
            files.push(packageJsonPath);
          } catch {
            // No package.json, skip
          }
        }
      }
    }
  } catch {
    // No apps directory
  }

  return files;
}

/**
 * Parse version string and increment
 * @param {string} version - Current version
 * @param {'major' | 'minor' | 'patch'} type - Bump type
 */
function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump type: ${type}`);
  }
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: bump-version.js <version|major|minor|patch>');
    console.error('  version: Set specific version (e.g., 1.2.3)');
    console.error('  major:   Increment major version');
    console.error('  minor:   Increment minor version');
    console.error('  patch:   Increment patch version');
    process.exit(1);
  }

  const input = args[0];
  const files = getAllPackageJsonFiles();

  if (files.length === 0) {
    console.error('No package.json files found');
    process.exit(1);
  }

  // Get current version from root package.json
  const rootPkg = JSON.parse(readFileSync(files[0], 'utf-8'));
  const currentVersion = rootPkg.version;

  // Determine new version
  let newVersion;
  if (input === 'major' || input === 'minor' || input === 'patch') {
    newVersion = bumpVersion(currentVersion, input);
  } else if (/^\d+\.\d+\.\d+/.test(input)) {
    newVersion = input;
  } else {
    console.error('Invalid version format. Use x.y.z or major/minor/patch');
    process.exit(1);
  }

  console.log(`\n🚀 Bumping version from ${currentVersion} to ${newVersion}\n`);

  // Update all package.json files
  for (const file of files) {
    updatePackageVersion(file, newVersion);
  }

  console.log(
    `\n✨ Successfully updated ${files.length} package.json files to version ${newVersion}`,
  );
  console.log('\n📝 Next steps:');
  console.log('  1. Review the changes: git diff');
  console.log(
    '  2. Commit the changes: git add -A && git commit -m "chore: release v' + newVersion + '"',
  );
  console.log('  3. Tag the release: git tag v' + newVersion);
  console.log('  4. Push changes: git push && git push --tags\n');
}

// Run the script
main();
