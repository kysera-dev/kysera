import { Command } from 'commander';
import { prism, spinner, confirm } from '@xec-sh/kit';
import { sql } from 'kysely';
import { logger } from '../../utils/logger.js';
import { CLIError, CLIDatabaseError } from '../../utils/errors.js';
import { getDatabaseConnection } from '../../utils/database.js';
import { loadConfig } from '../../config/loader.js';
import { validateIdentifier, safeTruncate, safeDropDatabase } from '../../utils/sql-sanitizer.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface TestTeardownOptions {
  environment?: 'test' | 'ci' | 'local' | 'all';
  database?: string;
  force?: boolean;
  keepData?: boolean;
  preserveLogs?: boolean;
  cleanArtifacts?: boolean;
  pattern?: string;
  verbose?: boolean;
  json?: boolean;
  config?: string;
}

interface TeardownResult {
  environment: string;
  databases: Array<{ name: string; status: 'dropped' | 'preserved' | 'failed'; reason?: string; }>;
  artifacts: { cleaned: string[]; preserved: string[]; };
  duration: number;
}

export function testTeardownCommand(): Command {
  const cmd = new Command('teardown')
    .description('Clean up test databases and artifacts')
    .option('-e, --environment <env>', 'Test environment to clean', 'test')
    .option('-d, --database <name>', 'Specific database to clean')
    .option('-f, --force', 'Force cleanup without confirmation', false)
    .option('--keep-data', 'Keep test data (truncate instead of drop)', false)
    .option('--preserve-logs', 'Preserve test execution logs', false)
    .option('--clean-artifacts', 'Clean test artifacts', true)
    .option('--pattern <pattern>', 'Database name pattern to match')
    .option('-v, --verbose', 'Verbose output', false)
    .option('--json', 'Output as JSON', false)
    .option('--config <path>', 'Path to configuration file')
    .action(async (options: TestTeardownOptions) => {
      try {
        await teardownTestEnvironment(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to tear down test environment: ${error instanceof Error ? error.message : String(error)}`,
          'TEST_TEARDOWN_ERROR'
        );
      }
    });

  return cmd;
}

async function teardownTestEnvironment(options: TestTeardownOptions): Promise<void> {
  const startTime = Date.now();
  const config = await loadConfig(options.config);

  if (!config?.database) {
    throw new CLIError('Database configuration not found', 'CONFIG_ERROR', [
      'Create a kysera.config.ts file with database configuration',
      'Or specify a config file with --config option',
    ]);
  }

  const teardownSpinner = spinner();
  teardownSpinner.start('Scanning for test databases...');

  const result: TeardownResult = {
    environment: options.environment || 'test',
    databases: [],
    artifacts: { cleaned: [], preserved: [] },
    duration: 0,
  };

  try {
    const testDatabases = await findTestDatabases(config.database, options);

    if (testDatabases.length === 0) {
      teardownSpinner.stop('No test databases found');
    } else {
      teardownSpinner.stop(`Found ${testDatabases.length} test database${testDatabases.length !== 1 ? 's' : ''}`);

      if (!options.force && !options.json) {
        console.log('');
        console.log(prism.yellow('Test databases to clean:'));
        for (const dbName of testDatabases) {
          console.log(`  - ${dbName}`);
        }

        const action = options.keepData ? 'truncate' : 'drop';
        const shouldContinue = await confirm({
          message: `${action.charAt(0).toUpperCase() + action.slice(1)} ${testDatabases.length} test database${testDatabases.length !== 1 ? 's' : ''}?`
        });

        if (!shouldContinue) {
          console.log(prism.gray('Teardown cancelled'));
          return;
        }
      }

      const cleanupSpinner = spinner();

      for (const dbName of testDatabases) {
        cleanupSpinner.start(`Cleaning ${dbName}...`);

        try {
          if (options.keepData) {
            await truncateDatabase(config.database, dbName, options.preserveLogs || false);
            result.databases.push({ name: dbName, status: 'preserved', reason: 'Data truncated, structure preserved' });
            cleanupSpinner.stop(`Truncated ${dbName}`);
          } else {
            await dropTestDatabase(config.database, dbName);
            result.databases.push({ name: dbName, status: 'dropped' });
            cleanupSpinner.stop(`Dropped ${dbName}`);
          }
        } catch (error) {
          result.databases.push({
            name: dbName,
            status: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          });
          cleanupSpinner.stop(`Failed to clean ${dbName}: ${error}`);
        }
      }
    }

    if (options.cleanArtifacts) {
      const artifactSpinner = spinner();
      artifactSpinner.start('Cleaning test artifacts...');

      const artifacts = await cleanTestArtifacts(options.preserveLogs || false);
      result.artifacts = artifacts;

      artifactSpinner.stop(`Cleaned ${artifacts.cleaned.length} artifact${artifacts.cleaned.length !== 1 ? 's' : ''}`);
    }

    result.duration = Date.now() - startTime;

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      displayTeardownResults(result, options);
    }
  } catch (error) {
    teardownSpinner.stop('Teardown failed');
    throw error;
  }
}

async function findTestDatabases(config: any, options: TestTeardownOptions): Promise<string[]> {
  const databases: string[] = [];

  if (options.database) {
    databases.push(options.database);
    return databases;
  }

  let pattern: string;
  if (options.pattern) {
    pattern = options.pattern;
  } else if (options.environment === 'all') {
    pattern = '_test';
  } else if (options.environment === 'ci') {
    pattern = '_test_.*';
  } else if (options.environment === 'local') {
    pattern = '_test_local';
  } else {
    pattern = '_test';
  }

  const dialect = config.dialect || 'postgresql';

  if (dialect === 'postgresql') {
    const adminConfig = { ...config, database: 'postgres' };
    const db = await getDatabaseConnection(adminConfig);
    if (db) {
      const result = await db
        .selectFrom('pg_database' as any)
        .select('datname')
        .where('datname', 'like', `%${pattern}%`)
        .execute();
      databases.push(...result.map((r: any) => r.datname));
      await db.destroy();
    }
  } else if (dialect === 'sqlite') {
    const testDir = process.cwd();
    const files = await fs.readdir(testDir);
    for (const file of files) {
      if (file.includes(pattern) && (file.endsWith('.db') || file.endsWith('.sqlite'))) {
        databases.push(path.join(testDir, file));
      }
    }
  }

  return databases;
}

async function truncateDatabase(config: any, dbName: string, preserveLogs: boolean): Promise<void> {
  validateIdentifier(dbName, 'database');

  const testConfig = { ...config, database: dbName };
  const db = await getDatabaseConnection(testConfig);
  if (!db) {
    throw new CLIDatabaseError(`Cannot connect to database ${dbName}`);
  }

  try {
    let tables: string[] = [];
    const dialect = config.dialect || 'postgresql';

    if (dialect === 'postgresql') {
      const result = await db
        .selectFrom('information_schema.tables' as any)
        .select('table_name')
        .where('table_schema', '=', 'public')
        .where('table_type', '=', 'BASE TABLE')
        .execute();
      tables = result.map((r: any) => r.table_name);
      await sql.raw('SET session_replication_role = replica').execute(db);
    } else if (dialect === 'sqlite') {
      const result = await sql.raw(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).execute(db);
      tables = (result as any).rows.map((r: any) => r.name);
      await sql.raw('PRAGMA foreign_keys = OFF').execute(db);
    }

    for (const table of tables) {
      if (preserveLogs && (table.includes('log') || table.includes('audit'))) {
        continue;
      }
      try {
        validateIdentifier(table, 'table');
        if (dialect === 'postgresql') {
          await sql.raw(safeTruncate(table, 'postgres', true)).execute(db);
        } else {
          await db.deleteFrom(table as any).execute();
        }
      } catch (err) {
        logger.debug(`Skipping table with invalid name: ${table}`);
      }
    }

    if (dialect === 'postgresql') {
      await sql.raw('SET session_replication_role = DEFAULT').execute(db);
    } else if (dialect === 'sqlite') {
      await sql.raw('PRAGMA foreign_keys = ON').execute(db);
    }
  } finally {
    await db.destroy();
  }
}

async function dropTestDatabase(config: any, dbName: string): Promise<void> {
  const dialect = config.dialect || 'postgresql';
  const validDbName = validateIdentifier(dbName, 'database');

  if (dialect === 'postgresql') {
    const adminConfig = { ...config, database: 'postgres' };
    const db = await getDatabaseConnection(adminConfig);
    if (db) {
      await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${validDbName} AND pid <> pg_backend_pid()`.execute(db);
      await sql.raw(safeDropDatabase(dbName, 'postgres')).execute(db);
      await db.destroy();
    }
  } else if (dialect === 'sqlite') {
    try {
      await fs.unlink(dbName);
    } catch { }
  }
}

async function cleanTestArtifacts(preserveLogs: boolean): Promise<TeardownResult['artifacts']> {
  const artifacts: TeardownResult['artifacts'] = { cleaned: [], preserved: [] };

  const dirsToClean = ['coverage', '.nyc_output', 'test-results', 'test-reports', 'tmp/test', '.test-cache'];
  if (!preserveLogs) {
    dirsToClean.push('test-logs', 'logs/test');
  }

  for (const dir of dirsToClean) {
    const fullPath = path.join(process.cwd(), dir);
    try {
      await fs.rm(fullPath, { recursive: true, force: true });
      artifacts.cleaned.push(dir);
    } catch { }
  }

  const filesToClean = ['tests/test-config.ts', 'tests/test-config.js', '.test.env'];
  for (const file of filesToClean) {
    const fullPath = path.join(process.cwd(), file);
    try {
      await fs.unlink(fullPath);
      artifacts.cleaned.push(file);
    } catch { }
  }

  if (preserveLogs) {
    const logsToPreserve = ['test-logs', 'logs/test'];
    for (const log of logsToPreserve) {
      const fullPath = path.join(process.cwd(), log);
      try {
        await fs.access(fullPath);
        artifacts.preserved.push(log);
      } catch { }
    }
  }

  return artifacts;
}

function displayTeardownResults(result: TeardownResult, options: TestTeardownOptions): void {
  console.log('');
  console.log(prism.bold('Test Environment Teardown Complete'));
  console.log(prism.gray('='.repeat(50)));

  if (result.databases.length > 0) {
    console.log('');
    console.log(prism.cyan('Databases:'));

    const grouped = {
      dropped: result.databases.filter((d) => d.status === 'dropped'),
      preserved: result.databases.filter((d) => d.status === 'preserved'),
      failed: result.databases.filter((d) => d.status === 'failed'),
    };

    if (grouped.dropped.length > 0) {
      console.log(prism.green(`  [OK] Dropped: ${grouped.dropped.length}`));
    }

    if (grouped.preserved.length > 0) {
      console.log(prism.yellow(`  [WARN] Preserved: ${grouped.preserved.length}`));
    }

    if (grouped.failed.length > 0) {
      console.log(prism.red(`  [ERROR] Failed: ${grouped.failed.length}`));
      for (const db of grouped.failed) {
        console.log(`     - ${db.name}: ${db.reason}`);
      }
    }
  }

  if (result.artifacts.cleaned.length > 0 || result.artifacts.preserved.length > 0) {
    console.log('');
    console.log(prism.cyan('Artifacts:'));

    if (result.artifacts.cleaned.length > 0) {
      console.log(`  Cleaned: ${result.artifacts.cleaned.length} item${result.artifacts.cleaned.length !== 1 ? 's' : ''}`);
    }

    if (result.artifacts.preserved.length > 0) {
      console.log(`  Preserved: ${result.artifacts.preserved.length} item${result.artifacts.preserved.length !== 1 ? 's' : ''}`);
    }
  }

  console.log('');
  console.log(prism.cyan('Summary:'));
  console.log(`  Environment: ${result.environment}`);
  console.log(`  Duration: ${result.duration}ms`);
}
