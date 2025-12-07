import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { runCLI, createTestProject, createTestDatabase, cleanupTestDatabase } from '../utils/test-helpers.js';

describe('Migration Commands Integration', () => {
  let testProject: { dir: string; cleanup: () => Promise<void> };
  let dbName: string;

  beforeEach(async () => {
    // Create a test project with migrations
    testProject = await createTestProject('migrate-test', {
      dialect: 'sqlite',
      withConfig: true,
      withMigrations: true,
    });

    dbName = `test_${Date.now()}`;
  });

  afterEach(async () => {
    // Clean up
    if (testProject) {
      await testProject.cleanup();
    }
    await cleanupTestDatabase('sqlite', dbName);
  });

  describe('migrate:create', () => {
    it('should create a new migration file', async () => {
      const result = await runCLI(['migrate', 'create', 'add_users_table'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Migration created');

      // Check if file was created
      const migrationsDir = path.join(testProject.dir, 'migrations');
      const files = await fs.readdir(migrationsDir);
      const newMigration = files.find((f) => f.includes('add_users_table'));

      expect(newMigration).toBeDefined();
    });

    it('should create migration with template', async () => {
      const result = await runCLI(['migrate', 'create', 'add_posts', '--template', 'create-table'], {
        cwd: testProject.dir,
      });

      expect(result.code).toBe(0);

      // Check file content
      const migrationsDir = path.join(testProject.dir, 'migrations');
      const files = await fs.readdir(migrationsDir);
      const migration = files.find((f) => f.includes('add_posts'));

      if (migration) {
        const content = await fs.readFile(path.join(migrationsDir, migration), 'utf-8');
        expect(content).toContain('createTable');
      }
    });

    it('should use custom directory', async () => {
      const customDir = path.join(testProject.dir, 'custom-migrations');
      await fs.mkdir(customDir, { recursive: true });

      const result = await runCLI(['migrate', 'create', 'custom_migration', '--dir', customDir], {
        cwd: testProject.dir,
      });

      expect(result.code).toBe(0);

      const files = await fs.readdir(customDir);
      expect(files.some((f) => f.includes('custom_migration'))).toBe(true);
    });
  });

  describe('migrate:up', () => {
    it('should run all pending migrations', async () => {
      const result = await runCLI(['migrate', 'up'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Running migrations');
      expect(result.stdout).toContain('001_initial');
    });

    it('should run specific number of migrations', async () => {
      // Create additional migrations
      await runCLI(['migrate', 'create', 'second_migration'], { cwd: testProject.dir });
      await runCLI(['migrate', 'create', 'third_migration'], { cwd: testProject.dir });

      const result = await runCLI(['migrate', 'up', '--count', '1'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('001_initial');
      expect(result.stdout).not.toContain('second_migration');
    });

    it('should handle no pending migrations', async () => {
      // Run migrations first
      await runCLI(['migrate', 'up'], { cwd: testProject.dir });

      // Run again
      const result = await runCLI(['migrate', 'up'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('No pending migrations');
    });
  });

  describe('migrate:down', () => {
    beforeEach(async () => {
      // Run migrations first
      await runCLI(['migrate', 'up'], { cwd: testProject.dir });
    });

    it('should rollback last migration', async () => {
      const result = await runCLI(['migrate', 'down'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Rolling back');
    });

    it('should rollback specific number of migrations', async () => {
      const result = await runCLI(['migrate', 'down', '--count', '1'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Rolling back 1 migration');
    });

    it('should handle no migrations to rollback', async () => {
      // Rollback all first
      await runCLI(['migrate', 'down', '--all'], { cwd: testProject.dir });

      // Try to rollback again
      const result = await runCLI(['migrate', 'down'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('No migrations to rollback');
    });
  });

  describe('migrate:status', () => {
    it('should show migration status', async () => {
      const result = await runCLI(['migrate', 'status'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Migration Status');
      expect(result.stdout).toContain('001_initial');
      expect(result.stdout).toContain('pending');
    });

    it('should show status after running migrations', async () => {
      await runCLI(['migrate', 'up'], { cwd: testProject.dir });

      const result = await runCLI(['migrate', 'status'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('001_initial');
      expect(result.stdout).toContain('executed');
    });

    it('should output JSON format', async () => {
      const result = await runCLI(['migrate', 'status', '--json'], { cwd: testProject.dir });

      expect(result.code).toBe(0);

      const json = JSON.parse(result.stdout);
      expect(json).toHaveProperty('pending');
      expect(json).toHaveProperty('executed');
      expect(json).toHaveProperty('total');
    });
  });

  describe('migrate:reset', () => {
    beforeEach(async () => {
      // Run some migrations
      await runCLI(['migrate', 'up'], { cwd: testProject.dir });
    });

    it('should reset all migrations', async () => {
      const result = await runCLI(['migrate', 'reset', '--force'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Resetting all migrations');

      // Check status
      const status = await runCLI(['migrate', 'status'], { cwd: testProject.dir });
      expect(status.stdout).toContain('pending');
    });

    it('should require force flag', async () => {
      const result = await runCLI(['migrate', 'reset'], { cwd: testProject.dir });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('--force');
    });

    it('should re-run migrations after reset', async () => {
      await runCLI(['migrate', 'reset', '--force'], { cwd: testProject.dir });

      const result = await runCLI(['migrate', 'reset', '--run'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Running migrations');

      // Check status
      const status = await runCLI(['migrate', 'status'], { cwd: testProject.dir });
      expect(status.stdout).toContain('executed');
    });
  });

  describe('migrate:list', () => {
    it('should list all migrations', async () => {
      const result = await runCLI(['migrate', 'list'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Available Migrations');
      expect(result.stdout).toContain('001_initial');
    });

    it('should filter pending migrations', async () => {
      // Run some migrations
      await runCLI(['migrate', 'up'], { cwd: testProject.dir });

      // Create a new one
      await runCLI(['migrate', 'create', 'new_migration'], { cwd: testProject.dir });

      const result = await runCLI(['migrate', 'list', '--pending'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('new_migration');
      expect(result.stdout).not.toContain('001_initial');
    });

    it('should filter executed migrations', async () => {
      await runCLI(['migrate', 'up'], { cwd: testProject.dir });

      const result = await runCLI(['migrate', 'list', '--executed'], { cwd: testProject.dir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('001_initial');
    });
  });

  describe('Error handling', () => {
    it('should handle missing migrations directory', async () => {
      // Remove migrations directory
      const migrationsDir = path.join(testProject.dir, 'migrations');
      await fs.rm(migrationsDir, { recursive: true });

      const result = await runCLI(['migrate', 'up'], { cwd: testProject.dir });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('migrations directory');
    });

    it('should handle invalid migration files', async () => {
      // Create invalid migration
      const migrationsDir = path.join(testProject.dir, 'migrations');
      await fs.writeFile(path.join(migrationsDir, '002_invalid.ts'), 'export const invalid = true');

      const result = await runCLI(['migrate', 'up'], { cwd: testProject.dir });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Invalid migration');
    });

    it('should handle database connection errors', async () => {
      // Create config with wrong credentials
      await fs.writeFile(
        path.join(testProject.dir, 'kysera.config.json'),
        JSON.stringify({
          database: {
            dialect: 'postgres',
            host: 'invalid-host-that-does-not-exist',
            port: 99999,
            database: 'nonexistent',
            user: 'invalid',
            password: 'wrong',
          },
        })
      );

      const result = await runCLI(['migrate', 'up'], { cwd: testProject.dir });

      expect(result.code).toBe(1);
      // Should fail with an error related to database or migration
      expect(result.stderr).toMatch(/(connection|database|Failed to)/i);
    });
  });
});
