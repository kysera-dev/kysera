import { db, pool } from './db/connection.js'
import { createUserRepository } from './repositories/user.repository.js'
import { paginate } from '@kysera/core'
import { checkDatabaseHealth } from '@kysera/infra'

async function main() {
  console.log('🚀 Blog App Example - Kysera ORM')

  // Check database health
  const health = await checkDatabaseHealth(db, pool)
  console.log('Database health:', health)

  // Create repositories
  const userRepo = createUserRepository(db)

  // Example: Create a user
  console.log('\n📝 Creating user...')
  const newUser = await userRepo.create({
    email: 'john@example.com',
    name: 'John Doe'
  })
  console.log('Created user:', newUser)

  // Example: Find user by email
  console.log('\n🔍 Finding user by email...')
  const foundUser = await userRepo.findByEmail('john@example.com')
  console.log('Found user:', foundUser)

  // Example: Update user
  console.log('\n✏️ Updating user...')
  if (foundUser) {
    const updatedUser = await userRepo.update(foundUser.id, {
      name: 'John Updated'
    })
    console.log('Updated user:', updatedUser)
  }

  // Example: List all users with pagination
  console.log('\n📋 Listing users with pagination...')
  const query = db
    .selectFrom('users')
    .selectAll()
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc')

  const paginatedUsers = await paginate(query, { page: 1, limit: 10 })
  console.log('Paginated users:', paginatedUsers)

  // Example: Soft delete
  console.log('\n🗑️ Soft deleting user...')
  if (foundUser) {
    await userRepo.softDelete(foundUser.id)
    console.log('User soft deleted')

    // Check if user is still findable
    const deletedUser = await userRepo.findById(foundUser.id)
    console.log('User after soft delete:', deletedUser) // Should be null

    // Restore user
    console.log('\n♻️ Restoring user...')
    await userRepo.restore(foundUser.id)
    const restoredUser = await userRepo.findById(foundUser.id)
    console.log('Restored user:', restoredUser)
  }

  // Cleanup
  await db.destroy()
  console.log('\n✅ Example completed!')
}

// Run the example
main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})