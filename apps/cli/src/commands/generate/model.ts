import { Command } from 'commander';
import { prism, spinner } from '@xec-sh/kit';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { withDatabase } from '../../utils/with-database.js';
import { DatabaseIntrospector, TableInfo } from './introspector.js';

export interface ModelOptions {
  table?: string;
  output?: string;
  overwrite?: boolean;
  config?: string;
  timestamps?: boolean;
  softDelete?: boolean;
}

export function modelCommand(): Command {
  const cmd = new Command('model')
    .description('Generate TypeScript model from database table')
    .argument('[table]', 'Table name to generate model for')
    .option('-o, --output <path>', 'Output directory', './src/models')
    .option('--overwrite', 'Overwrite existing files', false)
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--timestamps', 'Include timestamp fields', true)
    .option('--no-timestamps', 'Exclude timestamp fields')
    .option('--soft-delete', 'Include soft delete fields', false)
    .action(async (table: string | undefined, options: ModelOptions) => {
      try {
        await generateModel(table, options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to generate model: ${error instanceof Error ? error.message : String(error)}`,
          'GENERATE_MODEL_ERROR'
        );
      }
    });

  return cmd;
}

async function generateModel(tableName: string | undefined, options: ModelOptions): Promise<void> {
  await withDatabase({ config: options.config }, async (db, config) => {
    const generateSpinner = spinner();
    generateSpinner.start('Introspecting database...');

    const introspector = new DatabaseIntrospector(db, config.database.dialect as any);

    let tables: TableInfo[] = [];

    if (tableName) {
      const tableInfo = await introspector.getTableInfo(tableName);
      tables = [tableInfo];
    } else {
      tables = await introspector.introspect();
    }

    generateSpinner.succeed(`Found ${tables.length} table${tables.length !== 1 ? 's' : ''}`);

    const outputDir = options.output || './src/models';

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
      logger.debug(`Created output directory: ${outputDir}`);
    }

    let generated = 0;

    for (const table of tables) {
      const fileName = `${toKebabCase(table.name)}.ts`;
      const filePath = join(outputDir, fileName);

      if (existsSync(filePath) && !options.overwrite) {
        logger.warn(`Skipping ${fileName} (file exists, use --overwrite to replace)`);
        continue;
      }

      const modelCode = generateModelCode(table, {
        timestamps: options.timestamps !== false,
        softDelete: options.softDelete === true,
      });

      writeFileSync(filePath, modelCode, 'utf-8');
      logger.info(`${prism.green('OK')} Generated ${prism.cyan(fileName)}`);
      generated++;
    }

    if (generated === 0) {
      logger.warn('No models were generated');
    } else {
      logger.info('');
      logger.info(prism.green(`Generated ${generated} model${generated !== 1 ? 's' : ''} successfully`));
    }
  });
}

function generateModelCode(table: TableInfo, options: { timestamps: boolean; softDelete: boolean }): string {
  const interfaceName = toPascalCase(table.name);
  const tableInterfaceName = `${interfaceName}Table`;

  let imports = [`import type { Generated } from 'kysely'`];

  let mainInterface = `export interface ${interfaceName} {\n`;

  for (const column of table.columns) {
    const fieldName = toCamelCase(column.name);
    const fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(column.dataType, column.isNullable);
    mainInterface += `  ${fieldName}: ${fieldType}\n`;
  }

  mainInterface += '}\n';

  let tableInterface = `export interface ${tableInterfaceName} {\n`;

  for (const column of table.columns) {
    const fieldName = column.name;
    let fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(column.dataType, column.isNullable);

    if (column.isPrimaryKey && column.defaultValue) {
      fieldType = `Generated<${fieldType}>`;
    } else if (column.defaultValue && column.defaultValue.toLowerCase().includes('current_timestamp')) {
      fieldType = `Generated<${fieldType}>`;
    }

    tableInterface += `  ${fieldName}: ${fieldType}\n`;
  }

  tableInterface += '}\n';

  let newInterface = `export interface New${interfaceName} {\n`;

  for (const column of table.columns) {
    const fieldName = toCamelCase(column.name);

    if (column.isPrimaryKey && column.defaultValue) continue;
    if (column.defaultValue && column.defaultValue.toLowerCase().includes('current_timestamp')) continue;

    let fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(column.dataType, column.isNullable);

    if (column.isNullable || column.defaultValue) {
      newInterface += `  ${fieldName}?: ${fieldType}\n`;
    } else {
      newInterface += `  ${fieldName}: ${fieldType}\n`;
    }
  }

  newInterface += '}\n';

  let updateInterface = `export interface ${interfaceName}Update {\n`;

  for (const column of table.columns) {
    const fieldName = toCamelCase(column.name);

    if (column.isPrimaryKey) continue;
    if (['created_at', 'updated_at', 'deleted_at'].includes(column.name)) continue;

    const fieldType = DatabaseIntrospector.mapDataTypeToTypeScript(column.dataType, column.isNullable);
    updateInterface += `  ${fieldName}?: ${fieldType}\n`;
  }

  updateInterface += '}\n';

  const databaseAddition = `// Add this to your Database interface:\n// ${table.name}: ${tableInterfaceName}`;

  return `${imports.join('\n')}

${mainInterface}

${tableInterface}

${newInterface}

${updateInterface}

${databaseAddition}
`;
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function toKebabCase(str: string): string {
  return str.replace(/_/g, '-');
}
