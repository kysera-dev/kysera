import { db, pool } from './db/connection.js'
import { TenantContext } from './middleware/tenant-context.js'
import { createUserRepository } from './repositories/user.repository.js'
import { checkDatabaseHealth } from '@kysera/infra'

/**
 * Multi-Tenant SaaS Example
 *
 * Demonstrates:
 * - Tenant isolation using discriminator column (tenant_id)
 * - Row-level security through automatic filtering
 * - Tenant context management
 * - Preventing cross-tenant data access
 */
async function main() {
  console.log('🏢 Multi-Tenant SaaS Example - Kysera ORM')

  // Check database health
  const health = await checkDatabaseHealth(db, pool)
  console.log('Database health:', health)

  // Create tenant contexts for two different tenants
  const tenant1Context = new TenantContext()
  const tenant2Context = new TenantContext()

  // Set tenant IDs (in real app, extracted from request)
  tenant1Context.setTenantId(1)
  tenant2Context.setTenantId(2)

  // Create tenant-scoped repositories
  const tenant1UserRepo = createUserRepository(db, tenant1Context)
  const tenant2UserRepo = createUserRepository(db, tenant2Context)

  console.log('\n📋 Tenant Isolation Demo')

  // Tenant 1 operations
  console.log('\n--- Tenant 1 Operations ---')

  const tenant1User = await tenant1UserRepo.create({
    email: 'alice@tenant1.com',
    name: 'Alice (Tenant 1)',
    role: 'admin'
  })
  console.log('Created user in Tenant 1:', tenant1User)

  // Tenant 2 operations
  console.log('\n--- Tenant 2 Operations ---')

  const tenant2User = await tenant2UserRepo.create({
    email: 'bob@tenant2.com',
    name: 'Bob (Tenant 2)',
    role: 'member'
  })
  console.log('Created user in Tenant 2:', tenant2User)

  // Verify isolation: Tenant 1 can't see Tenant 2's users
  console.log('\n🔒 Testing Tenant Isolation')

  const tenant1Users = await tenant1UserRepo.findAll()
  console.log(`Tenant 1 can see ${tenant1Users.length} user(s):`, tenant1Users)

  const tenant2Users = await tenant2UserRepo.findAll()
  console.log(`Tenant 2 can see ${tenant2Users.length} user(s):`, tenant2Users)

  // Try to access Tenant 1's user from Tenant 2 (should return null)
  console.log('\n⚠️ Cross-tenant access test')
  const crossTenantAccess = await tenant2UserRepo.findById(tenant1User.id)
  console.log(`Tenant 2 trying to access Tenant 1's user:`, crossTenantAccess)
  if (crossTenantAccess === null) {
    console.log('✅ Tenant isolation working correctly - cross-tenant access prevented')
  } else {
    console.log('❌ WARNING: Tenant isolation breach detected!')
  }

  // Update operations (scoped to tenant)
  console.log('\n✏️ Update Operations')

  const updatedUser = await tenant1UserRepo.update(tenant1User.id, {
    name: 'Alice Updated (Tenant 1)'
  })
  console.log('Updated user in Tenant 1:', updatedUser)

  // Query by email (scoped to tenant)
  console.log('\n🔍 Search by Email')

  const foundUser = await tenant1UserRepo.findByEmail('alice@tenant1.com')
  console.log('Found user in Tenant 1:', foundUser)

  // Demonstrate tenant context switching
  console.log('\n🔄 Tenant Context Switching')
  console.log('Current Tenant 1 ID:', tenant1Context.getTenantId())
  console.log('Current Tenant 2 ID:', tenant2Context.getTenantId())

  // Cleanup
  await db.destroy()
  console.log('\n✅ Example completed!')
}

// Run the example
main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
