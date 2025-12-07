import { Command } from 'commander';
import { prism, table as displayTable, confirm } from '@xec-sh/kit';
import { CLIError } from '../../utils/errors.js';
import { withDatabase } from '../../utils/with-database.js';
import { DatabaseIntrospector } from '../generate/introspector.js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { DatabaseInstance } from '../../types/index.js';

export interface ConsoleOptions {
  query?: string;
  config?: string;
}

export function consoleCommand(): Command {
  const cmd = new Command('console')
    .description('Open interactive database console')
    .option('-q, --query <sql>', 'Execute SQL query and exit')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: ConsoleOptions) => {
      try {
        await databaseConsole(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to open console: ${error instanceof Error ? error.message : String(error)}`,
          'CONSOLE_ERROR'
        );
      }
    });

  return cmd;
}

async function databaseConsole(options: ConsoleOptions): Promise<void> {
  await withDatabase({ config: options.config }, async (db, config) => {
    // If query provided, execute and exit
    if (options.query) {
      await executeQuery(db, options.query);
      return;
    }

    // Interactive mode
    console.log(prism.cyan('Database Console'));
    console.log(prism.gray(`Connected to: ${config.database.dialect}`));
    console.log(prism.gray('Type ".help" for help, ".exit" to quit'));
    console.log('');

    const rl = createInterface({
      input: stdin,
      output: stdout,
      prompt: prism.gray('kysera> '),
    });

    const introspector = new DatabaseIntrospector(db, config.database.dialect as any);
    let multilineQuery = '';
    let inMultiline = false;

    rl.prompt();

    for await (const line of rl) {
      const trimmedLine = line.trim();

      // Handle multi-line queries
      if (inMultiline) {
        multilineQuery += ' ' + line;
        if (line.endsWith(';')) {
          inMultiline = false;
          const query = multilineQuery.trim();
          multilineQuery = '';

          try {
            await executeQuery(db, query);
          } catch (error) {
            console.error(prism.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
          }
          rl.setPrompt(prism.gray('kysera> '));
        } else {
          rl.setPrompt(prism.gray('     -> '));
        }
        rl.prompt();
        continue;
      }

      // Handle special commands
      if (trimmedLine.startsWith('.')) {
        const command = trimmedLine.toLowerCase().split(' ')[0];
        const args = trimmedLine.slice(command.length).trim();

        switch (command) {
          case '.help':
          case '.h':
            showHelp();
            break;

          case '.exit':
          case '.quit':
          case '.q':
            console.log(prism.gray('Goodbye!'));
            rl.close();
            return;

          case '.tables':
          case '.t':
            await showTables(introspector);
            break;

          case '.describe':
          case '.d':
            if (args) {
              await describeTable(introspector, args);
            } else {
              console.log(prism.yellow('Usage: .describe <table_name>'));
            }
            break;

          case '.indexes':
          case '.i':
            if (args) {
              await showIndexes(introspector, args);
            } else {
              console.log(prism.yellow('Usage: .indexes <table_name>'));
            }
            break;

          case '.count':
          case '.c':
            if (args) {
              await showCount(db, args);
            } else {
              console.log(prism.yellow('Usage: .count <table_name>'));
            }
            break;

          case '.clear':
          case '.cls':
            console.clear();
            break;

          default:
            console.log(prism.yellow(`Unknown command: ${command}`));
            console.log(prism.gray('Type ".help" for available commands'));
        }
      } else if (trimmedLine) {
        // SQL query
        if (trimmedLine.endsWith(';')) {
          try {
            await executeQuery(db, trimmedLine);
          } catch (error) {
            console.error(prism.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
          }
        } else if (
          trimmedLine.toLowerCase().startsWith('select') ||
          trimmedLine.toLowerCase().startsWith('insert') ||
          trimmedLine.toLowerCase().startsWith('update') ||
          trimmedLine.toLowerCase().startsWith('delete') ||
          trimmedLine.toLowerCase().startsWith('create') ||
          trimmedLine.toLowerCase().startsWith('drop') ||
          trimmedLine.toLowerCase().startsWith('alter')
        ) {
          inMultiline = true;
          multilineQuery = trimmedLine;
          rl.setPrompt(prism.gray('     -> '));
        } else {
          console.log(prism.yellow('SQL queries must end with ";"'));
        }
      }

      rl.prompt();
    }
  });
}

interface DestructiveQueryResult {
  destructive: boolean;
  type?: 'destructive' | 'update' | 'insert' | 'multi-statement';
  operation?: string;
}

function isDestructiveQuery(query: string): boolean {
  const result = analyzeDestructiveQuery(query);
  return result.destructive;
}

function analyzeDestructiveQuery(query: string): DestructiveQueryResult {
  // Remove leading/trailing whitespace and normalize
  const trimmed = query.trim();

  // Remove SQL comments (both -- and /* */ style)
  const withoutComments = trimmed
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  // Normalize whitespace
  const normalized = withoutComments.toLowerCase().replace(/\s+/g, ' ');

  // Highly destructive operations (DELETE, TRUNCATE, DROP, ALTER)
  const destructivePatterns = [
    { pattern: /^\s*delete\b/i, operation: 'DELETE' },
    { pattern: /^\s*truncate\b/i, operation: 'TRUNCATE' },
    { pattern: /^\s*drop\b/i, operation: 'DROP' },
    { pattern: /^\s*alter\b/i, operation: 'ALTER' },
  ];

  // Check for destructive operations at the start
  for (const { pattern, operation } of destructivePatterns) {
    if (pattern.test(normalized)) {
      return { destructive: true, type: 'destructive', operation };
    }
  }

  // UPDATE operations (should also require confirmation)
  if (/^\s*update\b/i.test(normalized)) {
    return { destructive: true, type: 'update', operation: 'UPDATE' };
  }

  // INSERT operations (optionally require confirmation for bulk inserts)
  if (/^\s*insert\b/i.test(normalized)) {
    return { destructive: true, type: 'insert', operation: 'INSERT' };
  }

  // Multi-statement queries: check for destructive operations after semicolons
  const statements = normalized.split(';').filter((s) => s.trim());
  if (statements.length > 1) {
    for (let i = 1; i < statements.length; i++) {
      const statement = statements[i].trim();
      if (/^\s*(delete|truncate|drop|alter|update)\b/i.test(statement)) {
        return { destructive: true, type: 'multi-statement', operation: 'MULTI-STATEMENT' };
      }
    }
  }

  return { destructive: false };
}

async function executeQuery(db: DatabaseInstance, query: string): Promise<void> {
  const startTime = Date.now();

  const cleanQuery = query.trim().replace(/;$/, '');

  if (isDestructiveQuery(cleanQuery)) {
    console.log('');
    console.log(prism.yellow('WARNING: This is a destructive operation!'));
    console.log(prism.yellow(`Query: ${cleanQuery}`));
    console.log('');

    const confirmed = await confirm({
      message: 'Are you sure you want to execute this query?',
      initialValue: false,
    });

    if (!confirmed) {
      console.log(prism.gray('Query cancelled'));
      return;
    }
  }

  const queryLower = cleanQuery.toLowerCase();
  const isSelect = queryLower.startsWith('select');

  const result = await db.executeQuery(db.raw(cleanQuery));
  const duration = Date.now() - startTime;

  if (isSelect) {
    const rows = result.rows as any[];
    if (rows.length === 0) {
      console.log(prism.gray('(0 rows)'));
    } else {
      const formattedRows = rows.map((row) => {
        const formatted: any = {};
        for (const [key, value] of Object.entries(row)) {
          if (value === null) {
            formatted[key] = prism.gray('NULL');
          } else if (value instanceof Date) {
            formatted[key] = value.toISOString();
          } else {
            formatted[key] = String(value);
          }
        }
        return formatted;
      });
      console.log('');
      console.log(displayTable(formattedRows));
      console.log('');
      console.log(prism.gray(`(${rows.length} row${rows.length !== 1 ? 's' : ''}, ${duration}ms)`));
    }
  } else {
    const affected = result.numAffectedRows ?? 0;
    console.log(prism.green(`Query OK, ${affected} row${affected !== 1 ? 's' : ''} affected (${duration}ms)`));
  }
}

function showHelp(): void {
  console.log('');
  console.log(prism.bold('Available Commands:'));
  console.log('');
  console.log('  .help, .h            Show this help message');
  console.log('  .exit, .quit, .q     Exit the console');
  console.log('  .tables, .t          List all tables');
  console.log('  .describe, .d <table> Describe table structure');
  console.log('  .indexes, .i <table> Show table indexes');
  console.log('  .count, .c <table>   Count rows in table');
  console.log('  .clear, .cls         Clear the screen');
  console.log('');
}

async function showTables(introspector: DatabaseIntrospector): Promise<void> {
  const tables = await introspector.getTables();
  if (tables.length === 0) {
    console.log(prism.gray('No tables found'));
  } else {
    console.log('');
    console.log(prism.bold('Tables:'));
    for (const table of tables) {
      console.log(`  - ${table}`);
    }
    console.log('');
  }
}

async function describeTable(introspector: DatabaseIntrospector, tableName: string): Promise<void> {
  const info = await introspector.getTableInfo(tableName);
  console.log('');
  console.log(prism.bold(`Table: ${tableName}`));
  console.log('');
  const columns = info.columns.map((col: any) => ({
    Column: col.name,
    Type: col.dataType,
    Nullable: col.isNullable ? 'YES' : 'NO',
    Key: col.isPrimaryKey ? 'PRI' : col.isForeignKey ? 'MUL' : '',
    Default: col.defaultValue || prism.gray('NULL'),
  }));
  console.log(displayTable(columns));
  console.log('');
}

async function showIndexes(introspector: DatabaseIntrospector, tableName: string): Promise<void> {
  const info = await introspector.getTableInfo(tableName);
  if (info.indexes.length === 0) {
    console.log(prism.gray(`No indexes found for table '${tableName}'`));
  } else {
    console.log('');
    console.log(prism.bold(`Indexes for table '${tableName}':`));
    console.log('');
    const indexes = info.indexes.map((idx: any) => ({
      Name: idx.name,
      Columns: idx.columns.join(', '),
      Unique: idx.isUnique ? 'YES' : 'NO',
    }));
    console.log(displayTable(indexes));
    console.log('');
  }
}

async function showCount(db: DatabaseInstance, tableName: string): Promise<void> {
  const result = await db.selectFrom(tableName).select(db.fn.countAll().as('count')).executeTakeFirst();
  const count = Number(result?.count || 0);
  console.log(`${tableName}: ${count} row${count !== 1 ? 's' : ''}`);
}
