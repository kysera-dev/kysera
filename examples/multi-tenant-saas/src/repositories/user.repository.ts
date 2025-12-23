import type { Selectable } from 'kysely'
import { z } from 'zod'
import type { Executor } from '@kysera/core'
import { rlsContext } from '@kysera/rls'
import type { Database, TenantUser } from '../db/schema.js'

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
  updated_at: z.date()
})

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['owner', 'admin', 'member']).optional()
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
 * Create user repository with automatic RLS filtering
 *
 * With the RLS plugin enabled, SELECT queries are automatically filtered by tenant_id
 * from the RLS context. No need to manually add WHERE tenant_id = X to every query.
 *
 * The RLS plugin provides:
 * - Automatic filtering of SELECT queries by tenant_id
 * - Automatic WHERE clause addition for UPDATE/DELETE by tenant_id
 *
 * For INSERT operations:
 * - tenant_id must be explicitly added from rlsContext.get().auth.tenantId
 * - This ensures explicit control over tenant assignment
 */
export function createUserRepository(executor: Executor<Database>) {
  const validateDbResults = process.env['NODE_ENV'] === 'development'

  return {
    async findById(id: number): Promise<User | null> {
      // RLS plugin automatically adds: WHERE tenant_id = ctx.auth.tenantId
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()

      if (!row) return null

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async findByEmail(email: string): Promise<User | null> {
      // RLS plugin automatically adds: WHERE tenant_id = ctx.auth.tenantId
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('email', '=', email)
        .executeTakeFirst()

      if (!row) return null

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async findAll(): Promise<User[]> {
      // RLS plugin automatically adds: WHERE tenant_id = ctx.auth.tenantId
      const rows = await executor
        .selectFrom('users')
        .selectAll()
        .orderBy('created_at', 'desc')
        .execute()

      const users = rows.map(mapUserRow)
      return validateDbResults ? users.map(u => UserSchema.parse(u)) : users
    },

    async create(input: unknown): Promise<User> {
      const validated = CreateUserSchema.parse(input)

      // Get tenant_id from RLS context (set via rlsContext.runAsync)
      const ctx = rlsContext.getContextOrNull()
      if (!ctx?.auth?.tenantId) {
        throw new Error('RLS context with tenantId is required for create operations')
      }

      const row = await executor
        .insertInto('users')
        .values({
          ...validated,
          tenant_id: ctx.auth.tenantId as number,
          role: validated.role || 'member'
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async update(id: number, input: unknown): Promise<User> {
      const validated = UpdateUserSchema.parse(input)

      // RLS plugin automatically adds: WHERE tenant_id = ctx.auth.tenantId
      const row = await executor
        .updateTable('users')
        .set({
          ...validated,
          updated_at: new Date()
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow()

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async delete(id: number): Promise<void> {
      // RLS plugin automatically adds: WHERE tenant_id = ctx.auth.tenantId
      await executor.deleteFrom('users').where('id', '=', id).execute()
    }
  }
}
