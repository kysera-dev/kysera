import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCLISync } from '../utils/cli-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Complete CLI Workflow E2E', () => {
  const projectName = 'e2e-test-app';
  const projectDir = path.join('/tmp', projectName);

  beforeAll(async () => {
    // Ensure clean state
    try {
      await fs.rm(projectDir, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  });

  afterAll(async () => {
    // Clean up
    try {
      await fs.rm(projectDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should complete full project lifecycle', async () => {
    // Step 1: Initialize project
    console.log('Step 1: Initializing project...');
    const initResult = runCLISync(['init', projectName, '--database', 'sqlite', '--no-install', '--no-git'], {
      cwd: '/tmp',
    });

    expect(initResult.code).toBe(0);
    expect(initResult.stdout).toContain('Project created successfully');

    // Step 2: Create migrations
    console.log('Step 2: Creating migrations...');
    const createMigration1 = runCLISync(['migrate', 'create', 'create_users_table'], { cwd: projectDir });

    expect(createMigration1.code).toBe(0);
    expect(createMigration1.stdout).toContain('Migration created');

    // Create second migration
    const createMigration2 = runCLISync(['migrate', 'create', 'create_posts_table'], { cwd: projectDir });

    expect(createMigration2.code).toBe(0);
    expect(createMigration2.stdout).toContain('Migration created');

    // Step 3: Check migration status
    console.log('Step 3: Checking migration status...');
    const statusBefore = runCLISync(['migrate', 'status', '--json'], { cwd: projectDir });

    expect(statusBefore.code).toBe(0);
    const statusData = JSON.parse(statusBefore.stdout);
    expect(statusData.pending).toBeGreaterThan(0);
    expect(statusData.executed).toBe(0);

    // Step 4: List migrations
    console.log('Step 4: Listing migrations...');
    const listResult = runCLISync(['migrate', 'list'], { cwd: projectDir });

    expect(listResult.code).toBe(0);
    expect(listResult.stdout).toContain('Available Migrations');
    expect(listResult.stdout).toContain('create_users_table');
    expect(listResult.stdout).toContain('create_posts_table');

    // Step 5: Verify migration files were created
    console.log('Step 5: Verifying migration files...');
    const migrationsPath = path.join(projectDir, 'migrations');
    const migrationFiles = await fs.readdir(migrationsPath);

    expect(migrationFiles.length).toBeGreaterThan(0);
    expect(migrationFiles.some((f) => f.includes('create_users_table'))).toBe(true);
    expect(migrationFiles.some((f) => f.includes('create_posts_table'))).toBe(true);

    // Step 6: Verify config file was created correctly
    console.log('Step 6: Verifying configuration...');
    const configContent = await fs.readFile(path.join(projectDir, 'kysera.config.ts'), 'utf-8');

    expect(configContent).toContain("dialect: 'sqlite'");
    expect(configContent).toContain('database: process.env.DB_FILE');
    expect(configContent).toContain('migrations:');
    expect(configContent).toContain('plugins:');

    console.log('✅ All workflow steps completed successfully!');
  }, 60000); // 1 minute timeout for full workflow
});
