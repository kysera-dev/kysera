#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '..');

/**
 * Execute command and return output
 * @param {string} cmd - Command to execute
 * @param {boolean} silent - Suppress output
 * @returns {string} Command output
 */
function exec(cmd, silent = false) {
  try {
    return execSync(cmd, {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit',
    }).trim();
  } catch (error) {
    console.error(`❌ Command failed: ${cmd}`);
    throw error;
  }
}

/**
 * Get all publishable packages
 * @returns {Array<{name: string, version: string, path: string}>}
 */
function getPublishablePackages() {
  const packages = [];
  const packagesDir = join(rootDir, 'packages');

  if (!statSync(packagesDir).isDirectory()) {
    throw new Error('packages directory not found');
  }

  const dirs = readdirSync(packagesDir);
  for (const dir of dirs) {
    const pkgPath = join(packagesDir, dir);
    if (statSync(pkgPath).isDirectory()) {
      const packageJsonPath = join(pkgPath, 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        if (!pkg.private) {
          packages.push({
            name: pkg.name,
            version: pkg.version,
            path: pkgPath,
          });
        }
      } catch {
        // Skip if no package.json
      }
    }
  }

  return packages;
}

/**
 * Check if git working directory is clean
 */
function checkGitStatus() {
  const status = exec('git status --porcelain', true);
  if (status) {
    console.error('❌ Git working directory is not clean:');
    console.error(status);
    process.exit(1);
  }
}

/**
 * Check if on correct branch
 * @param {string} branch - Expected branch name
 */
function checkBranch(branch = 'main') {
  const currentBranch = exec('git branch --show-current', true);
  if (currentBranch !== branch) {
    console.error(`❌ Must be on ${branch} branch (currently on ${currentBranch})`);
    process.exit(1);
  }
}

/**
 * Check if package is already published
 * @param {string} name - Package name
 * @param {string} version - Package version
 * @returns {boolean}
 */
function isPublished(name, version) {
  try {
    exec(`npm view ${name}@${version} version`, true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Publish a package to npm
 * @param {string} name - Package name
 * @param {string} path - Package path
 */
function publishPackage(name, path) {
  console.log(`\n📦 Publishing ${name}...`);
  exec('pnpm publish --access public --no-git-checks', false);
}

/**
 * Main publish flow
 */
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const skipTests = args.includes('--skip-tests');
  const skipBuild = args.includes('--skip-build');

  console.log('\n🚀 Starting publish process...\n');

  // 1. Check git status
  console.log('📋 Checking git status...');
  checkGitStatus();
  checkBranch('main');
  console.log('✅ Git status is clean\n');

  // 2. Get packages
  const packages = getPublishablePackages();
  if (packages.length === 0) {
    console.error('❌ No publishable packages found');
    process.exit(1);
  }

  console.log(`📦 Found ${packages.length} package(s) to publish:`);
  for (const pkg of packages) {
    console.log(`   - ${pkg.name}@${pkg.version}`);
  }
  console.log();

  // 3. Check which packages are already published
  console.log('🔍 Checking npm registry...');
  const toPublish = [];
  const alreadyPublished = [];

  for (const pkg of packages) {
    if (isPublished(pkg.name, pkg.version)) {
      alreadyPublished.push(pkg);
    } else {
      toPublish.push(pkg);
    }
  }

  if (alreadyPublished.length > 0) {
    console.log('\n⚠️  Already published (skipping):');
    for (const pkg of alreadyPublished) {
      console.log(`   - ${pkg.name}@${pkg.version}`);
    }
  }

  if (toPublish.length === 0) {
    console.log('\n✨ All packages are already published!');
    process.exit(0);
  }

  console.log('\n📤 Will publish:');
  for (const pkg of toPublish) {
    console.log(`   - ${pkg.name}@${pkg.version}`);
  }
  console.log();

  if (isDryRun) {
    console.log('🏃 Dry run mode - exiting without publishing');
    process.exit(0);
  }

  // 4. Build packages
  if (!skipBuild) {
    console.log('🔨 Building packages...');
    exec('pnpm build');
    console.log('✅ Build completed\n');
  }

  // 5. Run tests
  if (!skipTests) {
    console.log('🧪 Running tests...');
    exec('pnpm test');
    console.log('✅ Tests passed\n');
  }

  // 6. Type check
  console.log('🔍 Type checking...');
  exec('pnpm typecheck');
  console.log('✅ Type check passed\n');

  // 7. Publish packages
  console.log('📤 Publishing packages...');
  for (const pkg of toPublish) {
    process.chdir(pkg.path);
    publishPackage(pkg.name, pkg.path);
    process.chdir(rootDir);
  }

  // 8. Get version from root package.json
  const rootPkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
  const version = rootPkg.version;

  // 9. Create git tag
  console.log(`\n🏷️  Creating git tag v${version}...`);
  exec(`git tag v${version}`);
  console.log('✅ Tag created\n');

  // 10. Push to git
  console.log('📤 Pushing to git...');
  exec('git push');
  exec('git push --tags');
  console.log('✅ Pushed to git\n');

  console.log('✨ Publish completed successfully!\n');
  console.log('📝 Published packages:');
  for (const pkg of toPublish) {
    console.log(`   - ${pkg.name}@${pkg.version}`);
  }
  console.log();
}

// Handle errors gracefully
main().catch((error) => {
  console.error('\n❌ Publish failed:');
  console.error(error.message);
  process.exit(1);
});
