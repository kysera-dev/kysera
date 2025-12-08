import { Command } from 'commander';
import { prism, spinner } from '@xec-sh/kit';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { withDatabase } from '../../utils/with-database.js';
import { DatabaseIntrospector, TableInfo } from './introspector.js';
import { toCamelCase, toPascalCase, toKebabCase } from '../../utils/templates.js';

export interface SchemaOptions {
  table?: string;
  output?: string;
  overwrite?: boolean;
  config?: string;
  strict?: boolean;
}

export function schemaCommand(): Command {
  const cmd = new Command('schema')
    .description('Generate Zod schema from database table')
    .argument('[table]', 'Table name to generate schema for')
    .option('-o, --output <path>', 'Output directory', './src/schemas')
    .option('--overwrite', 'Overwrite existing files', false)
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--strict', 'Use strict validation (no unknown keys)', true)
    .option('--no-strict', 'Allow unknown keys in validation')
    .action(async (table: string | undefined, options: SchemaOptions) => {
      try {
        await generateSchema(table, options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to generate schema: ${error instanceof Error ? error.message : String(error)}`,
          'GENERATE_SCHEMA_ERROR'
        );
      }
    });

  return cmd;
}

async function generateSchema(tableName: string | undefined, options: SchemaOptions): Promise<void> {
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

    const outputDir = options.output || './src/schemas';

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
      logger.debug(`Created output directory: ${outputDir}`);
    }

    let generated = 0;

    for (const table of tables) {
      const fileName = `${toKebabCase(table.name)}.schema.ts`;
      const filePath = join(outputDir, fileName);

      if (existsSync(filePath) && !options.overwrite) {
        logger.warn(`Skipping ${fileName} (file exists, use --overwrite to replace)`);
        continue;
      }

      const schemaCode = generateSchemaCode(table, {
        strict: options.strict !== false,
      });

      writeFileSync(filePath, schemaCode, 'utf-8');
      logger.info(`${prism.green('OK')} Generated ${prism.cyan(fileName)}`);
      generated++;
    }

    if (generated === 0) {
      logger.warn('No schemas were generated');
    } else {
      logger.info('');
      logger.info(prism.green(`Generated ${generated} schema${generated !== 1 ? 's' : ''} successfully`));
    }
  });
}

function generateSchemaCode(table: TableInfo, options: { strict: boolean }): string {
  const entityName = toPascalCase(table.name);
  const primaryKey = table.primaryKey?.[0] || 'id';

  let baseSchemaFields: string[] = [];

  for (const column of table.columns) {
    const fieldName = toCamelCase(column.name);
    let zodType = DatabaseIntrospector.mapDataTypeToZod(column.dataType, column.isNullable);

    if (column.maxLength && column.dataType.includes('char')) {
      zodType = zodType.replace('z.string()', `z.string().max(${column.maxLength})`);
    }

    if (column.name.includes('email')) {
      zodType = 'z.string().email()';
      if (column.isNullable) zodType += '.nullable()';
    }

    if (column.name.includes('url') || column.name.includes('website')) {
      zodType = 'z.string().url()';
      if (column.isNullable) zodType += '.nullable()';
    }

    if (column.dataType.includes('uuid') || column.name.includes('uuid')) {
      zodType = 'z.string().uuid()';
      if (column.isNullable) zodType += '.nullable()';
    }

    if (column.dataType.includes('date') || column.dataType.includes('time')) {
      zodType = 'z.coerce.date()';
      if (column.isNullable) zodType += '.nullable()';
    }

    baseSchemaFields.push(`  ${fieldName}: ${zodType}`);
  }

  let newSchemaFields: string[] = [];

  for (const column of table.columns) {
    const fieldName = toCamelCase(column.name);

    if (column.isPrimaryKey && column.defaultValue) continue;
    if (column.defaultValue && column.defaultValue.toLowerCase().includes('current_timestamp')) continue;
    if (column.name === 'created_at' || column.name === 'updated_at') continue;

    let zodType = DatabaseIntrospector.mapDataTypeToZod(column.dataType, column.isNullable);

    if (column.name.includes('email')) {
      zodType = 'z.string().email()';
      if (column.isNullable) zodType += '.nullable()';
    }

    if (column.isNullable || column.defaultValue) {
      zodType += '.optional()';
    }

    newSchemaFields.push(`  ${fieldName}: ${zodType}`);
  }

  let updateSchemaFields: string[] = [];

  for (const column of table.columns) {
    const fieldName = toCamelCase(column.name);

    if (column.isPrimaryKey) continue;
    if (['created_at', 'updated_at', 'deleted_at'].includes(column.name)) continue;

    let zodType = DatabaseIntrospector.mapDataTypeToZod(column.dataType, column.isNullable);
    zodType += '.optional()';

    updateSchemaFields.push(`  ${fieldName}: ${zodType}`);
  }

  const strictSuffix = options.strict ? '.strict()' : '';

  const code = `import { z } from 'zod'

// Base schema with all fields
export const ${entityName}Schema = z.object({
${baseSchemaFields.join(',\n')}
})${strictSuffix}

export type ${entityName} = z.infer<typeof ${entityName}Schema>

// Schema for creating new records
export const New${entityName}Schema = z.object({
${newSchemaFields.join(',\n')}
})${strictSuffix}

export type New${entityName} = z.infer<typeof New${entityName}Schema>

// Schema for updating records
export const Update${entityName}Schema = z.object({
${updateSchemaFields.join(',\n')}
})${strictSuffix}

export type Update${entityName} = z.infer<typeof Update${entityName}Schema>

// Schema for filtering/querying records
export const ${entityName}FilterSchema = ${entityName}Schema.partial()

export type ${entityName}Filter = z.infer<typeof ${entityName}FilterSchema>

// Validation helpers
export const validate${entityName} = (data: unknown) => ${entityName}Schema.parse(data)
export const validateNew${entityName} = (data: unknown) => New${entityName}Schema.parse(data)
export const validateUpdate${entityName} = (data: unknown) => Update${entityName}Schema.parse(data)
export const validate${entityName}Filter = (data: unknown) => ${entityName}FilterSchema.parse(data)

// Safe parse helpers (return result object instead of throwing)
export const safeParse${entityName} = (data: unknown) => ${entityName}Schema.safeParse(data)
export const safeParseNew${entityName} = (data: unknown) => New${entityName}Schema.safeParse(data)
export const safeParseUpdate${entityName} = (data: unknown) => Update${entityName}Schema.safeParse(data)
export const safeParse${entityName}Filter = (data: unknown) => ${entityName}FilterSchema.safeParse(data)
`;

  return code;
}
