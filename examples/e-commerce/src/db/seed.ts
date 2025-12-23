import { db } from './connection.js'

/**
 * Seed the database with initial data for testing
 */
async function seed() {
  console.log('🌱 Seeding database...')

  // Create categories
  console.log('Creating categories...')
  await db
    .insertInto('categories')
    .values([
      { name: 'Electronics', slug: 'electronics', parent_id: null },
      { name: 'Computers', slug: 'computers', parent_id: 1 },
      { name: 'Accessories', slug: 'accessories', parent_id: 1 },
      { name: 'Clothing', slug: 'clothing', parent_id: null },
      { name: 'Home & Garden', slug: 'home-garden', parent_id: null }
    ])
    .execute()

  console.log('✅ Seed completed')
  await db.destroy()
}

seed().catch(error => {
  console.error('Seed error:', error)
  process.exit(1)
})
