import type { Selectable } from 'kysely'
import { z } from 'zod'
import type { Executor } from '@kysera/core'
import type { Database, UsersTable } from '../db/schema'

// Domain types
export type User = Selectable<UsersTable>

// Validation schemas
export const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  created_at: z.date(),
  deleted_at: z.date().nullable(),
})

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
})

export const UpdateUserSchema = CreateUserSchema.partial()

// Mapper function
function mapUserRow(row: Selectable<UsersTable>): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
    deleted_at: row.deleted_at
  }
}

// Repository
export function createUserRepository(executor: Executor<Database>) {
  const validateDbResults = process.env['NODE_ENV'] === 'development'

  return {
    async findById(id: number): Promise<User | null> {
      const row = await executor
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
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
        .where('deleted_at', 'is', null)
        .executeTakeFirst()

      if (!row) return null

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async findAll(): Promise<User[]> {
      const rows = await executor
        .selectFrom('users')
        .selectAll()
        .where('deleted_at', 'is', null)
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
          deleted_at: null,
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
        .set(validated)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirstOrThrow()

      const user = mapUserRow(row)
      return validateDbResults ? UserSchema.parse(user) : user
    },

    async softDelete(id: number): Promise<void> {
      await executor
        .updateTable('users')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute()
    },

    async restore(id: number): Promise<void> {
      await executor
        .updateTable('users')
        .set({ deleted_at: null })
        .where('id', '=', id)
        .execute()
    }
  }
}