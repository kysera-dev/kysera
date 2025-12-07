import { Command } from 'commander';
import { prism, spinner, table as displayTable } from '@xec-sh/kit';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { withDatabase } from '../../utils/with-database.js';

export interface SoftDeletedOptions {
  table?: string;
  column?: string;
  restore?: string;
  purge?: boolean;
  force?: boolean;
  limit?: string;
  json?: boolean;
  config?: string;
}

export function softDeletedCommand(): Command {
  const cmd = new Command('soft-deleted')
    .description('Query and manage soft-deleted records')
    .option('-t, --table <name>', 'Table name to query')
    .option('-c, --column <name>', 'Soft delete column name', 'deleted_at')
    .option('-r, --restore <id>', 'Restore a soft-deleted record by ID')
    .option('--purge', 'Permanently delete soft-deleted records')
    .option('--force', 'Skip confirmation for purge')
    .option('-l, --limit <n>', 'Limit results', '100')
    .option('--json', 'Output as JSON')
    .option('--config <path>', 'Path to configuration file')
    .action(async (options: SoftDeletedOptions) => {
      try {
        await querySoftDeleted(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to query soft-deleted records: ${error instanceof Error ? error.message : String(error)}`,
          'SOFT_DELETED_ERROR'
        );
      }
    });

  return cmd;
}

async function querySoftDeleted(options: SoftDeletedOptions): Promise<void> {
  if (!options.table) {
    throw new CLIError('Table name is required', 'MISSING_TABLE', ['Use --table to specify a table name']);
  }

  await withDatabase({ config: options.config }, async (db, config) => {
    const querySpinner = spinner();
    const column = options.column || 'deleted_at';
    const limit = parseInt(options.limit || '100', 10);

    if (options.restore) {
      querySpinner.start(`Restoring record ${options.restore}...`);

      await db
        .updateTable(options.table)
        .set({ [column]: null } as any)
        .where('id', '=', options.restore as any)
        .execute();

      querySpinner.succeed(`Record ${options.restore} restored successfully`);
      return;
    }

    if (options.purge) {
      querySpinner.start('Counting soft-deleted records...');

      const countResult = await db
        .selectFrom(options.table)
        .select(db.fn.countAll().as('count'))
        .where(column as any, 'is not', null)
        .executeTakeFirst();

      const count = Number(countResult?.count || 0);
      querySpinner.stop(`Found ${count} soft-deleted records`);

      if (count === 0) {
        console.log(prism.gray('No records to purge'));
        return;
      }

      if (!options.force) {
        const { confirm } = await import('@xec-sh/kit');
        const confirmed = await confirm({
          message: `Permanently delete ${count} records from ${options.table}?`,
          initialValue: false,
        });

        if (!confirmed) {
          console.log(prism.gray('Purge cancelled'));
          return;
        }
      }

      querySpinner.start('Purging soft-deleted records...');

      await db
        .deleteFrom(options.table)
        .where(column as any, 'is not', null)
        .execute();

      querySpinner.succeed(`Purged ${count} records from ${options.table}`);
      return;
    }

    querySpinner.start(`Querying soft-deleted records from ${options.table}...`);

    const results = await db
      .selectFrom(options.table)
      .selectAll()
      .where(column as any, 'is not', null)
      .orderBy(column as any, 'desc')
      .limit(limit)
      .execute();

    querySpinner.succeed(`Found ${results.length} soft-deleted record${results.length !== 1 ? 's' : ''}`);

    if (results.length === 0) {
      console.log(prism.gray('No soft-deleted records found'));
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log('');
      console.log(prism.bold(`Soft-Deleted Records in '${options.table}':`));
      console.log('');

      const formattedResults = results.map((row: any) => {
        const formatted: any = {};
        for (const [key, value] of Object.entries(row)) {
          if (value === null) {
            formatted[key] = prism.gray('NULL');
          } else if (value instanceof Date) {
            formatted[key] = value.toISOString();
          } else if (typeof value === 'object') {
            formatted[key] = JSON.stringify(value);
          } else {
            formatted[key] = String(value);
          }
        }
        return formatted;
      });

      console.log(displayTable(formattedResults));

      console.log('');
      console.log(prism.cyan('Actions:'));
      console.log(`  Restore: kysera query soft-deleted -t ${options.table} --restore <id>`);
      console.log(`  Purge all: kysera query soft-deleted -t ${options.table} --purge`);
    }
  });
}
