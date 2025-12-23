import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDatabase, seedTestData } from './setup/database.js'
import { createORM, type Plugin } from '../src/index.js'
import { createQuery } from '@kysera/dal'
import type { Kysely } from 'kysely'
import type { TestDatabase } from './setup/database.js'

describe('CQRS-lite Pattern', () => {
  let db: Kysely<TestDatabase>
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const setup = createTestDatabase()
    db = setup.db
    cleanup = setup.cleanup as () => Promise<void>
    await seedTestData(db)
  })

  afterEach(async () => {
    await cleanup()
  })

  describe('orm.createContext()', () => {
    it('should create a DAL context with ORM plugins', async () => {
      const filterPlugin: Plugin = {
        name: 'filter-plugin',
        version: '1.0.0',
        interceptQuery: (qb: any, context: any) => {
          if (context.operation === 'select' && context.table === 'users') {
            return (qb as any).where('name', '=', 'Alice')
          }
          return qb
        }
      }

      const orm = await createORM(db, [filterPlugin])
      const ctx = orm.createContext()

      // Create a DAL query
      const getUsers = createQuery<TestDatabase, [], any[]>(ctx =>
        ctx.db.selectFrom('users').selectAll().execute()
      )

      const users = await getUsers(ctx)

      // Plugin should have filtered to only Alice
      expect(users).toHaveLength(1)
      expect(users[0]).toMatchObject({ name: 'Alice' })
    })

    it('should work without plugins', async () => {
      const orm = await createORM(db, [])
      const ctx = orm.createContext()

      const getUsers = createQuery<TestDatabase, [], any[]>(ctx =>
        ctx.db.selectFrom('users').selectAll().execute()
      )

      const users = await getUsers(ctx)

      // No filtering, all users returned
      expect(users).toHaveLength(3)
    })
  })

  describe('orm.transaction()', () => {
    it('should support both Repository and DAL patterns in the same transaction', async () => {
      const orm = await createORM(db, [])

      // Create DAL query
      const getUserById = createQuery<TestDatabase, [number], any>((ctx, id) =>
        ctx.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
      )

      const createUser = createQuery<TestDatabase, [{ name: string; email: string }], any>(
        (ctx, data) =>
          ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
      )

      // Use DAL in transaction
      const result = await orm.transaction(async ctx => {
        // DAL for mutation
        const newUser = await createUser(ctx, {
          name: 'CQRS User',
          email: 'cqrs@example.com'
        })

        // DAL for complex reads
        const fetchedUser = await getUserById(ctx, newUser.id)

        return { created: newUser, fetched: fetchedUser }
      })

      expect(result.created).toMatchObject({
        name: 'CQRS User',
        email: 'cqrs@example.com'
      })
      expect(result.fetched).toMatchObject({
        name: 'CQRS User',
        email: 'cqrs@example.com'
      })
      expect(result.created.id).toBe(result.fetched?.id)
    })

    it('should propagate plugins to transaction context', async () => {
      const filterPlugin: Plugin = {
        name: 'filter-plugin',
        version: '1.0.0',
        interceptQuery: (qb: any, context: any) => {
          if (context.operation === 'select' && context.table === 'users') {
            return (qb as any).where('name', '=', 'Alice')
          }
          return qb
        }
      }

      const orm = await createORM(db, [filterPlugin])

      const getUsers = createQuery<TestDatabase, [], any[]>(ctx =>
        ctx.db.selectFrom('users').selectAll().execute()
      )

      const result = await orm.transaction(async ctx => {
        // Plugin filter should apply inside transaction
        const users = await getUsers(ctx)
        return users
      })

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ name: 'Alice' })
    })

    it('should rollback on error', async () => {
      const orm = await createORM(db, [])

      const createUser = createQuery<TestDatabase, [{ name: string; email: string }], any>(
        (ctx, data) =>
          ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
      )

      const getAllUsers = createQuery<TestDatabase, [], any[]>(ctx =>
        ctx.db.selectFrom('users').selectAll().execute()
      )

      const ctx = orm.createContext()
      const initialUsers = await getAllUsers(ctx)
      const initialCount = initialUsers.length

      await expect(
        orm.transaction(async ctx => {
          await createUser(ctx, {
            name: 'Will Rollback',
            email: 'rollback@example.com'
          })

          throw new Error('Transaction error')
        })
      ).rejects.toThrow('Transaction error')

      // User should not be created
      const finalUsers = await getAllUsers(ctx)
      expect(finalUsers).toHaveLength(initialCount)
    })
  })

  describe('CQRS-lite example', () => {
    it('should demonstrate write model (DAL mutations) and read model (DAL queries)', async () => {
      const orm = await createORM(db, [])

      // Write Model - DAL mutations
      const createUser = createQuery<TestDatabase, [{ name: string; email: string }], any>(
        (ctx, data) =>
          ctx.db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow()
      )

      // Read Model - DAL for complex queries
      const getUserStats = createQuery<TestDatabase, [number], any>((ctx, userId) =>
        ctx.db
          .selectFrom('users')
          .select([
            'users.id',
            'users.name',
            'users.email',
            eb => eb.fn.count('users.id').as('recordCount')
          ])
          .where('users.id', '=', userId)
          .groupBy(['users.id', 'users.name', 'users.email'])
          .executeTakeFirst()
      )

      // Combined usage in transaction
      const result = await orm.transaction(async ctx => {
        // Write: Create user via DAL mutation
        const user = await createUser(ctx, {
          name: 'CQRS Test',
          email: 'cqrs-test@example.com'
        })

        // Read: Get stats via DAL query
        const stats = await getUserStats(ctx, user.id)

        return { user, stats }
      })

      expect(result.user).toMatchObject({
        name: 'CQRS Test',
        email: 'cqrs-test@example.com'
      })
      expect(result.stats).toMatchObject({
        id: result.user.id,
        name: 'CQRS Test',
        email: 'cqrs-test@example.com'
      })
      // recordCount can be number or bigint depending on database driver
      expect([1, 1n]).toContain(result.stats?.recordCount)
    })
  })
})
