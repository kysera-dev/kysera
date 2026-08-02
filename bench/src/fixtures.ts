/**
 * Shared Kysera fixtures: user repository factory, validation schemas,
 * a minimal RLS policy schema, and the RLS contexts used by the suites.
 */
import { createRepositoryFactory, zodAdapter, type Repository } from '@kysera/repository'
import { defineRLSSchema, filter, allow, validate, type RLSContext } from '@kysera/rls'
import type { Kysely } from 'kysely'
import { z } from 'zod'
import { SEED_TENANT_ID, type BenchDb, type UserRow } from './schema.js'

const createUserSchema = zodAdapter(
  z.object({
    email: z.string(),
    name: z.string(),
    tenant_id: z.number(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional()
  })
)

const updateUserSchema = zodAdapter(
  z.object({
    email: z.string().optional(),
    name: z.string().optional(),
    tenant_id: z.number().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    deleted_at: z.string().nullable().optional()
  })
)

export type UserRepository = Repository<UserRow, BenchDb>

/**
 * The same factory is used for the plain-Kysely baseline and for plugin ORMs,
 * so both sides pay identical validation cost and any difference is plugin
 * machinery, not schema work.
 */
export function makeUserRepository(executor: Kysely<BenchDb>): UserRepository {
  const factory = createRepositoryFactory<BenchDb>(executor)
  return factory.create<'users', UserRow>({
    tableName: 'users',
    mapRow: row => row,
    schemas: {
      create: createUserSchema,
      update: updateUserSchema
    }
  })
}

/**
 * Minimal tenant-isolation RLS schema: one filtered read, value-level checks
 * for mutations. Representative of the smallest realistic policy set.
 */
export const benchRLSSchema = defineRLSSchema<BenchDb>({
  users: {
    policies: [
      filter('read', ctx => ({ tenant_id: ctx.auth.tenantId })),
      allow('create', ctx => (ctx.data as Partial<UserRow>).tenant_id === ctx.auth.tenantId),
      allow('update', ctx => (ctx.row as Partial<UserRow>).tenant_id === ctx.auth.tenantId),
      allow('delete', ctx => (ctx.row as Partial<UserRow>).tenant_id === ctx.auth.tenantId),
      validate('create', ctx => (ctx.data as Partial<UserRow>).tenant_id === ctx.auth.tenantId)
    ]
  }
})

/** System context: RLS is dispatched but bypasses policy evaluation. */
export function systemContext(): RLSContext {
  return {
    auth: { userId: 'bench-system', roles: [], isSystem: true },
    timestamp: new Date()
  }
}

/** Regular tenant user: RLS filters reads and guards mutations. */
export function tenantUserContext(): RLSContext {
  return {
    auth: { userId: 42, tenantId: SEED_TENANT_ID, roles: ['user'], isSystem: false },
    timestamp: new Date()
  }
}
