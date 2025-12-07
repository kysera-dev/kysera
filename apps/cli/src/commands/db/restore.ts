import { Command } from 'commander';
import { prism, spinner, confirm } from '@xec-sh/kit';
import { CLIError } from '../../utils/errors.js';
import { withDatabase } from '../../utils/with-database.js';
import { safePath, isPathSafe } from '../../utils/fs.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export interface RestoreOptions {
  force?: boolean;
  config?: string;
}

export function restoreCommand(): Command {
  const cmd = new Command('restore')
    .description('Restore database from dump')
    .argument('<file>', 'Dump file to restore from')
    .option('--force', 'Skip confirmation prompt')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (file: string, options: RestoreOptions) => {
      try {
        await restoreDatabase(file, options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to restore database: ${error instanceof Error ? error.message : String(error)}`,
          'RESTORE_ERROR'
        );
      }
    });

  return cmd;
}

async function restoreDatabase(dumpFile: string, options: RestoreOptions): Promise<void> {
  const baseDir = process.cwd();
  let dumpPath: string;

  if (resolve(dumpFile) === dumpFile) {
    dumpPath = dumpFile;
  } else {
    if (!isPathSafe(baseDir, dumpFile)) {
      throw new CLIError(
        'Invalid file path: path traversal detected',
        'INVALID_PATH',
        ['Use an absolute path or a path within the current directory']
      );
    }
    dumpPath = safePath(baseDir, dumpFile);
  }

  if (!existsSync(dumpPath)) {
    throw new CLIError(`Dump file not found: ${dumpPath}`, 'FILE_NOT_FOUND');
  }

  if (!options.force) {
    console.log('');
    console.log(prism.yellow('WARNING: This will restore the database from the dump file!'));
    console.log(prism.gray('This may overwrite existing data.'));
    console.log('');

    const confirmed = await confirm({
      message: 'Are you sure you want to continue?',
      initialValue: false,
    });

    if (!confirmed) {
      console.log(prism.gray('Restore cancelled'));
      return;
    }
  }

  await withDatabase({ config: options.config }, async (db, config) => {
    const restoreSpinner = spinner();
    restoreSpinner.start(`Restoring from ${dumpFile}...`);

    try {
      const dumpContent = readFileSync(dumpPath, 'utf-8');
      const isJson = dumpFile.endsWith('.json') || dumpContent.trim().startsWith('{');

      if (isJson) {
        await restoreFromJson(db, dumpContent, config.database.dialect);
      } else {
        await restoreFromSql(db, dumpContent);
      }

      restoreSpinner.stop();
      console.log(prism.green('Database restored successfully'));
      console.log('');
      console.log(prism.gray(`Source: ${dumpPath}`));
    } catch (error) {
      restoreSpinner.stop();
      throw error;
    }
  });
}

async function restoreFromJson(db: any, jsonContent: string, dialect: string): Promise<void> {
  let dump: any;
  try {
    dump = JSON.parse(jsonContent);
  } catch {
    throw new CLIError('Invalid JSON dump file', 'INVALID_DUMP');
  }

  if (!dump.tables || typeof dump.tables !== 'object') {
    throw new CLIError('Invalid dump format: missing tables', 'INVALID_DUMP');
  }

  const trx = await db.transaction().execute(async (trx: any) => {
    if (dialect === 'postgres') {
      await trx.executeQuery(trx.raw('SET session_replication_role = replica'));
    } else if (dialect === 'mysql') {
      await trx.executeQuery(trx.raw('SET FOREIGN_KEY_CHECKS = 0'));
    } else if (dialect === 'sqlite') {
      await trx.executeQuery(trx.raw('PRAGMA foreign_keys = OFF'));
    }

    for (const [tableName, tableData] of Object.entries(dump.tables)) {
      const table = tableData as any;

      if (table.data && Array.isArray(table.data) && table.data.length > 0) {
        if (!table.schema) {
          await trx.deleteFrom(tableName).execute();
        }

        const batchSize = 100;
        for (let i = 0; i < table.data.length; i += batchSize) {
          const batch = table.data.slice(i, i + batchSize);
          await trx.insertInto(tableName).values(batch).execute();
        }
      }
    }

    if (dialect === 'postgres') {
      await trx.executeQuery(trx.raw('SET session_replication_role = DEFAULT'));
    } else if (dialect === 'mysql') {
      await trx.executeQuery(trx.raw('SET FOREIGN_KEY_CHECKS = 1'));
    } else if (dialect === 'sqlite') {
      await trx.executeQuery(trx.raw('PRAGMA foreign_keys = ON'));
    }
  });
}

async function restoreFromSql(db: any, sqlContent: string): Promise<void> {
  const statements = sqlContent
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  if (statements.length === 0) {
    throw new CLIError('No SQL statements found in dump file', 'INVALID_DUMP');
  }

  await db.transaction().execute(async (trx: any) => {
    for (const statement of statements) {
      if (statement.trim() && !statement.startsWith('--')) {
        await trx.executeQuery(trx.raw(statement));
      }
    }
  });
}
