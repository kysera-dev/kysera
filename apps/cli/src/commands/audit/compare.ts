import { Command } from 'commander';
import { prism, spinner } from '@xec-sh/kit';
import { CLIError, ValidationError } from '../../utils/errors.js';
import { getDatabaseConnection } from '../../utils/database.js';
import { loadConfig } from '../../config/loader.js';

export interface CompareOptions {
  json?: boolean;
  showValues?: boolean;
  config?: string;
}

export function compareCommand(): Command {
  const cmd = new Command('compare')
    .description('Compare two audit log entries')
    .argument('<id1>', 'First audit log ID')
    .argument('<id2>', 'Second audit log ID')
    .option('--json', 'Output as JSON')
    .option('--show-values', 'Show full field values')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (id1: string, id2: string, options: CompareOptions) => {
      try {
        await compareAuditLogs(id1, id2, options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to compare audit logs: ${error instanceof Error ? error.message : String(error)}`,
          'COMPARE_ERROR'
        );
      }
    });

  return cmd;
}

async function compareAuditLogs(id1: string, id2: string, options: CompareOptions): Promise<void> {
  // Load configuration
  const config = await loadConfig(options.config);

  if (!config?.database) {
    throw new CLIError('Database configuration not found', 'CONFIG_ERROR', [
      'Create a kysera.config.ts file with database configuration',
      'Or specify a config file with --config option',
    ]);
  }

  // Get database connection
  const db = await getDatabaseConnection(config.database);

  if (!db) {
    throw new CLIError('Failed to connect to database', 'DATABASE_ERROR', [
      'Check your database configuration',
      'Ensure the database server is running',
    ]);
  }

  const compareSpinner = spinner() as any;
  compareSpinner.start('Fetching audit logs...');

  try {
    // Validate and parse audit log IDs
    const parsedId1 = parseInt(id1, 10);
    const parsedId2 = parseInt(id2, 10);

    if (isNaN(parsedId1)) {
      throw new ValidationError('Invalid first audit log ID - must be a number');
    }
    if (isNaN(parsedId2)) {
      throw new ValidationError('Invalid second audit log ID - must be a number');
    }

    // Fetch both audit logs
    const [log1, log2] = await Promise.all([
      db.selectFrom('audit_logs').selectAll().where('id', '=', parsedId1).executeTakeFirst(),
      db.selectFrom('audit_logs').selectAll().where('id', '=', parsedId2).executeTakeFirst(),
    ]);

    if (!log1) {
      compareSpinner.fail(`Audit log #${id1} not found`);
      return;
    }

    if (!log2) {
      compareSpinner.fail(`Audit log #${id2} not found`);
      return;
    }

    compareSpinner.succeed('Audit logs fetched successfully');

    // Parse values
    const oldValues1 = parseJson(log1['old_values']);
    const newValues1 = parseJson(log1['new_values']);
    const oldValues2 = parseJson(log2['old_values']);
    const newValues2 = parseJson(log2['new_values']);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            log1: { id: id1, ...log1 },
            log2: { id: id2, ...log2 },
            differences: compareObjects({ ...oldValues1, ...newValues1 }, { ...oldValues2, ...newValues2 }),
          },
          null,
          2
        )
      );
      return;
    }

    // Display comparison
    console.log('');
    console.log(prism.bold('📊 Audit Log Comparison'));
    console.log(prism.gray('─'.repeat(60)));

    // Basic information comparison
    console.log('');
    console.log(prism.cyan('Basic Information:'));
    console.log(`  ${'Property'.padEnd(15)} | ${'Log #' + id1} | ${'Log #' + id2}`);
    console.log(`  ${'-'.repeat(15)} | ${'-'.repeat(20)} | ${'-'.repeat(20)}`);

    // Table
    const table1 = log1['table_name'] as string;
    const table2 = log2['table_name'] as string;
    console.log(
      `  ${'Table'.padEnd(15)} | ${table1.padEnd(20)} | ${table2.padEnd(20)} ${table1 !== table2 ? prism.yellow('⚠') : ''}`
    );

    // Entity ID
    const entity1 = log1['entity_id'] as string;
    const entity2 = log2['entity_id'] as string;
    console.log(
      `  ${'Entity ID'.padEnd(15)} | ${entity1.padEnd(20)} | ${entity2.padEnd(20)} ${entity1 !== entity2 ? prism.yellow('⚠') : ''}`
    );

    // Action
    const action1 = log1['action'] as string;
    const action2 = log2['action'] as string;
    console.log(
      `  ${'Action'.padEnd(15)} | ${formatAction(action1).padEnd(20)} | ${formatAction(action2).padEnd(20)} ${action1 !== action2 ? prism.yellow('⚠') : ''}`
    );

    // User
    const user1 = (log1['user_id'] || 'system') as string;
    const user2 = (log2['user_id'] || 'system') as string;
    console.log(
      `  ${'User'.padEnd(15)} | ${user1.padEnd(20)} | ${user2.padEnd(20)} ${user1 !== user2 ? prism.yellow('⚠') : ''}`
    );

    // Timestamp
    const time1 = new Date(log1['created_at'] as string);
    const time2 = new Date(log2['created_at'] as string);
    console.log(
      `  ${'Timestamp'.padEnd(15)} | ${time1.toLocaleString().padEnd(20)} | ${time2.toLocaleString().padEnd(20)}`
    );

    // Time difference
    const timeDiff = Math.abs(time2.getTime() - time1.getTime());
    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    console.log(`  ${'Time Diff'.padEnd(15)} | ${hours}h ${minutes}m`);

    // Value comparison
    if (options.showValues || table1 === table2) {
      console.log('');
      console.log(prism.cyan('Field Values:'));

      // Get all fields
      const allFields = new Set([
        ...Object.keys(oldValues1),
        ...Object.keys(newValues1),
        ...Object.keys(oldValues2),
        ...Object.keys(newValues2),
      ]);

      if (allFields.size > 0) {
        console.log(`  ${'Field'.padEnd(20)} | ${'Log #' + id1} | ${'Log #' + id2} | Status`);
        console.log(`  ${'-'.repeat(20)} | ${'-'.repeat(25)} | ${'-'.repeat(25)} | ${'-'.repeat(10)}`);

        for (const field of allFields) {
          // Get values for this field
          let value1: any;
          let value2: any;

          if (action1 === 'DELETE') {
            value1 = oldValues1[field];
          } else {
            value1 = newValues1[field] !== undefined ? newValues1[field] : oldValues1[field];
          }

          if (action2 === 'DELETE') {
            value2 = oldValues2[field];
          } else {
            value2 = newValues2[field] !== undefined ? newValues2[field] : oldValues2[field];
          }

          // Format values
          const formatted1 = formatValueCompact(value1, 25);
          const formatted2 = formatValueCompact(value2, 25);

          // Determine status
          let status = '';
          if (value1 === undefined && value2 !== undefined) {
            status = prism.green('Added');
          } else if (value1 !== undefined && value2 === undefined) {
            status = prism.red('Removed');
          } else if (JSON.stringify(value1) !== JSON.stringify(value2)) {
            status = prism.yellow('Changed');
          } else {
            status = prism.gray('Same');
          }

          console.log(`  ${field.padEnd(20)} | ${formatted1.padEnd(25)} | ${formatted2.padEnd(25)} | ${status}`);
        }
      }
    }

    // Summary
    console.log('');
    console.log(prism.gray('─'.repeat(60)));
    console.log(prism.gray('Summary:'));

    // Count differences
    const differences = table1 !== table2 || entity1 !== entity2 || action1 !== action2;
    if (differences) {
      console.log(prism.yellow('  ⚠  Logs are from different contexts'));
    } else {
      console.log(prism.green('  ✓  Logs are from the same entity'));
    }

    // Relationship
    if (table1 === table2 && entity1 === entity2) {
      if (time1 < time2) {
        console.log(`  Log #${id1} is older (happened first)`);
      } else {
        console.log(`  Log #${id2} is older (happened first)`);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('audit_logs')) {
      compareSpinner.fail('Audit logs table not found');
      console.log('');
      console.log(prism.yellow('The audit_logs table does not exist.'));
      return;
    }
    throw error;
  } finally {
    // Close database connection
    await db.destroy();
  }
}

function parseJson(value: any): any {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value || {};
}

function compareObjects(obj1: any, obj2: any): any {
  const differences: any = {
    added: [],
    removed: [],
    changed: [],
  };

  // Check for added fields
  for (const key in obj2) {
    if (!(key in obj1)) {
      differences.added.push(key);
    }
  }

  // Check for removed fields
  for (const key in obj1) {
    if (!(key in obj2)) {
      differences.removed.push(key);
    }
  }

  // Check for changed fields
  for (const key in obj1) {
    if (key in obj2 && JSON.stringify(obj1[key]) !== JSON.stringify(obj2[key])) {
      differences.changed.push({
        field: key,
        from: obj1[key],
        to: obj2[key],
      });
    }
  }

  return differences;
}

function formatAction(action: string): string {
  const colors: Record<string, (text: string) => string> = {
    INSERT: prism.green,
    UPDATE: prism.yellow,
    DELETE: prism.red,
  };

  const color = colors[action] || prism.white;
  return color(action);
}

function formatValueCompact(value: any, maxLength: number): string {
  let str: string;

  if (value === null) {
    str = 'NULL';
  } else if (value === undefined) {
    str = '-';
  } else if (typeof value === 'string') {
    str = `"${value}"`;
  } else if (typeof value === 'boolean') {
    str = value ? 'true' : 'false';
  } else if (value instanceof Date) {
    str = value.toISOString();
  } else if (typeof value === 'object') {
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }

  // Truncate if too long
  if (str.length > maxLength) {
    return str.substring(0, maxLength - 3) + '...';
  }

  return str;
}
