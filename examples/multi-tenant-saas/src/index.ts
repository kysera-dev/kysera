import { db, pool } from './db/connection.js'
import { createUserRepository } from './repositories/user.repository.js'
import { checkDatabaseHealth } from '@kysera/infra'
import { createExecutor } from '@kysera/executor'
import { rlsPlugin, rlsContext, defineRLSSchema, filter } from '@kysera/rls'
import type { Database } from './db/schema.js'
import type { RLSSchema } from '@kysera/rls'

/**
 * Multi-Tenant SaaS Example with @kysera/rls Plugin
 *
 * Demonstrates:
 * - Automatic tenant isolation using RLS plugin
 * - No manual tenant_id filtering needed
 * - RLS context management with rlsContext
 * - Complete tenant data separation
 */

// Define RLS schema for tenant isolation
// Filter policies automatically add WHERE tenant_id = ctx.auth.tenantId to all queries
const rlsSchema: RLSSchema<Database> = defineRLSSchema<Database>({
  // Users table - tenant scoped
  users: {
    policies: [
      // Filter all reads by tenant_id - automatically added to SELECT queries
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
    ],
    defaultDeny: false
  },
  // Projects table - tenant scoped
  projects: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
    ],
    defaultDeny: false
  },
  // Tasks table - tenant scoped
  tasks: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
    ],
    defaultDeny: false
  },
  // Audit logs - tenant scoped
  audit_logs: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId }))
    ],
    defaultDeny: false
  }
  // Note: tenants table is not scoped - it's the root tenant table
  // Note: For INSERT operations, tenant_id is explicitly set in repository using rlsContext
})

async function main() {
  console.log('🏢 Multi-Tenant SaaS Example - Kysera RLS Plugin')

  // Check database health
  const health = await checkDatabaseHealth(db, pool)
  console.log('Database health:', health)

  // Create executor with RLS plugin
  console.log('\n⚙️  Setting up RLS plugin...')
  const executor = await createExecutor(db, [
    rlsPlugin({
      schema: rlsSchema,
      requireContext: true, // Require RLS context for all operations
      allowUnfilteredQueries: false // Prevent unfiltered queries
    })
  ])

  console.log('✅ RLS plugin initialized')

  // Create repository factory (not tied to any tenant yet)
  const createRepo = () => createUserRepository(executor)

  console.log('\n📋 Automatic Tenant Isolation Demo')

  // ============================================================================
  // Tenant 1 Operations (Acme Corporation)
  // ============================================================================
  console.log('\n--- Tenant 1 (Acme) Operations ---')

  await rlsContext.runAsync(
    {
      auth: {
        userId: 1,
        roles: ['admin'],
        tenantId: 1, // Acme Corporation
        isSystem: false
      },
      timestamp: new Date()
    },
    async () => {
      const userRepo = createRepo()

      // Create user - RLS automatically injects tenant_id = 1
      // Use unique email for idempotent runs
      const tenant1User = await userRepo.create({
        email: `eve-${Date.now()}@acme.com`,
        name: 'Eve Engineer',
        role: 'member'
      })
      console.log('Created user in Tenant 1:', {
        id: tenant1User.id,
        name: tenant1User.name,
        tenant_id: tenant1User.tenant_id
      })

      // Find all users - RLS automatically filters by tenant_id = 1
      const tenant1Users = await userRepo.findAll()
      console.log(`Tenant 1 can see ${tenant1Users.length} user(s):`)
      tenant1Users.forEach(u =>
        console.log(`  - ${u.name} (${u.email}) [tenant_id: ${u.tenant_id}]`)
      )
    }
  )

  // ============================================================================
  // Tenant 2 Operations (Beta Industries)
  // ============================================================================
  console.log('\n--- Tenant 2 (Beta) Operations ---')

  await rlsContext.runAsync(
    {
      auth: {
        userId: 3,
        roles: ['admin'],
        tenantId: 2, // Beta Industries
        isSystem: false
      },
      timestamp: new Date()
    },
    async () => {
      const userRepo = createRepo()

      // Create user - RLS automatically injects tenant_id = 2
      // Use unique email for idempotent runs
      const tenant2User = await userRepo.create({
        email: `frank-${Date.now()}@beta.com`,
        name: 'Frank Finance',
        role: 'member'
      })
      console.log('Created user in Tenant 2:', {
        id: tenant2User.id,
        name: tenant2User.name,
        tenant_id: tenant2User.tenant_id
      })

      // Find all users - RLS automatically filters by tenant_id = 2
      const tenant2Users = await userRepo.findAll()
      console.log(`Tenant 2 can see ${tenant2Users.length} user(s):`)
      tenant2Users.forEach(u =>
        console.log(`  - ${u.name} (${u.email}) [tenant_id: ${u.tenant_id}]`)
      )
    }
  )

  // ============================================================================
  // Cross-Tenant Access Test
  // ============================================================================
  console.log('\n⚠️  Cross-Tenant Access Test')

  // Get a user ID from Tenant 1 (Acme)
  let tenant1UserId: number | undefined

  await rlsContext.runAsync(
    {
      auth: { userId: 1, roles: ['admin'], tenantId: 1, isSystem: false },
      timestamp: new Date()
    },
    async () => {
      const userRepo = createRepo()
      const users = await userRepo.findAll()
      tenant1UserId = users[0]?.id
      console.log(`Tenant 1 user ID to test: ${tenant1UserId}`)
    }
  )

  // Try to access Tenant 1's user from Tenant 2 context
  await rlsContext.runAsync(
    {
      auth: { userId: 3, roles: ['admin'], tenantId: 2, isSystem: false },
      timestamp: new Date()
    },
    async () => {
      const userRepo = createRepo()
      const crossTenantAccess = await userRepo.findById(tenant1UserId!)

      if (crossTenantAccess === null) {
        console.log('✅ Tenant isolation working correctly!')
        console.log('   Tenant 2 cannot access Tenant 1 user')
        console.log('   RLS plugin automatically filtered the query')
      } else {
        console.log('❌ WARNING: Tenant isolation breach detected!')
        console.log('   Cross-tenant access should be blocked')
      }
    }
  )

  // ============================================================================
  // Update and Delete Operations
  // ============================================================================
  console.log('\n✏️  Update and Delete Operations (Tenant 1)')

  await rlsContext.runAsync(
    {
      auth: { userId: 1, roles: ['admin'], tenantId: 1, isSystem: false },
      timestamp: new Date()
    },
    async () => {
      const userRepo = createRepo()

      // Find user by email
      const user = await userRepo.findByEmail('eve@acme.com')
      if (user) {
        console.log('Found user:', user.name)

        // Update user
        const updated = await userRepo.update(user.id, {
          name: 'Eve Updated Engineer'
        })
        console.log('Updated user:', updated.name)

        // Delete user
        await userRepo.delete(user.id)
        console.log('Deleted user:', user.email)

        // Verify deletion
        const deleted = await userRepo.findById(user.id)
        console.log('User after deletion:', deleted === null ? 'null (correctly deleted)' : 'ERROR')
      }
    }
  )

  // ============================================================================
  // Context Switching Demo
  // ============================================================================
  console.log('\n🔄 Context Switching Demo')

  // Switch between tenants rapidly
  for (const tenantId of [1, 2, 1, 2]) {
    await rlsContext.runAsync(
      {
        auth: { userId: 1, roles: ['admin'], tenantId, isSystem: false },
        timestamp: new Date()
      },
      async () => {
        const userRepo = createRepo()
        const users = await userRepo.findAll()
        console.log(`Tenant ${tenantId}: ${users.length} users`)
      }
    )
  }

  // ============================================================================
  // System Context (Bypass RLS)
  // ============================================================================
  console.log('\n🔓 System Context (RLS Bypass)')

  await rlsContext.runAsync(
    {
      auth: { userId: 0, roles: ['system'], tenantId: 0, isSystem: true },
      timestamp: new Date()
    },
    async () => {
      const userRepo = createRepo()
      const allUsers = await userRepo.findAll()
      console.log(`System can see ALL users across tenants: ${allUsers.length} total`)
      console.log('Tenants represented:', [...new Set(allUsers.map(u => u.tenant_id))])
    }
  )

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n📊 Summary')
  console.log('✅ RLS plugin automatically filters all queries by tenant_id')
  console.log('✅ No manual WHERE tenant_id = X needed in repository methods')
  console.log('✅ Complete tenant isolation enforced')
  console.log('✅ Context switching is simple and clean')
  console.log('✅ System context can bypass RLS when needed')

  // Cleanup
  await db.destroy()
  console.log('\n✅ Example completed!')
}

// Run the example
main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
