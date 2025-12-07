import { Command } from 'commander';
import { prism, spinner, table } from '@xec-sh/kit';
import { CLIError } from '../../utils/errors.js';
import { withDatabase } from '../../utils/with-database.js';
import { DatabaseIntrospector } from '../generate/introspector.js';
import { logger } from '../../utils/logger.js';
import type { DatabaseInstance, TableInfo, ColumnInfo } from '../../types/index.js';

export interface IntrospectOptions {
  table?: string;
  json?: boolean;
  detailed?: boolean;
  config?: string;
}

export function introspectCommand(): Command {
  const cmd = new Command('introspect')
    .description('Introspect database schema')
    .argument('[table]', 'Specific table to introspect')
    .option('--json', 'Output as JSON')
    .option('--detailed', 'Show detailed information')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (tableName: string | undefined, options: IntrospectOptions) => {
      try {
        await introspectDatabase(tableName, options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to introspect database: ${error instanceof Error ? error.message : String(error)}`,
          'INTROSPECT_ERROR'
        );
      }
    });

  return cmd;
}

async function introspectDatabase(tableName: string | undefined, options: IntrospectOptions): Promise<void> {
  await withDatabase({ config: options.config }, async (db, config) => {
    const introspectSpinner = spinner() as any;
    introspectSpinner.start('Introspecting database...');

    const introspector = new DatabaseIntrospector(db, config.database.dialect as any);

    if (tableName) {
      const tableInfo = await introspector.getTableInfo(tableName);
      introspectSpinner.succeed(`Found table '${tableName}'`);

      if (options.json) {
        console.log(JSON.stringify(tableInfo, null, 2));
      } else {
        displayTableInfo(tableInfo, options.detailed || false);
      }
    } else {
      const tables = await introspector.getTables();

      if (tables.length === 0) {
        introspectSpinner.warn('No tables found in database');
        return;
      }

      introspectSpinner.succeed(`Found ${tables.length} table${tables.length !== 1 ? 's' : ''}`);

      if (options.json) {
        const allTableInfo = await introspector.introspect();
        console.log(JSON.stringify(allTableInfo, null, 2));
      } else if (options.detailed) {
        for (const tblName of tables) {
          const tableInfo = await introspector.getTableInfo(tblName);
          displayTableInfo(tableInfo, true);
          console.log('');
        }
      } else {
        const summaryData = [];
        for (const tblName of tables) {
          try {
            const info = await introspector.getTableInfo(tblName);
            const rowCount = await getTableRowCount(db, tblName);
            summaryData.push({
              Table: tblName,
              Columns: info.columns.length,
              Indexes: info.indexes.length,
              'Primary Key': info.primaryKey ? info.primaryKey.join(', ') : '-',
              'Foreign Keys': info.foreignKeys?.length || 0,
              Rows: rowCount,
            });
          } catch (error) {
            logger.debug(`Failed to get info for ${tblName}: ${error}`);
            summaryData.push({
              Table: tblName,
              Columns: '?',
              Indexes: '?',
              'Primary Key': '?',
              'Foreign Keys': '?',
              Rows: '?',
            });
          }
        }

        console.log('');
        console.log(prism.bold('Database Schema Summary'));
        console.log('');
        console.log(table(summaryData));

        console.log('');
        console.log(prism.gray('Database Information:'));
        console.log(`  Dialect: ${config.database.dialect}`);
        console.log(`  Tables: ${tables.length}`);
        console.log('');
        console.log(prism.gray(`Run ${prism.cyan('kysera db introspect <table>')} to see table details`));
      }
    }
  });
}

function displayTableInfo(tableInfo: TableInfo, detailed: boolean): void {
  console.log('');
  console.log(prism.bold(`Table: ${tableInfo.name}`));
  console.log(prism.gray('-'.repeat(50)));

  console.log('');
  console.log(prism.cyan('Columns:'));

  const columnData = tableInfo.columns.map((col: ColumnInfo) => {
    const row: any = {
      Name: col.name,
      Type: col.dataType,
      Nullable: col.isNullable ? 'Yes' : 'No',
    };

    if (col.isPrimaryKey) {
      row.Name = `${row.Name} ${prism.yellow('[PK]')}`;
    }
    if (col.isForeignKey) {
      row.Name = `${row.Name} ${prism.blue('[FK]')}`;
    }

    if (detailed) {
      row.Default = col.defaultValue || '-';
      if (col.maxLength) {
        row['Max Length'] = col.maxLength;
      }
      if (col.referencedTable) {
        row.References = `${col.referencedTable}.${col.referencedColumn}`;
      }
    }

    return row;
  });

  console.log(table(columnData));

  if (tableInfo.indexes.length > 0) {
    console.log('');
    console.log(prism.cyan('Indexes:'));
    const indexData = tableInfo.indexes.map((idx: any) => ({
      Name: idx.name,
      Columns: idx.columns.join(', '),
      Unique: idx.isUnique ? 'Yes' : 'No',
      Primary: idx.isPrimary ? 'Yes' : 'No',
    }));
    console.log(table(indexData));
  }

  if (tableInfo.foreignKeys && tableInfo.foreignKeys.length > 0) {
    console.log('');
    console.log(prism.cyan('Foreign Keys:'));
    const fkData = tableInfo.foreignKeys.map((fk: any) => ({
      Column: fk.column,
      References: `${fk.referencedTable}.${fk.referencedColumn}`,
    }));
    console.log(table(fkData));
  }

  if (detailed) {
    console.log('');
    console.log(prism.cyan('TypeScript Types:'));
    console.log('');
    const interfaceName = toPascalCase(tableInfo.name);
    console.log(prism.gray(`interface ${interfaceName} {`));
    for (const col of tableInfo.columns) {
      const fieldName = toCamelCase(col.name);
      const fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(col.dataType, col.isNullable);
      console.log(prism.gray(`  ${fieldName}: ${fieldType}`));
    }
    console.log(prism.gray('}'));
  }
}

async function getTableRowCount(db: DatabaseInstance, tableName: string): Promise<string> {
  try {
    const result = await db.selectFrom(tableName).select(db.fn.countAll().as('count')).executeTakeFirst();
    return result?.count?.toString() || '0';
  } catch {
    return '?';
  }
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase());
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}
