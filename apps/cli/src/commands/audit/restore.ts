import { Command } from 'commander';
import { prism, spinner, confirm } from '@xec-sh/kit';
import { CLIError, ValidationError } from '../../utils/errors.js';
import { getDatabaseConnection } from '../../utils/database.js';
import { loadConfig } from '../../config/loader.js';

export interface RestoreOptions {
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
  config?: string;
}

export function restoreCommand(): Command {
  const cmd = new Command('restore')
    .description('Restore entity from audit log')
    .argument('<audit-log-id>', 'Audit log ID to restore from')
    .option('--dry-run', 'Preview restore without executing')
    .option('--force', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (auditLogId: string, options: RestoreOptions) => {
      try {
        await restoreFromAudit(auditLogId, options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to restore from audit: ${error instanceof Error ? error.message : String(error)}`,
          'RESTORE_ERROR'
        );
      }
    });

  return cmd;
}

async function restoreFromAudit(auditLogId: string, options: RestoreOptions): Promise<void> {
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

  const restoreSpinner = spinner() as any;
  restoreSpinner.start(`Fetching audit log #${auditLogId}...`);

  try {
    // Validate and parse audit log ID
    const id = parseInt(auditLogId, 10);
    if (isNaN(id)) {
      throw new ValidationError('Invalid audit log ID - must be a number');
    }

    // Fetch the audit log entry
    const auditLog = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!auditLog) {
      restoreSpinner.fail(`Audit log #${auditLogId} not found`);
      return;
    }

    restoreSpinner.succeed('Audit log found');

    // Parse the audit log data
    const tableName = auditLog['table_name'] as string;
    const entityId = auditLog['entity_id'] as string;
    const action = auditLog['action'] as string;
    const oldValues = parseJson(auditLog['old_values']);
    const createdAt = new Date(auditLog['created_at'] as string);

    // Determine what to restore
    let restoreData: any = null;
    let restoreAction: string = '';

    if (action === 'DELETE') {
      // Restore deleted entity
      restoreData = oldValues;
      restoreAction = 'INSERT';
    } else if (action === 'UPDATE') {
      // Restore to previous state
      restoreData = oldValues;
      restoreAction = 'UPDATE';
    } else if (action === 'INSERT') {
      // Delete the inserted entity
      restoreAction = 'DELETE';
    }

    // Show restore preview
    console.log('');
    console.log(prism.bold('📝 Audit Log Details:'));
    console.log(prism.gray('─'.repeat(50)));
    console.log(`  ID: ${auditLogId}`);
    console.log(`  Table: ${tableName}`);
    console.log(`  Entity ID: ${entityId}`);
    console.log(`  Action: ${formatAction(action)}`);
    console.log(`  Timestamp: ${createdAt.toLocaleString()}`);
    console.log(`  User: ${auditLog['user_id'] || 'system'}`);

    console.log('');
    console.log(prism.bold('🔄 Restore Plan:'));
    console.log(prism.gray('─'.repeat(50)));

    if (restoreAction === 'INSERT') {
      console.log(prism.green('  ✨ Will recreate deleted entity:'));
      if (restoreData) {
        for (const [key, value] of Object.entries(restoreData)) {
          console.log(`    ${key}: ${formatValue(value)}`);
        }
      }
    } else if (restoreAction === 'UPDATE') {
      console.log(prism.yellow('  ✏️  Will restore entity to previous state:'));

      // Check current state
      const currentEntity = await db.selectFrom(tableName).selectAll().where('id', '=', entityId).executeTakeFirst();

      if (!currentEntity) {
        console.log(prism.red('  ⚠️  Entity no longer exists in database'));
        console.log(prism.gray('  Consider using a DELETE audit log to restore it'));
        return;
      }

      // Show changes
      for (const [key, value] of Object.entries(restoreData || {})) {
        const currentValue = currentEntity[key];
        if (currentValue !== value) {
          console.log(`    ${key}: ${formatValue(currentValue)} → ${formatValue(value)}`);
        }
      }
    } else if (restoreAction === 'DELETE') {
      console.log(prism.red('  🗑️  Will delete the inserted entity'));
      console.log(`    Entity ID: ${entityId}`);
    }

    // Dry run mode
    if (options.dryRun) {
      console.log('');
      console.log(prism.yellow('Dry run mode - no changes were made'));

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              auditLog,
              restoreAction,
              restoreData,
            },
            null,
            2
          )
        );
      }

      return;
    }

    // Confirm restore
    if (!options.force) {
      console.log('');
      const confirmed = await confirm({
        message: 'Are you sure you want to restore from this audit log?',
        initialValue: false,
      });

      if (!confirmed) {
        console.log(prism.gray('Restore cancelled'));
        return;
      }
    }

    // Execute restore
    const executeSpinner = spinner() as any;
    executeSpinner.start('Executing restore...');

    await db.transaction().execute(async (trx) => {
      if (restoreAction === 'INSERT') {
        // Recreate deleted entity
        await trx.insertInto(tableName).values(restoreData).execute();

        executeSpinner.succeed('Entity restored successfully');

        // Create audit log for the restore
        await trx
          .insertInto('audit_logs')
          .values({
            table_name: tableName,
            entity_id: entityId,
            action: 'INSERT',
            new_values: JSON.stringify(restoreData),
            user_id: 'system',
            metadata: JSON.stringify({
              restored_from: auditLogId,
              restore_timestamp: new Date().toISOString(),
            }),
            created_at: new Date(),
          })
          .execute();
      } else if (restoreAction === 'UPDATE') {
        // Get current values for audit
        const currentEntity = await trx.selectFrom(tableName).selectAll().where('id', '=', entityId).executeTakeFirst();

        // Update to previous state
        const updateQuery = trx.updateTable(tableName).where('id', '=', entityId);

        // Build SET clause dynamically
        let setClause = updateQuery;
        for (const [key, value] of Object.entries(restoreData || {})) {
          if (key !== 'id') {
            setClause = setClause.set(key as any, value);
          }
        }

        await setClause.execute();

        executeSpinner.succeed('Entity restored to previous state');

        // Create audit log for the restore
        await trx
          .insertInto('audit_logs')
          .values({
            table_name: tableName,
            entity_id: entityId,
            action: 'UPDATE',
            old_values: JSON.stringify(currentEntity),
            new_values: JSON.stringify(restoreData),
            user_id: 'system',
            metadata: JSON.stringify({
              restored_from: auditLogId,
              restore_timestamp: new Date().toISOString(),
            }),
            created_at: new Date(),
          })
          .execute();
      } else if (restoreAction === 'DELETE') {
        // Get current values for audit
        const currentEntity = await trx.selectFrom(tableName).selectAll().where('id', '=', entityId).executeTakeFirst();

        // Delete the entity
        await trx.deleteFrom(tableName).where('id', '=', entityId).execute();

        executeSpinner.succeed('Entity deleted successfully');

        // Create audit log for the restore
        await trx
          .insertInto('audit_logs')
          .values({
            table_name: tableName,
            entity_id: entityId,
            action: 'DELETE',
            old_values: JSON.stringify(currentEntity),
            user_id: 'system',
            metadata: JSON.stringify({
              restored_from: auditLogId,
              restore_timestamp: new Date().toISOString(),
            }),
            created_at: new Date(),
          })
          .execute();
      }
    });

    // Show success message
    console.log('');
    console.log(prism.green('✅ Restore completed successfully'));
    console.log(prism.gray(`Restored from audit log #${auditLogId}`));
    console.log(prism.gray(`Table: ${tableName}, Entity: ${entityId}`));

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            auditLogId,
            tableName,
            entityId,
            restoreAction,
          },
          null,
          2
        )
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('audit_logs')) {
      restoreSpinner.fail('Audit logs table not found');
      console.log('');
      console.log(prism.yellow('The audit_logs table does not exist.'));
      console.log(prism.gray('Audit logging is not enabled for this database.'));
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
      return value;
    }
  }
  return value || {};
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

function formatValue(value: any): string {
  if (value === null) {
    return prism.gray('NULL');
  } else if (value === undefined) {
    return prism.gray('undefined');
  } else if (typeof value === 'string') {
    return `"${value}"`;
  } else if (typeof value === 'boolean') {
    return value ? prism.green('true') : prism.red('false');
  } else if (value instanceof Date) {
    return value.toISOString();
  } else if (typeof value === 'object') {
    return prism.gray(JSON.stringify(value));
  } else {
    return String(value);
  }
}
