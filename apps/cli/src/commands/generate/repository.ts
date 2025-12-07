import { Command } from 'commander';
import { prism, spinner } from '@xec-sh/kit';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { withDatabase } from '../../utils/with-database.js';
import { DatabaseIntrospector, TableInfo } from './introspector.js';

export interface RepositoryOptions {
  table?: string;
  output?: string;
  overwrite?: boolean;
  config?: string;
  withValidation?: boolean;
  withPagination?: boolean;
  withSoftDelete?: boolean;
  withTimestamps?: boolean;
}

export function repositoryCommand(): Command {
  const cmd = new Command('repository')
    .description('Generate repository from database table')
    .argument('[table]', 'Table name to generate repository for')
    .option('-o, --output <path>', 'Output directory', './src/repositories')
    .option('--overwrite', 'Overwrite existing files', false)
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--with-validation', 'Include Zod validation', true)
    .option('--no-with-validation', 'Skip Zod validation')
    .option('--with-pagination', 'Include pagination methods', true)
    .option('--no-with-pagination', 'Skip pagination methods')
    .option('--with-soft-delete', 'Include soft delete support', false)
    .option('--with-timestamps', 'Include timestamp support', true)
    .option('--no-with-timestamps', 'Skip timestamp support')
    .action(async (table: string | undefined, options: RepositoryOptions) => {
      try {
        await generateRepository(table, options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to generate repository: ${error instanceof Error ? error.message : String(error)}`,
          'GENERATE_REPOSITORY_ERROR'
        );
      }
    });

  return cmd;
}

async function generateRepository(tableName: string | undefined, options: RepositoryOptions): Promise<void> {
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

    const outputDir = options.output || './src/repositories';

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
      logger.debug(`Created output directory: ${outputDir}`);
    }

    let generated = 0;

    for (const table of tables) {
      const fileName = `${toKebabCase(table.name)}.repository.ts`;
      const filePath = join(outputDir, fileName);

      if (existsSync(filePath) && !options.overwrite) {
        logger.warn(`Skipping ${fileName} (file exists, use --overwrite to replace)`);
        continue;
      }

      const repositoryCode = generateRepositoryCode(table, {
        withValidation: options.withValidation !== false,
        withPagination: options.withPagination !== false,
        withSoftDelete: options.withSoftDelete === true,
        withTimestamps: options.withTimestamps !== false,
      });

      writeFileSync(filePath, repositoryCode, 'utf-8');
      logger.info(`${prism.green('OK')} Generated ${prism.cyan(fileName)}`);
      generated++;
    }

    if (generated === 0) {
      logger.warn('No repositories were generated');
    } else {
      logger.info('');
      logger.info(prism.green(`Generated ${generated} repositor${generated !== 1 ? 'ies' : 'y'} successfully`));
    }
  });
}

function generateRepositoryCode(
  table: TableInfo,
  options: {
    withValidation: boolean;
    withPagination: boolean;
    withSoftDelete: boolean;
    withTimestamps: boolean;
  }
): string {
  const entityName = toPascalCase(table.name);
  const repositoryName = `${entityName}Repository`;
  const tableName = table.name;
  const primaryKey = table.primaryKey?.[0] || 'id';

  let imports: string[] = [
    `import { Kysely } from 'kysely'`,
    `import type { ${entityName}, New${entityName}, ${entityName}Update, ${entityName}Table } from '../models/${toKebabCase(table.name)}.js'`,
    `import type { Database } from '../database.js'`,
  ];

  if (options.withPagination) {
    imports.push(`import { paginate, type PaginationOptions, type PaginatedResult } from '@kysera/core'`);
  }

  if (options.withValidation) {
    imports.push(
      `import { ${entityName}Schema, New${entityName}Schema, Update${entityName}Schema } from '../schemas/${toKebabCase(table.name)}.schema.js'`
    );
  }

  let classCode = `export class ${repositoryName} {
  constructor(private db: Kysely<Database>) {}

  async findById(${primaryKey}: ${getPrimaryKeyType(table)}): Promise<${entityName} | undefined> {
    const result = await this.db
      .selectFrom('${tableName}')
      .selectAll()
      .where('${primaryKey}', '=', ${primaryKey})`;

  if (options.withSoftDelete) {
    classCode += `
      .where('deleted_at', 'is', null)`;
  }

  classCode += `
      .executeTakeFirst()

    return result as ${entityName} | undefined
  }

  async findAll(): Promise<${entityName}[]> {
    const results = await this.db
      .selectFrom('${tableName}')
      .selectAll()`;

  if (options.withSoftDelete) {
    classCode += `
      .where('deleted_at', 'is', null)`;
  }

  classCode += `
      .execute()

    return results as ${entityName}[]
  }

  async create(data: New${entityName}): Promise<${entityName}> {`;

  if (options.withValidation) {
    classCode += `
    const validated = New${entityName}Schema.parse(data)
`;
  }

  classCode += `
    const result = await this.db
      .insertInto('${tableName}')
      .values(${options.withValidation ? 'validated' : 'data'} as any)
      .returningAll()
      .executeTakeFirstOrThrow()

    return result as ${entityName}
  }

  async update(${primaryKey}: ${getPrimaryKeyType(table)}, data: ${entityName}Update): Promise<${entityName}> {`;

  if (options.withValidation) {
    classCode += `
    const validated = Update${entityName}Schema.parse(data)
`;
  }

  classCode += `
    const result = await this.db
      .updateTable('${tableName}')
      .set(${options.withValidation ? 'validated' : 'data'} as any)
      .where('${primaryKey}', '=', ${primaryKey})`;

  if (options.withSoftDelete) {
    classCode += `
      .where('deleted_at', 'is', null)`;
  }

  classCode += `
      .returningAll()
      .executeTakeFirstOrThrow()

    return result as ${entityName}
  }

  async delete(${primaryKey}: ${getPrimaryKeyType(table)}): Promise<void> {`;

  if (options.withSoftDelete) {
    classCode += `
    await this.db
      .updateTable('${tableName}')
      .set({ deleted_at: new Date() } as any)
      .where('${primaryKey}', '=', ${primaryKey})
      .execute()`;
  } else {
    classCode += `
    await this.db
      .deleteFrom('${tableName}')
      .where('${primaryKey}', '=', ${primaryKey})
      .execute()`;
  }

  classCode += `
  }

  async count(): Promise<number> {
    const result = await this.db
      .selectFrom('${tableName}')
      .select(this.db.fn.countAll().as('count'))`;

  if (options.withSoftDelete) {
    classCode += `
      .where('deleted_at', 'is', null)`;
  }

  classCode += `
      .executeTakeFirst()

    return Number(result?.count ?? 0)
  }

  async exists(${primaryKey}: ${getPrimaryKeyType(table)}): Promise<boolean> {
    const result = await this.db
      .selectFrom('${tableName}')
      .select('${primaryKey}')
      .where('${primaryKey}', '=', ${primaryKey})`;

  if (options.withSoftDelete) {
    classCode += `
      .where('deleted_at', 'is', null)`;
  }

  classCode += `
      .executeTakeFirst()

    return result !== undefined
  }`;

  if (options.withSoftDelete) {
    classCode += `

  async restore(${primaryKey}: ${getPrimaryKeyType(table)}): Promise<${entityName}> {
    const result = await this.db
      .updateTable('${tableName}')
      .set({ deleted_at: null } as any)
      .where('${primaryKey}', '=', ${primaryKey})
      .where('deleted_at', 'is not', null)
      .returningAll()
      .executeTakeFirstOrThrow()

    return result as ${entityName}
  }

  async findDeleted(): Promise<${entityName}[]> {
    const results = await this.db
      .selectFrom('${tableName}')
      .selectAll()
      .where('deleted_at', 'is not', null)
      .execute()

    return results as ${entityName}[]
  }

  async forceDelete(${primaryKey}: ${getPrimaryKeyType(table)}): Promise<void> {
    await this.db
      .deleteFrom('${tableName}')
      .where('${primaryKey}', '=', ${primaryKey})
      .execute()
  }`;
  }

  classCode += `
}

export const ${toCamelCase(table.name)}Repository = (db: Kysely<Database>) => new ${repositoryName}(db)
`;

  return `${imports.join('\n')}

${classCode}`;
}

function getPrimaryKeyType(table: TableInfo): string {
  const primaryKeyColumn = table.columns.find((col) => col.isPrimaryKey);
  if (!primaryKeyColumn) {
    return 'number';
  }
  return DatabaseIntrospector.mapDataTypeToTypeScript(primaryKeyColumn.dataType, false);
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
