import { Command } from 'commander';
import { prism } from '@xec-sh/kit';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { MIGRATION_TEMPLATES, parseColumns } from './templates.js';
import { renderTemplate } from '../../utils/templates.js';

export interface CreateOptions {
  dir?: string;
  directory?: string;
  template?: string;
  ts?: boolean;
  table?: string;
  columns?: string;
}

export function createCommand(): Command {
  const cmd = new Command('create')
    .description('Create a new migration file')
    .argument('<name>', 'Migration name')
    .option('-d, --dir <path>', 'Migration directory', './migrations')
    .option('--directory <path>', 'Migration directory (alias for --dir)', './migrations')
    .option('-t, --template <type>', 'Migration template', 'default')
    .option('--ts', 'Generate TypeScript file', true)
    .option('--no-ts', 'Generate JavaScript file')
    .option('--table <name>', 'Table name for table-based templates')
    .option('--columns <list>', 'Comma-separated column definitions (name:type:nullable:default)')
    .action(async (name: string, options: CreateOptions) => {
      try {
        await createMigration(name, options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to create migration: ${error instanceof Error ? error.message : String(error)}`,
          'CREATE_MIGRATION_ERROR'
        );
      }
    });

  return cmd;
}

async function createMigration(name: string, options: CreateOptions): Promise<void> {
  const directory = options.dir || options.directory || './migrations';
  const template = options.template || 'default';
  const useTypeScript = options.ts !== false;

  // Validate template
  if (!MIGRATION_TEMPLATES[template as keyof typeof MIGRATION_TEMPLATES]) {
    throw new CLIError(`Invalid template: ${template}`, 'INVALID_TEMPLATE', undefined, [
      `Available templates: ${Object.keys(MIGRATION_TEMPLATES).join(', ')}`,
    ]);
  }

  // Ensure migrations directory exists
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
    logger.debug(`Created migrations directory: ${directory}`);
  }

  // Generate timestamp and filename
  const timestamp = generateTimestamp();
  const safeName = name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  const extension = useTypeScript ? '.ts' : '.js';
  const filename = `${timestamp}_${safeName}${extension}`;
  const filepath = join(directory, filename);

  // Check if file already exists
  if (existsSync(filepath)) {
    throw new CLIError(`Migration file already exists: ${filename}`, 'FILE_EXISTS');
  }

  // Prepare template data
  const templateData: Record<string, any> = {
    name: safeName,
    timestamp,
  };

  // Add table-specific data if needed
  if (options.table) {
    templateData.table = options.table;
  }

  // Parse and add columns if provided
  if (options.columns) {
    templateData.columns = parseColumns(options.columns);
  }

  // Validate required data for specific templates
  const tableTemplates = ['alter-table', 'add-columns', 'drop-columns', 'add-foreign-key'];
  if (tableTemplates.includes(template) && !options.table) {
    throw new CLIError(`Template '${template}' requires --table option`, 'MISSING_TABLE');
  }

  // For create-table and create-index, use a default table name if not provided
  if (template === 'create-table' && !options.table) {
    // Use the migration name as the table name (e.g., "add_posts" -> "posts")
    options.table = safeName.replace(/^(add_|create_)/, '');
    if (!options.table || options.table === safeName) {
      options.table = 'table_name'; // fallback default
    }
    templateData.table = options.table;
  }

  if (template === 'create-index' && !options.table) {
    options.table = 'table_name'; // default
    templateData.table = options.table;
  }

  // Get template content
  let content = MIGRATION_TEMPLATES[template as keyof typeof MIGRATION_TEMPLATES];

  // Process template if it has variables
  if (content.includes('{{')) {
    // Simple template replacement for now (since we removed Handlebars dependency from templates)
    content = processTemplate(content, templateData);
  }

  // Add sql import if needed
  if (content.includes('sql`')) {
    content = content.replace('import { Kysely }', 'import { Kysely, sql }');
  }

  // Write the migration file
  writeFileSync(filepath, content, 'utf-8');

  // Success message
  console.log(`Migration created: ${filename}`);

  if (process.env.NODE_ENV !== 'test') {
    logger.info(`${prism.green('✓')} Created migration: ${prism.cyan(filename)}`);
    logger.info(`  ${prism.gray(filepath)}`);

    // Show next steps
    logger.info('');
    logger.info('Next steps:');
    logger.info(`  1. Edit the migration file to add your changes`);
    logger.info(`  2. Run ${prism.cyan('kysera migrate up')} to apply the migration`);
  }
}

function generateTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function processTemplate(template: string, data: Record<string, any>): string {
  let result = template;

  // Simple replacement for {{table}}
  if (data.table) {
    result = result.replace(/\{\{table\}\}/g, data.table);
  }

  // Handle columns array
  if (data.columns && Array.isArray(data.columns) && data.columns.length > 0) {
    // Handle {{#each columns}} blocks
    const eachRegex = /\{\{#each columns\}\}([\s\S]*?)\{\{\/each\}\}/g;
    result = result.replace(eachRegex, (match, content) => {
      return data.columns
        .map((col: any) => {
          let line = content
            .replace(/\{\{this\.name\}\}/g, col.name)
            .replace(/\{\{this\.type\}\}/g, col.type)
            .replace(/\{\{this\}\}/g, col.name); // For simple column references

          // Handle conditionals
          if (col.nullable) {
            line = line.replace(/\{\{#if this\.nullable\}\}.*?\{\{else\}\}(.*?)\{\{\/if\}\}/g, '');
          } else {
            line = line.replace(/\{\{#if this\.nullable\}\}(.*?)\{\{else\}\}(.*?)\{\{\/if\}\}/g, '$2');
          }

          if (col.defaultValue) {
            line = line.replace(/\{\{#if this\.defaultValue\}\}(.*?)\{\{\/if\}\}/g, '$1');
            line = line.replace(/\{\{this\.defaultValue\}\}/g, col.defaultValue);
          } else {
            line = line.replace(/\{\{#if this\.defaultValue\}\}.*?\{\{\/if\}\}/g, '');
          }

          return line;
        })
        .join('');
    });
  } else {
    // Remove {{#each columns}} blocks entirely if no columns provided
    const eachRegex = /\s*\{\{#each columns\}\}([\s\S]*?)\{\{\/each\}\}/g;
    result = result.replace(eachRegex, '');
  }

  // Handle other simple replacements
  result = result.replace(/\{\{indexName\}\}/g, data.indexName || 'idx');
  result = result.replace(/\{\{column\}\}/g, data.column || '');
  result = result.replace(/\{\{referencedTable\}\}/g, data.referencedTable || '');
  result = result.replace(/\{\{referencedColumn\}\}/g, data.referencedColumn || 'id');

  // Handle conditionals for unique, onDelete, onUpdate
  result = result.replace(/\{\{#if unique\}\}(.*?)\{\{\/if\}\}/g, data.unique ? '$1' : '');
  result = result.replace(/\{\{#if onDelete\}\}(.*?)\{\{\/if\}\}/g, data.onDelete ? '$1' : '');
  result = result.replace(/\{\{#if onUpdate\}\}(.*?)\{\{\/if\}\}/g, data.onUpdate ? '$1' : '');

  result = result.replace(/\{\{onDelete\}\}/g, data.onDelete || 'CASCADE');
  result = result.replace(/\{\{onUpdate\}\}/g, data.onUpdate || 'CASCADE');

  return result;
}
