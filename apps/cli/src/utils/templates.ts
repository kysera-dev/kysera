import Handlebars from 'handlebars';
import { readFile } from 'fs-extra';
import { resolve, dirname } from 'node:path';

// Register helpers
Handlebars.registerHelper('camelCase', (str: string) => {
  return str.replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
});

Handlebars.registerHelper('pascalCase', (str: string) => {
  const camel = str.replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
  return camel.charAt(0).toUpperCase() + camel.slice(1);
});

Handlebars.registerHelper('kebabCase', (str: string) => {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
});

Handlebars.registerHelper('snakeCase', (str: string) => {
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
});

Handlebars.registerHelper('upperCase', (str: string) => {
  return str.toUpperCase();
});

Handlebars.registerHelper('lowerCase', (str: string) => {
  return str.toLowerCase();
});

Handlebars.registerHelper('pluralize', (str: string) => {
  // Simple pluralization
  if (str.endsWith('y')) {
    return str.slice(0, -1) + 'ies';
  }
  if (str.endsWith('s')) {
    return str + 'es';
  }
  return str + 's';
});

Handlebars.registerHelper('singularize', (str: string) => {
  // Simple singularization
  if (str.endsWith('ies')) {
    return str.slice(0, -3) + 'y';
  }
  if (str.endsWith('es')) {
    return str.slice(0, -2);
  }
  if (str.endsWith('s')) {
    return str.slice(0, -1);
  }
  return str;
});

Handlebars.registerHelper('timestamp', () => {
  return Date.now();
});

Handlebars.registerHelper('date', (format?: string) => {
  const now = new Date();
  if (!format || format === 'iso') {
    return now.toISOString();
  }
  if (format === 'date') {
    return now.toLocaleDateString();
  }
  if (format === 'time') {
    return now.toLocaleTimeString();
  }
  return now.toLocaleString();
});

Handlebars.registerHelper('eq', (a: any, b: any) => {
  return a === b;
});

Handlebars.registerHelper('ne', (a: any, b: any) => {
  return a !== b;
});

Handlebars.registerHelper('lt', (a: any, b: any) => {
  return a < b;
});

Handlebars.registerHelper('gt', (a: any, b: any) => {
  return a > b;
});

Handlebars.registerHelper('lte', (a: any, b: any) => {
  return a <= b;
});

Handlebars.registerHelper('gte', (a: any, b: any) => {
  return a >= b;
});

Handlebars.registerHelper('and', (...args: any[]) => {
  // Last argument is the Handlebars options object
  args.pop();
  return args.every(Boolean);
});

Handlebars.registerHelper('or', (...args: any[]) => {
  // Last argument is the Handlebars options object
  args.pop();
  return args.some(Boolean);
});

Handlebars.registerHelper('not', (value: any) => {
  return !value;
});

Handlebars.registerHelper('includes', (array: any[], value: any) => {
  return Array.isArray(array) && array.includes(value);
});

Handlebars.registerHelper('join', (array: any[], separator: string = ', ') => {
  return Array.isArray(array) ? array.join(separator) : '';
});

Handlebars.registerHelper('json', (obj: any, indent?: number) => {
  return JSON.stringify(obj, null, indent || 2);
});

export interface TemplateOptions {
  partials?: Record<string, string>;
  helpers?: Record<string, Handlebars.HelperDelegate>;
}

/**
 * Compile a template string
 */
export function compileTemplate(template: string, options: TemplateOptions = {}): Handlebars.TemplateDelegate {
  // Register partials
  if (options.partials) {
    for (const [name, partial] of Object.entries(options.partials)) {
      Handlebars.registerPartial(name, partial);
    }
  }

  // Register custom helpers
  if (options.helpers) {
    for (const [name, helper] of Object.entries(options.helpers)) {
      Handlebars.registerHelper(name, helper);
    }
  }

  return Handlebars.compile(template);
}

/**
 * Render a template string with data
 */
export function renderTemplate(template: string, data: any, options: TemplateOptions = {}): string {
  const compiled = compileTemplate(template, options);
  return compiled(data);
}

/**
 * Load and compile a template from file
 */
export async function loadTemplate(
  filePath: string,
  options: TemplateOptions = {}
): Promise<Handlebars.TemplateDelegate> {
  const template = await readFile(filePath, 'utf8');
  return compileTemplate(template, options);
}

/**
 * Load and render a template from file
 */
export async function renderTemplateFile(filePath: string, data: any, options: TemplateOptions = {}): Promise<string> {
  const compiled = await loadTemplate(filePath, options);
  return compiled(data);
}

/**
 * Create a template renderer with preset options
 */
export class TemplateRenderer {
  private partials: Record<string, string> = {};
  private helpers: Record<string, Handlebars.HelperDelegate> = {};
  private templateCache: Map<string, Handlebars.TemplateDelegate> = new Map();

  constructor(options: TemplateOptions = {}) {
    if (options.partials) {
      this.registerPartials(options.partials);
    }
    if (options.helpers) {
      this.registerHelpers(options.helpers);
    }
  }

  registerPartial(name: string, partial: string): void {
    this.partials[name] = partial;
    Handlebars.registerPartial(name, partial);
  }

  registerPartials(partials: Record<string, string>): void {
    for (const [name, partial] of Object.entries(partials)) {
      this.registerPartial(name, partial);
    }
  }

  registerHelper(name: string, helper: Handlebars.HelperDelegate): void {
    this.helpers[name] = helper;
    Handlebars.registerHelper(name, helper);
  }

  registerHelpers(helpers: Record<string, Handlebars.HelperDelegate>): void {
    for (const [name, helper] of Object.entries(helpers)) {
      this.registerHelper(name, helper);
    }
  }

  compile(template: string, cache: boolean = true): Handlebars.TemplateDelegate {
    if (cache) {
      const cached = this.templateCache.get(template);
      if (cached) {
        return cached;
      }
    }

    const compiled = Handlebars.compile(template);

    if (cache) {
      this.templateCache.set(template, compiled);
    }

    return compiled;
  }

  render(template: string, data: any): string {
    const compiled = this.compile(template);
    return compiled(data);
  }

  async renderFile(filePath: string, data: any): Promise<string> {
    const absolutePath = resolve(filePath);
    let compiled = this.templateCache.get(absolutePath);

    if (!compiled) {
      const template = await readFile(absolutePath, 'utf8');
      compiled = this.compile(template, false);
      this.templateCache.set(absolutePath, compiled);
    }

    return compiled(data);
  }

  clearCache(): void {
    this.templateCache.clear();
  }
}

/**
 * Create a template renderer
 */
export function createTemplateRenderer(options: TemplateOptions = {}): TemplateRenderer {
  return new TemplateRenderer(options);
}

/**
 * Built-in templates
 */
export const TEMPLATES = {
  migration: `import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // TODO: Implement migration
  {{#if table}}
  await db.schema
    .createTable('{{table}}')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    {{#each columns}}
    .addColumn('{{this.name}}', '{{this.type}}'{{#if this.nullable}}, (col) => col.notNull(){{/if}})
    {{/each}}
    .execute()
  {{/if}}
}

export async function down(db: Kysely<any>): Promise<void> {
  // TODO: Implement rollback
  {{#if table}}
  await db.schema.dropTable('{{table}}').execute()
  {{/if}}
}
`,

  repository: `import { createRepositoryFactory } from '@kysera/repository'
import { db } from '../database'
import type { {{pascalCase name}} } from '../models/{{kebabCase name}}'
import { Create{{pascalCase name}}Schema, Update{{pascalCase name}}Schema } from '../schemas/{{kebabCase name}}.schema'

const factory = createRepositoryFactory(db)

export const {{camelCase name}}Repository = factory.create<'{{table}}', {{pascalCase name}}>({
  tableName: '{{table}}',
  mapRow: (row) => ({
    // TODO: Map database row to entity
    {{#each columns}}
    {{camelCase this.name}}: row.{{snakeCase this.name}},
    {{/each}}
  }),
  schemas: {
    create: Create{{pascalCase name}}Schema,
    update: Update{{pascalCase name}}Schema
  }
})
`,

  model: `import { Generated } from 'kysely'

export interface {{pascalCase name}} {
  {{#each columns}}
  {{camelCase this.name}}: {{this.tsType}}{{#if this.nullable}} | null{{/if}}
  {{/each}}
}

export interface {{pascalCase name}}Table {
  {{#each columns}}
  {{snakeCase this.name}}: {{#if this.generated}}Generated<{{this.tsType}}>{{else}}{{this.tsType}}{{#if this.nullable}} | null{{/if}}{{/if}}
  {{/each}}
}

export interface New{{pascalCase name}} {
  {{#each columns}}
  {{#unless this.generated}}
  {{camelCase this.name}}{{#if this.nullable}}?{{/if}}: {{this.tsType}}{{#if this.nullable}} | null{{/if}}
  {{/unless}}
  {{/each}}
}

export interface {{pascalCase name}}Update {
  {{#each columns}}
  {{#unless this.generated}}
  {{camelCase this.name}}?: {{this.tsType}}{{#if this.nullable}} | null{{/if}}
  {{/unless}}
  {{/each}}
}
`,

  schema: `import { z } from 'zod'

export const Create{{pascalCase name}}Schema = z.object({
  {{#each columns}}
  {{#unless this.generated}}
  {{camelCase this.name}}: {{this.zodType}}{{#if this.nullable}}.nullable(){{/if}}{{#if this.optional}}.optional(){{/if}},
  {{/unless}}
  {{/each}}
})

export const Update{{pascalCase name}}Schema = Create{{pascalCase name}}Schema.partial()

export type Create{{pascalCase name}}Input = z.infer<typeof Create{{pascalCase name}}Schema>
export type Update{{pascalCase name}}Input = z.infer<typeof Update{{pascalCase name}}Schema>
`,
};
