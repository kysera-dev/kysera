#!/usr/bin/env tsx
/**
 * Test suite runner for real databases (PostgreSQL and MySQL)
 */

import { Kysely, PostgresDialect, MysqlDialect } from 'kysely'
import { Pool } from 'pg'
import { createPool } from 'mysql2'

// PostgreSQL test configuration
const postgresConfig = {
  host: 'localhost',
  port: 5432,
  database: 'kysera_test',
  user: 'test',
  password: 'test'
}

// MySQL test configuration
const mysqlConfig = {
  host: 'localhost',
  port: 3306,
  database: 'kysera_test',
  user: 'test',
  password: 'test'
}

interface TestResult {
  database: string
  success: boolean
  message: string
  error?: string
}

async function testPostgreSQL(): Promise<TestResult> {
  try {
    const dialect = new PostgresDialect({
      pool: new Pool(postgresConfig)
    })

    const db = new Kysely<any>({
      dialect
    })

    // Test connection
    await db.selectFrom('information_schema.tables').select('table_name').limit(1).execute()

    // Create test table
    await db.schema
      .createTable('test_users')
      .ifNotExists()
      .addColumn('id', 'serial', col => col.primaryKey())
      .addColumn('email', 'varchar(255)', col => col.notNull())
      .addColumn('name', 'varchar(255)', col => col.notNull())
      .addColumn('created_at', 'timestamp', col => col.defaultTo('now()'))
      .execute()

    // Insert test data
    const inserted = await db
      .insertInto('test_users')
      .values({
        email: 'test@example.com',
        name: 'Test User'
      })
      .returningAll()
      .execute()

    // Query test data
    const users = await db.selectFrom('test_users').selectAll().execute()

    // Clean up
    await db.schema.dropTable('test_users').ifExists().execute()

    await db.destroy()

    return {
      database: 'PostgreSQL',
      success: true,
      message: `Successfully tested PostgreSQL - inserted ${inserted.length} row(s), queried ${users.length} row(s)`
    }
  } catch (error) {
    return {
      database: 'PostgreSQL',
      success: false,
      message: 'Failed to test PostgreSQL',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function testMySQL(): Promise<TestResult> {
  try {
    const dialect = new MysqlDialect({
      pool: createPool(mysqlConfig)
    })

    const db = new Kysely<any>({
      dialect
    })

    // Test connection
    await db.selectFrom('information_schema.tables').select('table_name').limit(1).execute()

    // Create test table (MySQL doesn't support CURRENT_TIMESTAMP as default in all versions)
    await db.schema
      .createTable('test_users')
      .ifNotExists()
      .addColumn('id', 'integer', col => col.autoIncrement().primaryKey())
      .addColumn('email', 'varchar(255)', col => col.notNull())
      .addColumn('name', 'varchar(255)', col => col.notNull())
      .addColumn('created_at', 'timestamp')
      .execute()

    // Insert test data
    const result = await db
      .insertInto('test_users')
      .values({
        email: 'test@example.com',
        name: 'Test User',
        created_at: new Date()
      })
      .execute()

    // Query test data
    const users = await db.selectFrom('test_users').selectAll().execute()

    // Clean up
    await db.schema.dropTable('test_users').ifExists().execute()

    await db.destroy()

    return {
      database: 'MySQL',
      success: true,
      message: `Successfully tested MySQL - inserted row with id ${result[0]?.insertId}, queried ${users.length} row(s)`
    }
  } catch (error) {
    return {
      database: 'MySQL',
      success: false,
      message: 'Failed to test MySQL',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function runTests() {
  console.log('🚀 Testing Kysera ORM with real databases...\n')

  const results: TestResult[] = []

  // Test PostgreSQL
  console.log('📘 Testing PostgreSQL...')
  const pgResult = await testPostgreSQL()
  results.push(pgResult)
  if (pgResult.success) {
    console.log(`✅ ${pgResult.message}`)
  } else {
    console.log(`❌ ${pgResult.message}`)
    if (pgResult.error) {
      console.log(`   Error: ${pgResult.error}`)
    }
  }

  console.log()

  // Test MySQL
  console.log('🔶 Testing MySQL...')
  const mysqlResult = await testMySQL()
  results.push(mysqlResult)
  if (mysqlResult.success) {
    console.log(`✅ ${mysqlResult.message}`)
  } else {
    console.log(`❌ ${mysqlResult.message}`)
    if (mysqlResult.error) {
      console.log(`   Error: ${mysqlResult.error}`)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('📊 Test Summary:')
  console.log('='.repeat(60))

  const successCount = results.filter(r => r.success).length
  const totalCount = results.length

  results.forEach(result => {
    const icon = result.success ? '✅' : '❌'
    console.log(`${icon} ${result.database}: ${result.success ? 'PASSED' : 'FAILED'}`)
  })

  console.log('='.repeat(60))
  console.log(`Total: ${successCount}/${totalCount} tests passed`)

  if (successCount < totalCount) {
    process.exit(1)
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
