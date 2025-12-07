import { Command } from 'commander';
import { prism, spinner, table as displayTable } from '@xec-sh/kit';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { withDatabase } from '../../utils/with-database.js';
import type { DatabaseInstance } from '../../types/index.js';

export interface ExplainOptions {
  query?: string;
  file?: string;
  analyze?: boolean;
  verbose?: boolean;
  format?: 'text' | 'json' | 'tree' | 'yaml';
  buffers?: boolean;
  costs?: boolean;
  settings?: boolean;
  timing?: boolean;
  summary?: boolean;
  config?: string;
}

interface ExplainResult {
  query: string;
  plan: any;
  executionTime?: number;
  planningTime?: number;
  totalTime?: number;
}

export function explainCommand(): Command {
  const cmd = new Command('explain')
    .description('Show and analyze query execution plans')
    .option('-q, --query <sql>', 'SQL query to explain')
    .option('-f, --file <path>', 'Read query from file')
    .option('-a, --analyze', 'Execute query and show actual times')
    .option('-v, --verbose', 'Show verbose output')
    .option('--format <type>', 'Output format (text/json/tree/yaml)', 'text')
    .option('--buffers', 'Show buffer usage (PostgreSQL)')
    .option('--costs', 'Show cost estimates', true)
    .option('--timing', 'Show timing information', true)
    .option('--summary', 'Show summary at the end', true)
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: ExplainOptions) => {
      try {
        await explainQuery(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to explain query: ${error instanceof Error ? error.message : String(error)}`,
          'EXPLAIN_ERROR'
        );
      }
    });

  return cmd;
}

async function explainQuery(options: ExplainOptions): Promise<void> {
  let queryToExplain: string;

  if (options.query) {
    queryToExplain = options.query;
  } else if (options.file) {
    const { readFileSync } = await import('fs');
    try {
      queryToExplain = readFileSync(options.file, 'utf-8');
    } catch (error) {
      throw new CLIError(
        `Failed to read query file: ${error instanceof Error ? error.message : String(error)}`,
        'FILE_ERROR'
      );
    }
  } else {
    throw new CLIError('No query specified', 'MISSING_QUERY', [
      'Use --query to specify a SQL query',
      'Or use --file to read from a file',
    ]);
  }

  await withDatabase({ config: options.config, verbose: options.verbose }, async (db, config) => {
    const explainSpinner = spinner();
    explainSpinner.start('Generating execution plan...');

    let result: ExplainResult;

    switch (config.database.dialect) {
      case 'postgres':
        result = await explainPostgres(db, queryToExplain, options);
        break;
      case 'mysql':
        result = await explainMysql(db, queryToExplain, options);
        break;
      case 'sqlite':
        result = await explainSqlite(db, queryToExplain, options);
        break;
      default:
        throw new CLIError(`Unsupported database dialect: ${config.database.dialect}`, 'UNSUPPORTED_DIALECT');
    }

    explainSpinner.stop();
    console.log(prism.green('Execution plan generated'));
    displayExplainResults(result, options, config.database.dialect);
  });
}

async function explainPostgres(db: DatabaseInstance, query: string, options: ExplainOptions): Promise<ExplainResult> {
  const explainParts: string[] = ['EXPLAIN'];
  const explainOptions: string[] = [];

  if (options.analyze) explainOptions.push('ANALYZE');
  if (options.verbose) explainOptions.push('VERBOSE');
  if (options.buffers && options.analyze) explainOptions.push('BUFFERS');
  if (options.costs !== false) explainOptions.push('COSTS');
  if (options.timing !== false && options.analyze) explainOptions.push('TIMING');
  if (options.summary !== false && options.analyze) explainOptions.push('SUMMARY');

  const format = options.format === 'tree' ? 'TEXT' : options.format?.toUpperCase() || 'JSON';
  explainOptions.push(`FORMAT ${format}`);

  if (explainOptions.length > 0) {
    explainParts.push(`(${explainOptions.join(', ')})`);
  }
  explainParts.push(query);

  const explainQuery = explainParts.join(' ');
  const result = await db.executeQuery(db.raw(explainQuery));

  if (format === 'JSON' && result.rows && result.rows[0]) {
    const plan = result.rows[0]['QUERY PLAN'];
    const planData = typeof plan === 'string' ? JSON.parse(plan) : plan;
    return {
      query,
      plan: planData,
      executionTime: planData[0]?.['Execution Time'],
      planningTime: planData[0]?.['Planning Time'],
      totalTime: planData[0]?.['Total Runtime'],
    };
  }
  return { query, plan: result.rows };
}

async function explainMysql(db: DatabaseInstance, query: string, options: ExplainOptions): Promise<ExplainResult> {
  let explainQuery = 'EXPLAIN ';
  if (options.analyze) explainQuery += 'ANALYZE ';
  if (options.format === 'json') explainQuery += 'FORMAT=JSON ';
  explainQuery += query;

  const result = await db.executeQuery(db.raw(explainQuery));

  if (options.format === 'json' && result.rows && result.rows[0]) {
    const plan = result.rows[0]['EXPLAIN'];
    const planData = typeof plan === 'string' ? JSON.parse(plan) : plan;
    return { query, plan: planData };
  }
  return { query, plan: result.rows };
}

async function explainSqlite(db: DatabaseInstance, query: string, options: ExplainOptions): Promise<ExplainResult> {
  const explainQuery = `EXPLAIN QUERY PLAN ${query}`;
  const result = await db.executeQuery(db.raw(explainQuery));
  return { query, plan: result.rows };
}

function displayExplainResults(result: ExplainResult, options: ExplainOptions, dialect: string): void {
  console.log('');
  console.log(prism.bold('Query Execution Plan'));
  console.log(prism.gray('-'.repeat(60)));

  console.log('');
  console.log(prism.cyan('Query:'));
  console.log(`  ${result.query}`);

  console.log('');
  console.log(prism.cyan('Execution Plan:'));

  if (Array.isArray(result.plan)) {
    if (dialect === 'sqlite') {
      for (const row of result.plan) {
        console.log(`  ${row.detail || JSON.stringify(row)}`);
      }
    } else {
      for (const row of result.plan) {
        if (typeof row === 'object' && row['QUERY PLAN']) {
          console.log(`  ${row['QUERY PLAN']}`);
        } else {
          console.log(`  ${JSON.stringify(row)}`);
        }
      }
    }
  } else if (options.format === 'json') {
    console.log(JSON.stringify(result.plan, null, 2));
  } else {
    console.log(JSON.stringify(result.plan, null, 2));
  }

  if (options.analyze && (result.executionTime || result.planningTime)) {
    console.log('');
    console.log(prism.cyan('Timing:'));
    if (result.planningTime !== undefined) {
      console.log(`  Planning Time: ${result.planningTime.toFixed(3)}ms`);
    }
    if (result.executionTime !== undefined) {
      console.log(`  Execution Time: ${result.executionTime.toFixed(3)}ms`);
    }
    if (result.totalTime !== undefined) {
      console.log(`  Total Time: ${result.totalTime.toFixed(3)}ms`);
    }
  }
}
