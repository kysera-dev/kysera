import { db } from './connection.js'

async function seedDatabase() {
  console.log('🌱 Seeding database...')

  // Create two test tenants
  const tenant1 = await db
    .insertInto('tenants')
    .values({
      name: 'Acme Corporation',
      slug: 'acme-corp',
      plan: 'enterprise',
      max_users: 50
    })
    .returningAll()
    .executeTakeFirst()

  const tenant2 = await db
    .insertInto('tenants')
    .values({
      name: 'Beta Industries',
      slug: 'beta-industries',
      plan: 'pro',
      max_users: 20
    })
    .returningAll()
    .executeTakeFirst()

  console.log('✓ Created tenants:', { tenant1: tenant1?.slug, tenant2: tenant2?.slug })

  // Create users for Tenant 1 (Acme)
  await db
    .insertInto('users')
    .values([
      {
        tenant_id: tenant1!.id,
        email: 'alice@acme.com',
        name: 'Alice Admin',
        role: 'admin'
      },
      {
        tenant_id: tenant1!.id,
        email: 'bob@acme.com',
        name: 'Bob Member',
        role: 'member'
      }
    ])
    .execute()

  // Create users for Tenant 2 (Beta)
  await db
    .insertInto('users')
    .values([
      {
        tenant_id: tenant2!.id,
        email: 'charlie@beta.com',
        name: 'Charlie Admin',
        role: 'admin'
      },
      {
        tenant_id: tenant2!.id,
        email: 'diana@beta.com',
        name: 'Diana Member',
        role: 'member'
      }
    ])
    .execute()

  console.log('✓ Created users for both tenants')

  // Create projects for Tenant 1
  const acmeProject = await db
    .insertInto('projects')
    .values({
      tenant_id: tenant1!.id,
      name: 'Website Redesign',
      description: 'Complete overhaul of company website',
      status: 'active'
    })
    .returningAll()
    .executeTakeFirst()

  // Create projects for Tenant 2
  const betaProject = await db
    .insertInto('projects')
    .values({
      tenant_id: tenant2!.id,
      name: 'Mobile App Launch',
      description: 'Launch new mobile application',
      status: 'active'
    })
    .returningAll()
    .executeTakeFirst()

  console.log('✓ Created projects for both tenants')

  // Create tasks for Tenant 1
  await db
    .insertInto('tasks')
    .values([
      {
        tenant_id: tenant1!.id,
        project_id: acmeProject!.id,
        title: 'Design new homepage',
        description: 'Create mockups for new homepage design',
        status: 'in_progress'
      },
      {
        tenant_id: tenant1!.id,
        project_id: acmeProject!.id,
        title: 'Implement responsive layout',
        description: 'Make design mobile-friendly',
        status: 'todo'
      }
    ])
    .execute()

  // Create tasks for Tenant 2
  await db
    .insertInto('tasks')
    .values([
      {
        tenant_id: tenant2!.id,
        project_id: betaProject!.id,
        title: 'Develop authentication flow',
        description: 'Implement user login and registration',
        status: 'in_progress'
      },
      {
        tenant_id: tenant2!.id,
        project_id: betaProject!.id,
        title: 'Setup push notifications',
        description: 'Configure Firebase Cloud Messaging',
        status: 'todo'
      }
    ])
    .execute()

  console.log('✓ Created tasks for both tenants')

  console.log('\n✅ Database seeded successfully!')
  console.log('\nTenant 1 (Acme): ID =', tenant1!.id)
  console.log('Tenant 2 (Beta): ID =', tenant2!.id)

  await db.destroy()
}

// Run seed
seedDatabase().catch(error => {
  console.error('Seed error:', error)
  process.exit(1)
})
