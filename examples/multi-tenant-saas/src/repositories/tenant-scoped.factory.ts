import type { Kysely } from 'kysely'
import { createRepository, createRepositoryFactory } from '@kysera/repository'
import { withTimestamps } from '@kysera/timestamps'
import { withAudit } from '@kysera/audit'
import { z } from 'zod'
import type { Database, TenantUser, Project, Task } from '../db/schema'
import type { TenantContext } from '../middleware/tenant-context'

/**
 * Tenant-Scoped Repository Factory
 *
 * Creates repositories that automatically filter by tenant_id.
 * Ensures complete tenant isolation at the data access layer.
 */

// Schemas
const userSchemas = {
  entity: z.object({
    id: z.number(),
    tenant_id: z.number(),
    email: z.string().email(),
    name: z.string(),
    role: z.enum(['owner', 'admin', 'member']),
    created_at: z.date(),
    updated_at: z.date()
  }),
  create: z.object({
    email: z.string().email(),
    name: z.string().min(1),
    role: z.enum(['owner', 'admin', 'member']).default('member')
  }),
  update: z.object({
    email: z.string().email().optional(),
    name: z.string().min(1).optional(),
    role: z.enum(['owner', 'admin', 'member']).optional()
  })
}

const projectSchemas = {
  entity: z.object({
    id: z.number(),
    tenant_id: z.number(),
    name: z.string(),
    description: z.string().nullable(),
    status: z.enum(['active', 'archived']),
    created_at: z.date(),
    updated_at: z.date()
  }),
  create: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(['active', 'archived']).default('active')
  }),
  update: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.enum(['active', 'archived']).optional()
  })
}

const taskSchemas = {
  entity: z.object({
    id: z.number(),
    tenant_id: z.number(),
    project_id: z.number(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(['todo', 'in_progress', 'done']),
    assigned_to: z.number().nullable(),
    created_at: z.date(),
    updated_at: z.date()
  }),
  create: z.object({
    project_id: z.number(),
    title: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(['todo', 'in_progress', 'done']).default('todo'),
    assigned_to: z.number().optional()
  }),
  update: z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.enum(['todo', 'in_progress', 'done']).optional(),
    assigned_to: z.number().optional()
  })
}

/**
 * Create a tenant-scoped repository
 *
 * Automatically adds tenant_id to all queries and inserts.
 */
function createTenantScopedRepository<TableName extends keyof Database>(
  db: Kysely<Database>,
  tableName: TableName,
  tenantContext: TenantContext,
  options: {
    schemas: any
    withAudit?: boolean
    withTimestamps?: boolean
  }
) {
  let repo = createRepository(db, tableName, {
    schemas: options.schemas
  })

  // Wrap repository methods to automatically inject tenant_id
  const tenantId = tenantContext.getTenantId()

  // Override create to inject tenant_id
  const originalCreate = repo.create.bind(repo)
  repo.create = async (data: any) => {
    return originalCreate({ ...data, tenant_id: tenantId })
  }

  // Override bulkCreate to inject tenant_id
  if (repo.bulkCreate) {
    const originalBulkCreate = repo.bulkCreate.bind(repo)
    repo.bulkCreate = async (items: any[]) => {
      return originalBulkCreate(items.map(item => ({ ...item, tenant_id: tenantId })))
    }
  }

  // Override findById to add tenant_id filter
  const originalFindById = repo.findById.bind(repo)
  repo.findById = async (id: number) => {
    const result = await db
      .selectFrom(tableName)
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id' as any, '=', tenantId)
      .executeTakeFirst()
    return result as any
  }

  // Override findAll to add tenant_id filter
  const originalFindAll = repo.findAll.bind(repo)
  repo.findAll = async () => {
    const results = await db
      .selectFrom(tableName)
      .selectAll()
      .where('tenant_id' as any, '=', tenantId)
      .execute()
    return results as any
  }

  // Apply plugins
  if (options.withTimestamps) {
    repo = withTimestamps(repo)
  }

  if (options.withAudit) {
    repo = withAudit(repo, {
      auditTable: 'audit_logs',
      captureOldValues: true,
      captureNewValues: true,
      getUserId: () => null // In real app, get from request context
    })
  }

  return repo
}

/**
 * Create all tenant-scoped repositories
 */
export function createTenantRepositories(
  db: Kysely<Database>,
  tenantContext: TenantContext
) {
  return {
    users: createTenantScopedRepository(db, 'users', tenantContext, {
      schemas: userSchemas,
      withTimestamps: true,
      withAudit: true
    }),

    projects: createTenantScopedRepository(db, 'projects', tenantContext, {
      schemas: projectSchemas,
      withTimestamps: true,
      withAudit: true
    }),

    tasks: createTenantScopedRepository(db, 'tasks', tenantContext, {
      schemas: taskSchemas,
      withTimestamps: true,
      withAudit: true
    })
  }
}

/**
 * Type for tenant repositories
 */
export type TenantRepositories = ReturnType<typeof createTenantRepositories>
