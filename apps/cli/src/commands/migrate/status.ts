import { Command } from 'commander';
import { prism, table } from '@xec-sh/kit';
import { CLIError } from '../../utils/errors.js';
import { MigrationRunner } from './runner.js';
import { withDatabase } from '../../utils/with-database.js';

export interface StatusOptions {
  json?: boolean;
  verbose?: boolean;
  config?: string;
}

export function statusCommand(): Command {
  const cmd = new Command('status')
    .description('Show migration status')
    .option('--json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed information')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: StatusOptions) => {
      try {
        await showMigrationStatus(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to get migration status: ${error instanceof Error ? error.message : String(error)}`,
          'MIGRATION_STATUS_ERROR'
        );
      }
    });

  return cmd;
}

async function showMigrationStatus(options: StatusOptions): Promise<void> {
  await withDatabase({ config: options.config, verbose: options.verbose }, async (db, config) => {
    const migrationsDir = config.migrations?.directory || './migrations';
    const tableName = config.migrations?.tableName || 'kysera_migrations';

    // Create migration runner
    const runner = new MigrationRunner(db, migrationsDir, tableName);

    // Get migration status
    const status = await runner.getMigrationStatus();
    const executed = status.filter((m: any) => m.status === 'executed');
    const pending = status.filter((m: any) => m.status === 'pending');

    if (options.json) {
      // Output as JSON
      const output = {
        total: status.length,
        executed: executed.length,
        pending: pending.length,
        migrations: status.map((m: any) => ({
          name: m.name,
          timestamp: m.timestamp,
          status: m.status,
          executedAt: m.executedAt?.toISOString() || null,
        })),
        database: {
          dialect: config.database!.dialect,
          connection: options.verbose ? config.database!.connection : undefined,
        },
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    // Display status header
    console.log('');
    console.log(prism.bold('Migration Status'));
    console.log('');

    // Show executed migrations
    if (executed.length > 0) {
      console.log(prism.green(`Executed (${executed.length}):`));

      if (options.verbose) {
        // Show as table
        const tableData = executed.map((m: any) => ({
          Name: m.name,
          Timestamp: m.timestamp,
          'Executed At': m.executedAt ? formatDate(m.executedAt) : 'Unknown',
        }));

        console.log('');
        console.log(prism.bold('Executed Migrations'));
        console.log(table(tableData as any));
      } else {
        // Simple list
        for (const migration of executed) {
          const executedAt = migration.executedAt ? ` (${formatDate(migration.executedAt)})` : '';
          console.log(`  ${prism.green('[OK]')} ${migration.name} ${prism.green('(executed)')}${prism.gray(executedAt)}`);
        }
      }
      console.log('');
    } else {
      console.log(prism.gray('No executed migrations'));
      console.log('');
    }

    // Show pending migrations
    if (pending.length > 0) {
      console.log(prism.yellow(`Pending (${pending.length}):`));

      if (options.verbose) {
        // Show as table
        const tableData = pending.map((m: any) => ({
          Name: m.name,
          Timestamp: m.timestamp,
        }));

        console.log('');
        console.log(prism.bold('Pending Migrations'));
        console.log(table(tableData as any));
      } else {
        // Simple list
        for (const migration of pending) {
          console.log(`  ${prism.gray('-')} ${migration.name} ${prism.gray('(pending)')}`);
        }
      }
      console.log('');
    } else {
      console.log(prism.gray('No pending migrations'));
      console.log('');
    }

    // Show database info
    if (options.verbose) {
      console.log(prism.gray('Database Information:'));
      console.log(`  Dialect: ${config.database!.dialect}`);
      console.log(`  Migrations Directory: ${migrationsDir}`);
      console.log(`  Migrations Table: ${tableName}`);
      console.log('');
    }
  });
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
