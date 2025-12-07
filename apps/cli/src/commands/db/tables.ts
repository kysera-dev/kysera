import { Command } from 'commander';
import { prism, spinner, table } from '@xec-sh/kit';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { withDatabase } from '../../utils/with-database.js';
import { DatabaseIntrospector } from '../generate/introspector.js';
import { validateIdentifier } from '../../utils/sql-sanitizer.js';
import { formatBytes, formatNumber } from '../../utils/formatting.js';
import { getTableStatistics, getDatabaseStatistics } from '../../utils/table-stats.js';

export interface TablesOptions {
  json?: boolean;
  verbose?: boolean;
  config?: string;
}

export function tablesCommand(): Command {
  const cmd = new Command('tables')
    .description('List all database tables with statistics')
    .option('--json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed info (columns, indexes, etc.)')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: TablesOptions) => {
      try {
        await listTables(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to list tables: ${error instanceof Error ? error.message : String(error)}`,
          'TABLES_ERROR'
        );
      }
    });

  return cmd;
}

async function listTables(options: TablesOptions): Promise<void> {
  await withDatabase({ config: options.config, verbose: options.verbose }, async (db, config) => {
    const listSpinner = spinner() as any;
    listSpinner.start('Fetching table information...');

    const introspector = new DatabaseIntrospector(db, config.database!.dialect as any);
    const tables = await introspector.getTables();

    if (tables.length === 0) {
      listSpinner.warn('No tables found in database');
      return;
    }

    listSpinner.succeed(`Found ${tables.length} table${tables.length !== 1 ? 's' : ''}`);

    if (options.json) {
      // JSON output
      const tablesData = [];
      for (const tableName of tables) {
        const info = await introspector.getTableInfo(tableName);
        const stats = await getTableStatistics(db, tableName, config.database!.dialect);
        tablesData.push({
          name: tableName,
          columns: info.columns.length,
          indexes: info.indexes.length,
          primaryKey: info.primaryKey,
          foreignKeys: info.foreignKeys?.length || 0,
          rows: stats.rows,
          size: stats.size,
          indexSize: stats.indexSize,
        });
      }
      console.log(JSON.stringify(tablesData, null, 2));
    } else if (options.verbose) {
      // Verbose output - show detailed info for each table
      for (const tableName of tables) {
        const info = await introspector.getTableInfo(tableName);
        const stats = await getTableStatistics(db, tableName, config.database!.dialect);

        console.log('');
        console.log(prism.bold(`Table: ${tableName}`));
        console.log(prism.gray('-'.repeat(50)));

        // Statistics
        console.log('');
        console.log(prism.cyan('Statistics:'));
        console.log(`  Rows: ${formatNumber(stats.rows)}`);
        console.log(`  Size: ${formatBytes(stats.size)}`);
        console.log(`  Index Size: ${formatBytes(stats.indexSize)}`);
        console.log(`  Total Size: ${formatBytes(stats.size + stats.indexSize)}`);

        // Columns
        console.log('');
        console.log(prism.cyan(`Columns (${info.columns.length}):`));
        const columnData = info.columns.map((col: any) => ({
          Name: col.name,
          Type: col.dataType,
          Nullable: col.isNullable ? 'Yes' : 'No',
          Default: col.defaultValue || '-',
          Key: col.isPrimaryKey ? 'PK' : col.isForeignKey ? 'FK' : '-',
        }));
        console.log(table(columnData as any));

        // Indexes
        if (info.indexes.length > 0) {
          console.log('');
          console.log(prism.cyan(`Indexes (${info.indexes.length}):`));
          const indexData = info.indexes.map((idx: any) => ({
            Name: idx.name,
            Columns: idx.columns.join(', '),
            Unique: idx.isUnique ? 'Yes' : 'No',
            Primary: idx.isPrimary ? 'Yes' : 'No',
          }));
          console.log(table(indexData as any));
        }

        // Foreign Keys
        if (info.foreignKeys && info.foreignKeys.length > 0) {
          console.log('');
          console.log(prism.cyan(`Foreign Keys (${info.foreignKeys.length}):`));
          const fkData = info.foreignKeys.map((fk: any) => ({
            Column: fk.column,
            References: `${fk.referencedTable}.${fk.referencedColumn}`,
          }));
          console.log(table(fkData as any));
        }
      }

      // Summary
      console.log('');
      console.log(prism.gray('-'.repeat(50)));
      console.log(prism.bold('Database Summary'));
      const totalStats = await getDatabaseStatistics(db, tables, config.database!.dialect);
      console.log(`  Total Tables: ${tables.length}`);
      console.log(`  Total Rows: ${formatNumber(totalStats.totalRows)}`);
      console.log(`  Total Size: ${formatBytes(totalStats.totalSize)}`);
      console.log(`  Total Index Size: ${formatBytes(totalStats.totalIndexSize)}`);
      console.log(`  Database Size: ${formatBytes(totalStats.totalSize + totalStats.totalIndexSize)}`);
    } else {
      // Default table view
      const tableData = [];

      for (const tableName of tables) {
        try {
          const info = await introspector.getTableInfo(tableName);
          const stats = await getTableStatistics(db, tableName, config.database!.dialect);

          tableData.push({
            Table: tableName,
            Rows: formatNumber(stats.rows),
            Size: formatBytes(stats.size),
            Indexes: info.indexes.length,
            Columns: info.columns.length,
            'Foreign Keys': info.foreignKeys?.length || 0,
          });
        } catch (error) {
          logger.debug(`Failed to get stats for ${tableName}: ${error}`);
          tableData.push({
            Table: tableName,
            Rows: '?',
            Size: '?',
            Indexes: '?',
            Columns: '?',
            'Foreign Keys': '?',
          });
        }
      }

      console.log('');
      console.log(prism.bold('Database Tables'));
      console.log('');
      console.log(table(tableData as any));

      // Summary
      const totalStats = await getDatabaseStatistics(db, tables, config.database!.dialect);
      console.log('');
      console.log(
        prism.gray(`Total: ${tables.length} tables, ${formatBytes(totalStats.totalSize + totalStats.totalIndexSize)}`)
      );
    }
  });
}
