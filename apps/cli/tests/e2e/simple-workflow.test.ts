import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCLISync } from '../utils/cli-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Simple CLI Workflow', () => {
  const projectName = 'simple-test';
  const projectDir = path.join('/tmp', projectName);

  beforeAll(async () => {
    // Clean up any existing project
    try {
      await fs.rm(projectDir, { recursive: true, force: true });
    } catch {
      // Ignore
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

  it('should run init and basic commands', () => {
    // Test init
    const initResult = runCLISync(['init', projectName, '--database', 'sqlite', '--no-install', '--no-git'], {
      cwd: '/tmp',
    });

    expect(initResult.code).toBe(0);
    expect(initResult.stdout).toContain('Project created successfully');

    // Test migrate create
    const createResult = runCLISync(['migrate', 'create', 'test_migration'], { cwd: projectDir });

    expect(createResult.code).toBe(0);
    expect(createResult.stdout).toContain('Migration created');

    // Test migrate status
    const statusResult = runCLISync(['migrate', 'status', '--json'], { cwd: projectDir });

    // Debug output if failed
    if (statusResult.code !== 0) {
      console.log('Status stdout:', statusResult.stdout);
      console.log('Status stderr:', statusResult.stderr);
    }

    expect(statusResult.code).toBe(0);
    const status = JSON.parse(statusResult.stdout);
    expect(status).toHaveProperty('pending');
  });
});
