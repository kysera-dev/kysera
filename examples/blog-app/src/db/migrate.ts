import { db } from './connection.js'
import { migrations } from './migrations.js'
import { sql } from 'kysely'

async function setupMigrations() {
  await db.schema
    .createTable('migrations')
    .ifNotExists()
    .addColumn('name', 'varchar(255)', col => col.primaryKey())
    .addColumn('executed_at', 'timestamp', col =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()
}

async function getExecutedMigrations(): Promise<string[]> {
  const rows = await db
    .selectFrom('migrations')
    .select('name')
    .orderBy('executed_at', 'asc')
    .execute()

  return rows.map((r: { name: string }) => r.name)
}

async function runMigrations() {
  console.log('🔄 Running migrations...')

  await setupMigrations()
  const executed = await getExecutedMigrations()

  for (const migration of migrations) {
    if (executed.includes(migration.name)) {
      console.log(`✓ ${migration.name} (already executed)`)
      continue
    }

    try {
      console.log(`↑ Running ${migration.name}...`)
      await migration.up(db)

      await db
        .insertInto('migrations')
        .values({ name: migration.name })
        .execute()

      console.log(`✓ ${migration.name} completed`)
    } catch (error) {
      console.error(`✗ ${migration.name} failed:`, error)
      throw error
    }
  }

  console.log('✅ All migrations completed')
  await db.destroy()
}

// Run migrations
runMigrations().catch(error => {
  console.error('Migration error:', error)
  process.exit(1)
})