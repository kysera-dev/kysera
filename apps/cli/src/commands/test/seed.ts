import { Command } from 'commander'
import { prism, spinner, select, confirm } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { faker } from '@faker-js/faker'

export interface TestSeedOptions {
  tables?: string[]
  count?: number
  clean?: boolean
  strategy?: 'faker' | 'realistic' | 'stress' | 'minimal'
  relationships?: boolean
  locale?: string
  seed?: number
  custom?: string
  verbose?: boolean
  json?: boolean
  config?: string
}

interface SeedResult {
  tables: Array<{
    name: string
    recordsCreated: number
    relationships: string[]
    duration: number
  }>
  strategy: string
  totalRecords: number
  totalDuration: number
  seed?: number
}

interface TableSchema {
  name: string
  columns: Array<{
    name: string
    type: string
    nullable: boolean
    primaryKey: boolean
    foreignKey?: {
      table: string
      column: string
    }
  }>
}

export function testSeedCommand(): Command {
  const cmd = new Command('seed')
    .description('Seed test database with sample data')
    .option('-t, --tables <names...>', 'Specific tables to seed')
    .option('-c, --count <n>', 'Number of records per table', '100')
    .option('--clean', 'Clean tables before seeding', false)
    .option('-s, --strategy <type>', 'Seeding strategy', 'realistic')
    .option('--relationships', 'Create related records', true)
    .option('--locale <locale>', 'Faker locale', 'en')
    .option('--seed <number>', 'Random seed for reproducibility')
    .option('--custom <file>', 'Custom seeder file')
    .option('-v, --verbose', 'Verbose output', false)
    .option('--json', 'Output as JSON', false)
    .option('--config <path>', 'Path to configuration file')
    .action(async (options: TestSeedOptions) => {
      try {
        await seedTestDatabase(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to seed test database: ${error instanceof Error ? error.message : String(error)}`,
          'TEST_SEED_ERROR'
        )
      }
    })

  return cmd
}

async function seedTestDatabase(options: TestSeedOptions): Promise<void> {
  const startTime = Date.now()

  // Load configuration
  const config = await loadConfig(options.config)

  if (!config?.database) {
    throw new CLIError(
      'Database configuration not found',
      'CONFIG_ERROR',
      [
        'Create a kysera.config.ts file with database configuration',
        'Or specify a config file with --config option'
      ]
    )
  }

  // Set up faker
  if (options.seed) {
    faker.seed(options.seed)
  }
  faker.locale = options.locale || 'en'

  const seedSpinner = spinner()
  seedSpinner.start('Connecting to database...')

  const result: SeedResult = {
    tables: [],
    strategy: options.strategy || 'realistic',
    totalRecords: 0,
    totalDuration: 0,
    seed: options.seed
  }

  try {
    // Get database connection
    const db = await getDatabaseConnection(config.database)

    if (!db) {
      throw new CLIError(
        'Failed to connect to database',
        'DATABASE_ERROR'
      )
    }

    // If custom seeder is specified
    if (options.custom) {
      seedSpinner.text = 'Running custom seeder...'
      await runCustomSeeder(db, options.custom, options)
      seedSpinner.succeed('Custom seeder executed')
      await db.destroy()
      return
    }

    // Get table schemas
    seedSpinner.text = 'Analyzing database schema...'
    const schemas = await getTableSchemas(db, options.tables)

    if (schemas.length === 0) {
      seedSpinner.warn('No tables found to seed')
      await db.destroy()
      return
    }

    seedSpinner.succeed(`Found ${schemas.length} table${schemas.length !== 1 ? 's' : ''} to seed`)

    // Clean tables if requested
    if (options.clean) {
      const cleanSpinner = spinner()
      cleanSpinner.start('Cleaning tables...')

      for (const schema of schemas) {
        await cleanTable(db, schema.name)
      }

      cleanSpinner.succeed('Tables cleaned')
    }

    // Sort tables by dependencies
    const sortedSchemas = sortTablesByDependencies(schemas)

    // Seed each table
    const count = parseInt(options.count as any) || 100

    for (const schema of sortedSchemas) {
      const tableStartTime = Date.now()
      seedSpinner.start(`Seeding ${schema.name}...`)

      const tableResult = await seedTable(
        db,
        schema,
        count,
        options.strategy || 'realistic',
        options.relationships !== false
      )

      const duration = Date.now() - tableStartTime
      result.tables.push({
        name: schema.name,
        recordsCreated: tableResult.recordsCreated,
        relationships: tableResult.relationships,
        duration
      })

      result.totalRecords += tableResult.recordsCreated
      seedSpinner.succeed(`Seeded ${schema.name}: ${tableResult.recordsCreated} records`)

      if (options.verbose) {
        console.log(prism.gray(`  Duration: ${duration}ms`))
        if (tableResult.relationships.length > 0) {
          console.log(prism.gray(`  Relationships: ${tableResult.relationships.join(', ')}`))
        }
      }
    }

    result.totalDuration = Date.now() - startTime

    // Close database connection
    await db.destroy()

    // Display results
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      displaySeedResults(result, options)
    }

  } catch (error) {
    seedSpinner.fail('Seeding failed')
    throw error
  }
}

async function getTableSchemas(db: any, tables?: string[]): Promise<TableSchema[]> {
  const schemas: TableSchema[] = []

  try {
    let tableList: string[] = []

    if (tables && tables.length > 0) {
      tableList = tables
    } else {
      // Get all tables
      if (db.dialectName === 'postgres') {
        const result = await db
          .selectFrom('information_schema.tables')
          .select('table_name')
          .where('table_schema', '=', 'public')
          .where('table_type', '=', 'BASE TABLE')
          .execute()

        tableList = result.map((r: any) => r.table_name)
      } else if (db.dialectName === 'mysql') {
        const result = await db.raw(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = DATABASE()
          AND table_type = 'BASE TABLE'
        `)

        tableList = result[0].map((r: any) => r.TABLE_NAME || r.table_name)
      } else if (db.dialectName === 'sqlite') {
        const result = await db.raw(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        `)

        tableList = result.map((r: any) => r.name)
      }
    }

    // Get schema for each table
    for (const tableName of tableList) {
      const columns = await getTableColumns(db, tableName)
      schemas.push({
        name: tableName,
        columns
      })
    }

  } catch (error) {
    logger.debug(`Failed to get table schemas: ${error}`)
  }

  return schemas
}

async function getTableColumns(db: any, tableName: string): Promise<TableSchema['columns']> {
  const columns: TableSchema['columns'] = []

  try {
    if (db.dialectName === 'postgres') {
      const result = await db
        .selectFrom('information_schema.columns as c')
        .leftJoin(
          'information_schema.key_column_usage as k',
          (join: any) => join
            .on('c.table_name', '=', 'k.table_name')
            .on('c.column_name', '=', 'k.column_name')
        )
        .leftJoin(
          'information_schema.table_constraints as tc',
          'k.constraint_name',
          'tc.constraint_name'
        )
        .select([
          'c.column_name',
          'c.data_type',
          'c.is_nullable',
          'tc.constraint_type',
          'k.constraint_name'
        ])
        .where('c.table_name', '=', tableName)
        .where('c.table_schema', '=', 'public')
        .execute()

      for (const col of result) {
        columns.push({
          name: col.column_name,
          type: col.data_type,
          nullable: col.is_nullable === 'YES',
          primaryKey: col.constraint_type === 'PRIMARY KEY'
        })
      }
    } else if (db.dialectName === 'mysql') {
      const result = await db.raw(`
        SELECT
          COLUMN_NAME as column_name,
          DATA_TYPE as data_type,
          IS_NULLABLE as is_nullable,
          COLUMN_KEY as column_key
        FROM information_schema.columns
        WHERE table_name = ?
        AND table_schema = DATABASE()
      `, [tableName])

      for (const col of result[0]) {
        columns.push({
          name: col.column_name,
          type: col.data_type,
          nullable: col.is_nullable === 'YES',
          primaryKey: col.column_key === 'PRI'
        })
      }
    } else if (db.dialectName === 'sqlite') {
      const result = await db.raw(`PRAGMA table_info(${tableName})`)

      for (const col of result) {
        columns.push({
          name: col.name,
          type: col.type,
          nullable: col.notnull === 0,
          primaryKey: col.pk === 1
        })
      }
    }
  } catch (error) {
    logger.debug(`Failed to get columns for ${tableName}: ${error}`)
  }

  return columns
}

function sortTablesByDependencies(schemas: TableSchema[]): TableSchema[] {
  // Simple topological sort based on foreign keys
  const sorted: TableSchema[] = []
  const visited = new Set<string>()

  function visit(schema: TableSchema) {
    if (visited.has(schema.name)) return
    visited.add(schema.name)

    // Visit dependencies first
    for (const column of schema.columns) {
      if (column.foreignKey) {
        const dependency = schemas.find(s => s.name === column.foreignKey!.table)
        if (dependency && !visited.has(dependency.name)) {
          visit(dependency)
        }
      }
    }

    sorted.push(schema)
  }

  for (const schema of schemas) {
    visit(schema)
  }

  return sorted
}

async function cleanTable(db: any, tableName: string): Promise<void> {
  try {
    if (db.dialectName === 'postgres' || db.dialectName === 'mysql') {
      await db.raw(`TRUNCATE TABLE ${tableName} CASCADE`)
    } else {
      await db.deleteFrom(tableName).execute()
    }
  } catch (error) {
    logger.debug(`Failed to clean table ${tableName}: ${error}`)
  }
}

async function seedTable(
  db: any,
  schema: TableSchema,
  count: number,
  strategy: string,
  createRelationships: boolean
): Promise<{ recordsCreated: number; relationships: string[] }> {
  const records: any[] = []
  const relationships: string[] = []

  // Adjust count based on strategy
  let actualCount = count
  if (strategy === 'minimal') {
    actualCount = Math.min(10, count)
  } else if (strategy === 'stress') {
    actualCount = count * 10
  }

  // Generate records
  for (let i = 0; i < actualCount; i++) {
    const record = await generateRecord(db, schema, strategy, createRelationships)

    if (record) {
      records.push(record)

      // Track relationships
      for (const column of schema.columns) {
        if (column.foreignKey && record[column.name]) {
          if (!relationships.includes(column.foreignKey.table)) {
            relationships.push(column.foreignKey.table)
          }
        }
      }
    }
  }

  // Insert records in batches
  const batchSize = 100
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    await db.insertInto(schema.name).values(batch).execute()
  }

  return {
    recordsCreated: records.length,
    relationships
  }
}

async function generateRecord(
  db: any,
  schema: TableSchema,
  strategy: string,
  createRelationships: boolean
): Promise<any> {
  const record: any = {}

  for (const column of schema.columns) {
    // Skip auto-increment primary keys
    if (column.primaryKey && column.type.includes('int')) {
      continue
    }

    // Skip nullable columns sometimes
    if (column.nullable && Math.random() > 0.8) {
      continue
    }

    // Handle foreign keys
    if (column.foreignKey && createRelationships) {
      const foreignValue = await getRandomForeignKey(
        db,
        column.foreignKey.table,
        column.foreignKey.column
      )
      if (foreignValue) {
        record[column.name] = foreignValue
      }
      continue
    }

    // Generate value based on column name and type
    const value = generateColumnValue(column, strategy)
    if (value !== undefined) {
      record[column.name] = value
    }
  }

  return record
}

function generateColumnValue(column: TableSchema['columns'][0], strategy: string): any {
  const { name, type } = column

  // Common patterns based on column name
  if (name === 'email' || name.includes('email')) {
    return faker.internet.email().toLowerCase()
  }
  if (name === 'username' || name.includes('username')) {
    return faker.internet.userName()
  }
  if (name === 'password' || name.includes('password')) {
    return faker.internet.password()
  }
  if (name === 'first_name' || name.includes('first_name')) {
    return faker.person.firstName()
  }
  if (name === 'last_name' || name.includes('last_name')) {
    return faker.person.lastName()
  }
  if (name === 'name' || name.includes('name')) {
    return faker.person.fullName()
  }
  if (name === 'phone' || name.includes('phone')) {
    return faker.phone.number()
  }
  if (name === 'address' || name.includes('address')) {
    return faker.location.streetAddress()
  }
  if (name === 'city' || name.includes('city')) {
    return faker.location.city()
  }
  if (name === 'country' || name.includes('country')) {
    return faker.location.country()
  }
  if (name === 'zip' || name === 'postal_code' || name.includes('zip')) {
    return faker.location.zipCode()
  }
  if (name === 'url' || name.includes('url')) {
    return faker.internet.url()
  }
  if (name === 'avatar' || name.includes('avatar')) {
    return faker.image.avatar()
  }
  if (name === 'description' || name.includes('description')) {
    return faker.lorem.paragraph()
  }
  if (name === 'title' || name.includes('title')) {
    return faker.lorem.sentence()
  }
  if (name === 'content' || name.includes('content')) {
    return faker.lorem.paragraphs(3)
  }
  if (name === 'status') {
    return faker.helpers.arrayElement(['active', 'inactive', 'pending', 'completed'])
  }
  if (name === 'created_at' || name === 'updated_at') {
    return new Date()
  }

  // Generate based on data type
  if (type.includes('int') || type.includes('number')) {
    if (strategy === 'stress') {
      return faker.number.int({ min: 1, max: 1000000 })
    }
    return faker.number.int({ min: 1, max: 1000 })
  }

  if (type.includes('decimal') || type.includes('float') || type.includes('double')) {
    return faker.number.float({ min: 0, max: 1000, precision: 2 })
  }

  if (type.includes('bool')) {
    return faker.datatype.boolean()
  }

  if (type.includes('date') || type.includes('time')) {
    return faker.date.recent()
  }

  if (type.includes('json')) {
    return JSON.stringify({
      id: faker.string.uuid(),
      data: faker.lorem.words(3)
    })
  }

  if (type.includes('uuid')) {
    return faker.string.uuid()
  }

  if (type.includes('text')) {
    if (strategy === 'stress') {
      return faker.lorem.paragraphs(10)
    }
    return faker.lorem.paragraph()
  }

  if (type.includes('varchar') || type.includes('char') || type.includes('string')) {
    if (strategy === 'stress') {
      return faker.lorem.words(20)
    }
    return faker.lorem.words(3)
  }

  // Default
  return faker.lorem.word()
}

async function getRandomForeignKey(
  db: any,
  tableName: string,
  columnName: string
): Promise<any> {
  try {
    const result = await db
      .selectFrom(tableName)
      .select(columnName)
      .orderBy(db.fn('random'))
      .limit(1)
      .executeTakeFirst()

    return result ? result[columnName] : null
  } catch {
    return null
  }
}

async function runCustomSeeder(db: any, seederPath: string, options: TestSeedOptions): Promise<void> {
  try {
    const resolvedPath = path.resolve(seederPath)
    const seeder = await import(resolvedPath)

    if (seeder.seed) {
      await seeder.seed(db, {
        faker,
        count: parseInt(options.count as any) || 100,
        locale: options.locale,
        seed: options.seed
      })
    } else {
      throw new Error('Custom seeder must export a seed function')
    }
  } catch (error) {
    throw new CLIError(
      `Failed to run custom seeder: ${error}`,
      'SEEDER_ERROR'
    )
  }
}

function displaySeedResults(result: SeedResult, options: TestSeedOptions): void {
  console.log('')
  console.log(prism.bold('🌱 Test Database Seeded'))
  console.log(prism.gray('═'.repeat(50)))

  console.log('')
  console.log(prism.cyan('Summary:'))
  console.log(`  Strategy: ${result.strategy}`)
  console.log(`  Tables seeded: ${result.tables.length}`)
  console.log(`  Total records: ${result.totalRecords}`)
  console.log(`  Duration: ${result.totalDuration}ms`)

  if (result.seed) {
    console.log(`  Random seed: ${result.seed}`)
  }

  console.log('')
  console.log(prism.cyan('Tables:'))

  for (const table of result.tables) {
    console.log(`  ${table.name}: ${table.recordsCreated} records (${table.duration}ms)`)
    if (table.relationships.length > 0) {
      console.log(prism.gray(`    → Relationships: ${table.relationships.join(', ')}`))
    }
  }

  // Tips based on strategy
  console.log('')
  console.log(prism.cyan('Tips:'))

  if (result.strategy === 'realistic') {
    console.log('  • Realistic data generated for testing')
  } else if (result.strategy === 'minimal') {
    console.log('  • Minimal dataset for quick testing')
  } else if (result.strategy === 'stress') {
    console.log('  • Large dataset for stress testing')
    console.log('  • Monitor performance during tests')
  } else if (result.strategy === 'faker') {
    console.log('  • Random data generated with Faker.js')
  }

  if (result.seed) {
    console.log(`  • Use --seed ${result.seed} to reproduce this dataset`)
  }

  console.log('  • Use --clean to truncate before seeding')
  console.log('  • Use --custom to run custom seeders')
}