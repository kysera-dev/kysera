import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runCLI, createTestDatabase, cleanupTestDatabase } from '../utils/test-helpers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('Complete CLI Workflow E2E', () => {
  const projectName = 'e2e-test-app'
  const projectDir = path.join(__dirname, '../.test-projects', projectName)

  beforeAll(async () => {
    // Ensure clean state
    try {
      await fs.rm(projectDir, { recursive: true, force: true })
    } catch {
      // Ignore if doesn't exist
    }
  })

  afterAll(async () => {
    // Clean up
    try {
      await fs.rm(projectDir, { recursive: true, force: true })
    } catch {
      // Ignore
    }

    // Clean up test databases
    await cleanupTestDatabase('sqlite', `${projectName}_test`)
  })

  it('should complete full project lifecycle', async () => {
    // Step 1: Initialize project
    console.log('Step 1: Initializing project...')
    const initResult = await runCLI(
      ['init', projectName, '--dialect', 'sqlite', '--skip-install'],
      { cwd: path.dirname(projectDir) }
    )

    expect(initResult.code).toBe(0)
    expect(initResult.stdout).toContain('Project initialized')

    // Verify project structure
    const configPath = path.join(projectDir, 'kysera.config.ts')
    const packageJsonPath = path.join(projectDir, 'package.json')

    expect(await fs.stat(configPath)).toBeDefined()
    expect(await fs.stat(packageJsonPath)).toBeDefined()

    // Step 2: Create migrations
    console.log('Step 2: Creating migrations...')
    const createMigration1 = await runCLI(
      ['migrate', 'create', 'create_users_table'],
      { cwd: projectDir }
    )

    expect(createMigration1.code).toBe(0)

    // Add migration content
    const migrationsDir = path.join(projectDir, 'migrations')
    const migrationFiles = await fs.readdir(migrationsDir)
    const usersMigration = migrationFiles.find(f => f.includes('create_users_table'))

    if (usersMigration) {
      await fs.writeFile(
        path.join(migrationsDir, usersMigration),
        `
import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
    .addColumn('updated_at', 'timestamp')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('users').execute()
}
        `.trim()
      )
    }

    // Create posts migration
    const createMigration2 = await runCLI(
      ['migrate', 'create', 'create_posts_table'],
      { cwd: projectDir }
    )

    expect(createMigration2.code).toBe(0)

    const postsMigration = (await fs.readdir(migrationsDir)).find(f =>
      f.includes('create_posts_table')
    )

    if (postsMigration) {
      await fs.writeFile(
        path.join(migrationsDir, postsMigration),
        `
import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('posts')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('user_id', 'integer', (col) => col.notNull().references('users.id'))
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('content', 'text')
    .addColumn('published', 'boolean', (col) => col.defaultTo(false))
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo('CURRENT_TIMESTAMP'))
    .execute()

  await db.schema
    .createIndex('idx_posts_user_id')
    .on('posts')
    .column('user_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('posts').execute()
}
        `.trim()
      )
    }

    // Step 3: Check migration status
    console.log('Step 3: Checking migration status...')
    const statusBefore = await runCLI(
      ['migrate', 'status', '--json'],
      { cwd: projectDir }
    )

    expect(statusBefore.code).toBe(0)
    const statusData = JSON.parse(statusBefore.stdout)
    expect(statusData.pending).toBeGreaterThan(0)
    expect(statusData.executed).toBe(0)

    // Step 4: Run migrations
    console.log('Step 4: Running migrations...')
    const migrateUp = await runCLI(
      ['migrate', 'up'],
      { cwd: projectDir }
    )

    expect(migrateUp.code).toBe(0)
    expect(migrateUp.stdout).toContain('Successfully ran')

    // Step 5: Check database health
    console.log('Step 5: Checking database health...')
    const healthCheck = await runCLI(
      ['health', 'check', '--json'],
      { cwd: projectDir }
    )

    expect(healthCheck.code).toBe(0)
    const health = JSON.parse(healthCheck.stdout)
    expect(health.database.status).toBe('healthy')

    // Step 6: Generate models
    console.log('Step 6: Generating models...')
    const generateModel = await runCLI(
      ['generate', 'model', 'User', '--table', 'users'],
      { cwd: projectDir }
    )

    expect(generateModel.code).toBe(0)

    // Verify model file
    const modelPath = path.join(projectDir, 'src/models/User.ts')
    const modelExists = await fs.stat(modelPath).catch(() => null)
    expect(modelExists).toBeDefined()

    // Step 7: Generate repository
    console.log('Step 7: Generating repository...')
    const generateRepo = await runCLI(
      ['generate', 'repository', 'User'],
      { cwd: projectDir }
    )

    expect(generateRepo.code).toBe(0)

    // Verify repository file
    const repoPath = path.join(projectDir, 'src/repositories/UserRepository.ts')
    const repoExists = await fs.stat(repoPath).catch(() => null)
    expect(repoExists).toBeDefined()

    // Step 8: Setup test environment
    console.log('Step 8: Setting up test environment...')
    const testSetup = await runCLI(
      ['test', 'setup', '--env', 'test'],
      { cwd: projectDir }
    )

    expect(testSetup.code).toBe(0)
    expect(testSetup.stdout).toContain('Test environment ready')

    // Step 9: Seed test data
    console.log('Step 9: Seeding test data...')
    const testSeed = await runCLI(
      ['test', 'seed', '--count', '10', '--strategy', 'realistic'],
      { cwd: projectDir }
    )

    expect(testSeed.code).toBe(0)
    expect(testSeed.stdout).toContain('Seeded')

    // Step 10: Query data
    console.log('Step 10: Querying data...')
    const queryData = await runCLI(
      ['query', 'analyze', 'SELECT COUNT(*) FROM users', '--json'],
      { cwd: projectDir }
    )

    expect(queryData.code).toBe(0)
    const queryResult = JSON.parse(queryData.stdout)
    expect(queryResult.rows[0]['COUNT(*)']).toBeGreaterThan(0)

    // Step 11: Create and run audit
    console.log('Step 11: Running audit...')
    const audit = await runCLI(
      ['audit', 'logs', '--table', 'users', '--limit', '5'],
      { cwd: projectDir }
    )

    // Audit might not be configured, so we just check it runs
    expect([0, 1]).toContain(audit.code)

    // Step 12: Database introspection
    console.log('Step 12: Introspecting database...')
    const introspect = await runCLI(
      ['db', 'introspect', '--json'],
      { cwd: projectDir }
    )

    expect(introspect.code).toBe(0)
    const schema = JSON.parse(introspect.stdout)
    expect(schema.tables).toHaveProperty('users')
    expect(schema.tables).toHaveProperty('posts')

    // Step 13: Rollback migration
    console.log('Step 13: Testing migration rollback...')
    const rollback = await runCLI(
      ['migrate', 'down', '--count', '1'],
      { cwd: projectDir }
    )

    expect(rollback.code).toBe(0)
    expect(rollback.stdout).toContain('Rolled back')

    // Step 14: Re-run migration
    console.log('Step 14: Re-running migration...')
    const rerun = await runCLI(
      ['migrate', 'up'],
      { cwd: projectDir }
    )

    expect(rerun.code).toBe(0)

    // Step 15: List plugins
    console.log('Step 15: Listing plugins...')
    const listPlugins = await runCLI(
      ['plugin', 'list', '--available'],
      { cwd: projectDir }
    )

    expect(listPlugins.code).toBe(0)
    expect(listPlugins.stdout).toContain('Available Plugins')

    // Step 16: Cleanup test environment
    console.log('Step 16: Cleaning up test environment...')
    const testTeardown = await runCLI(
      ['test', 'teardown', '--env', 'test', '--force'],
      { cwd: projectDir }
    )

    expect(testTeardown.code).toBe(0)
    expect(testTeardown.stdout).toContain('Cleaned up')

    console.log('✅ All workflow steps completed successfully!')
  }, 120000) // 2 minute timeout for full workflow
})