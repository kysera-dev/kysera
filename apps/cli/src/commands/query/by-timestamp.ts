import { Command } from 'commander';
import { prism, spinner, table as displayTable } from '@xec-sh/kit';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { withDatabase } from '../../utils/with-database.js';

export interface ByTimestampOptions {
  table?: string;
  column?: string;
  from?: string;
  to?: string;
  last?: string;
  order?: 'asc' | 'desc';
  limit?: string;
  json?: boolean;
  config?: string;
}

export function byTimestampCommand(): Command {
  const cmd = new Command('by-timestamp')
    .description('Query records by timestamp')
    .option('-t, --table <name>', 'Table name to query')
    .option('-c, --column <name>', 'Timestamp column name', 'created_at')
    .option('--from <date>', 'Start date (ISO format)')
    .option('--to <date>', 'End date (ISO format)')
    .option('--last <duration>', 'Last N hours/days/weeks (e.g., 24h, 7d, 2w)')
    .option('--order <dir>', 'Sort order (asc/desc)', 'desc')
    .option('-l, --limit <n>', 'Limit results', '100')
    .option('--json', 'Output as JSON')
    .option('--config <path>', 'Path to configuration file')
    .action(async (options: ByTimestampOptions) => {
      try {
        await queryByTimestamp(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to query by timestamp: ${error instanceof Error ? error.message : String(error)}`,
          'TIMESTAMP_QUERY_ERROR'
        );
      }
    });

  return cmd;
}

async function queryByTimestamp(options: ByTimestampOptions): Promise<void> {
  if (!options.table) {
    throw new CLIError('Table name is required', 'MISSING_TABLE', ['Use --table to specify a table name']);
  }

  await withDatabase({ config: options.config }, async (db, config) => {
    const querySpinner = spinner();
    const column = options.column || 'created_at';
    const limit = parseInt(options.limit || '100', 10);

    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (options.last) {
      const match = options.last.match(/^(\d+)([hdwm])$/);
      if (!match) {
        throw new CLIError('Invalid duration format. Use format like 24h, 7d, 2w, 1m', 'INVALID_DURATION');
      }

      const value = parseInt(match[1], 10);
      const unit = match[2];

      toDate = new Date();
      fromDate = new Date();

      switch (unit) {
        case 'h':
          fromDate.setHours(fromDate.getHours() - value);
          break;
        case 'd':
          fromDate.setDate(fromDate.getDate() - value);
          break;
        case 'w':
          fromDate.setDate(fromDate.getDate() - value * 7);
          break;
        case 'm':
          fromDate.setMonth(fromDate.getMonth() - value);
          break;
      }
    } else {
      if (options.from) {
        fromDate = new Date(options.from);
        if (isNaN(fromDate.getTime())) {
          throw new CLIError('Invalid from date format', 'INVALID_DATE');
        }
      }
      if (options.to) {
        toDate = new Date(options.to);
        if (isNaN(toDate.getTime())) {
          throw new CLIError('Invalid to date format', 'INVALID_DATE');
        }
      }
    }

    const timeRange = fromDate && toDate
      ? `from ${fromDate.toISOString()} to ${toDate.toISOString()}`
      : fromDate
      ? `from ${fromDate.toISOString()}`
      : toDate
      ? `until ${toDate.toISOString()}`
      : 'all time';

    querySpinner.start(`Querying ${options.table} ${timeRange}...`);

    let query = db.selectFrom(options.table).selectAll();

    if (fromDate) {
      query = query.where(column as any, '>=', fromDate as any);
    }
    if (toDate) {
      query = query.where(column as any, '<=', toDate as any);
    }

    query = query.orderBy(column as any, options.order || 'desc').limit(limit);

    const results = await query.execute();

    querySpinner.succeed(`Found ${results.length} record${results.length !== 1 ? 's' : ''}`);

    if (results.length === 0) {
      console.log(prism.gray('No records found in the specified time range'));
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log('');
      console.log(prism.bold(`Records in '${options.table}' (${timeRange}):`));
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
      console.log(prism.gray(`Showing ${results.length} of up to ${limit} records, ordered by ${column} ${options.order || 'desc'}`));
    }
  });
}
