import type { Selectable } from 'kysely'
import { z } from 'zod'
import type { Executor } from '@kysera/core'
import type { Database, TenantUser } from '../db/schema'
import type { TenantContext } from '../middleware/tenant-context'

// Domain types
export type User = Selectable<TenantUser>

// Validation schemas
export const UserSchema = z.object({
  id: z.number(),
  tenant_id: z.number(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['owner', 'admin', 'member']),
  created_at: z.date(),
  updated_at: z.date(),
})

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['owner', 'admin', 'member']).optional(),
})

export const UpdateUserSchema = CreateUserSchema.partial()

// Mapper function
function mapUserRow(row: Selectable<TenantUser>): User {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    email: row.email,
    name: row.name,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

/**
 * Create tenant-scoped user repository
 *
 * All queries are automatically filtered by tenant_id from the context.
 * This ensures complete tenant isolation.
 */
export function createUserRepository(
  executor: Executor<Database>,
  tenantContext: TenantContext
) {
  const validateDbResults = process.env['NODE_ENV'] === 'development'
  const getTenantId = () => tenantContext.getTenantId()

  return {
    async findById(id: number): Promise<User | null> {
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', getTenantId()) // Tenant filter
        .executeTakeFirst()

      if (!row) return null

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async findByEmail(email: string): Promise<User | null> {
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('email', '=', email)
        .where('tenant_id', '=', getTenantId()) // Tenant filter
        .executeTakeFirst()

      if (!row) return null

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async findAll(): Promise<User[]> {
      const rows = await executor
        .selectFrom('users')
        .selectAll()
        .where('tenant_id', '=', getTenantId()) // Tenant filter
        .orderBy('created_at', 'desc')
        .execute()

      const users = rows.map(mapUserRow)
      return validateDbResults
        ? users.map(u => UserSchema.parse(u))
        : users
    },

    async create(input: unknown): Promise<User> {
      const validated = CreateUserSchema.parse(input)

      const row = await executor
        .insertInto('users')
        .values({
          ...validated,
          tenant_id: getTenantId(), // Auto-inject tenant_id
          role: validated.role || 'member',
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async update(id: number, input: unknown): Promise<User> {
      const validated = UpdateUserSchema.parse(input)

      const row = await executor
        .updateTable('users')
        .set({
          ...validated,
          updated_at: new Date()
        })
        .where('id', '=', id)
        .where('tenant_id', '=', getTenantId()) // Tenant filter
        .returningAll()
        .executeTakeFirstOrThrow()

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async delete(id: number): Promise<void> {
      await executor
        .deleteFrom('users')
        .where('id', '=', id)
        .where('tenant_id', '=', getTenantId()) // Tenant filter
        .execute()
    }
  }
}
