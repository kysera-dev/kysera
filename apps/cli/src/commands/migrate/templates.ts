export const MIGRATION_TEMPLATES = {
  default: `import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // TODO: Implement migration
}

export async function down(db: Kysely<any>): Promise<void> {
  // TODO: Implement rollback
}
`,

  'create-table': `import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('{{table}}')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    {{#each columns}}
    .addColumn('{{this.name}}', '{{this.type}}'{{#if this.nullable}}{{else}}, (col) => col.notNull(){{/if}})
    {{/each}}
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql\`CURRENT_TIMESTAMP\`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql\`CURRENT_TIMESTAMP\`))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('{{table}}').execute()
}
`,

  'alter-table': `import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('{{table}}')
    // TODO: Add alterations
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('{{table}}')
    // TODO: Revert alterations
    .execute()
}
`,

  'add-columns': `import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('{{table}}')
    {{#each columns}}
    .addColumn('{{this.name}}', '{{this.type}}'{{#if this.nullable}}{{else}}, (col) => col.notNull(){{/if}}{{#if this.defaultValue}}.defaultTo({{this.defaultValue}}){{/if}})
    {{/each}}
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('{{table}}')
    {{#each columns}}
    .dropColumn('{{this.name}}')
    {{/each}}
    .execute()
}
`,

  'drop-columns': `import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('{{table}}')
    {{#each columns}}
    .dropColumn('{{this.name}}')
    {{/each}}
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('{{table}}')
    {{#each columns}}
    .addColumn('{{this.name}}', '{{this.type}}'{{#if this.nullable}}{{else}}, (col) => col.notNull(){{/if}})
    {{/each}}
    .execute()
}
`,

  'create-index': `import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createIndex('{{table}}_{{#each columns}}{{this}}_{{/each}}idx')
    .on('{{table}}')
    {{#each columns}}
    .column('{{this}}')
    {{/each}}
    {{#if unique}}.unique(){{/if}}
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('{{table}}_{{#each columns}}{{this}}_{{/each}}idx')
    .execute()
}
`,

  'drop-index': `import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('{{indexName}}')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .createIndex('{{indexName}}')
    .on('{{table}}')
    {{#each columns}}
    .column('{{this}}')
    {{/each}}
    {{#if unique}}.unique(){{/if}}
    .execute()
}
`,

  'add-foreign-key': `import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('{{table}}')
    .addForeignKeyConstraint('fk_{{table}}_{{column}}', ['{{column}}'], '{{referencedTable}}', ['{{referencedColumn}}'])
    {{#if onDelete}}.onDelete('{{onDelete}}'){{/if}}
    {{#if onUpdate}}.onUpdate('{{onUpdate}}'){{/if}}
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('{{table}}')
    .dropConstraint('fk_{{table}}_{{column}}')
    .execute()
}
`,

  'seed-data': `import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // Insert seed data
  await db
    .insertInto('{{table}}')
    .values([
      // TODO: Add seed data
    ])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  // Remove seed data
  await db
    .deleteFrom('{{table}}')
    // TODO: Add conditions to identify seed data
    .execute()
}
`
}

export interface ParsedColumn {
  name: string
  type: string
  nullable: boolean
  defaultValue?: string | undefined
}

/**
 * Parse column definitions from a string
 * Format: "name:type:nullable:default"
 * Example: "email:varchar(255):false:null", "age:integer:true:0"
 */
export function parseColumns(columnsStr: string): ParsedColumn[] {
  if (!columnsStr) return []

  return columnsStr.split(',').map(col => {
    const [name = '', type = '', nullable = '', defaultValue] = col.trim().split(':')
    return {
      name: name === '' ? 'column' : name,
      type: type === '' ? 'varchar(255)' : type,
      nullable: nullable === 'true',
      defaultValue
    }
  })
}
