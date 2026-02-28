/**
 * M-16: LIKE Pattern Escaping Tests
 *
 * Verifies that escapeLikeValue and the SQL ESCAPE clause correctly handle
 * special characters (%, _, \) in $contains, $startsWith, $endsWith operators,
 * while $like still allows raw LIKE patterns without auto-escaping.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { createTestDatabase } from './setup/database.js'
import { createRepositoryFactory, zodAdapter } from '../src/index.js'
import type { Kysely, Selectable } from 'kysely'
import type { TestDatabase } from './setup/database.js'

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1)
})

const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional()
})

interface User {
  id: number
  email: string
  name: string
  created_at: Date | string
  deleted_at: Date | string | null
}

function createUserRepo(db: Kysely<TestDatabase>) {
  const factory = createRepositoryFactory(db)
  return factory.create<'users', User>({
    tableName: 'users',
    mapRow: (row: Selectable<TestDatabase['users']>): User => ({
      id: row.id,
      email: row.email,
      name: row.name,
      created_at: row.created_at,
      deleted_at: row.deleted_at
    }),
    schemas: {
      create: zodAdapter(CreateUserSchema),
      update: zodAdapter(UpdateUserSchema)
    }
  })
}

describe('LIKE Pattern Escaping (M-16)', () => {
  let db: Kysely<TestDatabase>
  let cleanup: () => void
  let userRepo: ReturnType<typeof createUserRepo>

  beforeEach(async () => {
    const setup = createTestDatabase()
    db = setup.db
    cleanup = setup.cleanup
    userRepo = createUserRepo(db)

    // Seed data with special characters in names
    await userRepo.create({ email: 'percent@test.com', name: '50% off' })
    await userRepo.create({ email: 'underscore@test.com', name: 'hello_world' })
    await userRepo.create({ email: 'backslash@test.com', name: 'path\\to\\file' })
    await userRepo.create({ email: 'normal@test.com', name: 'Normal User' })
    await userRepo.create({ email: 'combo@test.com', name: '100%_done\\finished' })
    await userRepo.create({ email: 'prefix-percent@test.com', name: 'sale: 50% discount' })
    await userRepo.create({ email: 'prefix-under@test.com', name: 'var_name_here' })
  })

  afterEach(() => {
    cleanup()
  })

  // ==========================================================================
  // $contains with special characters
  // ==========================================================================

  describe('$contains with special characters', () => {
    it('should match literal % character', async () => {
      const users = await userRepo.find({
        where: { name: { $contains: '%' } }
      })

      // Should match: '50% off', '100%_done\\finished', 'sale: 50% discount'
      const names = users.map(u => u.name)
      expect(names).toContain('50% off')
      expect(names).toContain('100%_done\\finished')
      expect(names).toContain('sale: 50% discount')

      // Should NOT match records without literal %
      expect(names).not.toContain('Normal User')
      expect(names).not.toContain('hello_world')
      expect(names).not.toContain('path\\to\\file')
    })

    it('should match literal _ character', async () => {
      const users = await userRepo.find({
        where: { name: { $contains: '_' } }
      })

      const names = users.map(u => u.name)
      // Should match: 'hello_world', '100%_done\\finished', 'var_name_here'
      expect(names).toContain('hello_world')
      expect(names).toContain('100%_done\\finished')
      expect(names).toContain('var_name_here')

      // Should NOT match records without literal _
      expect(names).not.toContain('Normal User')
      expect(names).not.toContain('50% off')
      expect(names).not.toContain('path\\to\\file')
    })

    it('should match literal \\ character', async () => {
      const users = await userRepo.find({
        where: { name: { $contains: '\\' } }
      })

      const names = users.map(u => u.name)
      // Should match: 'path\\to\\file', '100%_done\\finished'
      expect(names).toContain('path\\to\\file')
      expect(names).toContain('100%_done\\finished')

      // Should NOT match records without literal backslash
      expect(names).not.toContain('Normal User')
      expect(names).not.toContain('50% off')
      expect(names).not.toContain('hello_world')
    })

    it('should match substring with % in it', async () => {
      const users = await userRepo.find({
        where: { name: { $contains: '50%' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('50% off')
      expect(names).toContain('sale: 50% discount')
      expect(names).not.toContain('100%_done\\finished')
      expect(names).not.toContain('Normal User')
    })

    it('should match substring with _ in it', async () => {
      const users = await userRepo.find({
        where: { name: { $contains: '_world' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('hello_world')
      expect(names).not.toContain('var_name_here')
      expect(names).not.toContain('Normal User')
    })

    it('should match combination of % and _', async () => {
      const users = await userRepo.find({
        where: { name: { $contains: '%_' } }
      })

      const names = users.map(u => u.name)
      // Only '100%_done\\finished' contains the literal substring '%_'
      expect(names).toContain('100%_done\\finished')
      expect(names).not.toContain('50% off')
      expect(names).not.toContain('hello_world')
    })

    it('should match combination of \\ and %', async () => {
      const users = await userRepo.find({
        where: { name: { $contains: '\\finished' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('100%_done\\finished')
      expect(names).not.toContain('path\\to\\file')
    })

    it('should return empty results when no match', async () => {
      const users = await userRepo.find({
        where: { name: { $contains: '%%%' } }
      })

      expect(users).toHaveLength(0)
    })
  })

  // ==========================================================================
  // $startsWith with special characters
  // ==========================================================================

  describe('$startsWith with special characters', () => {
    it('should match names starting with literal %', async () => {
      // None of our names start with %, so this should be empty
      const users = await userRepo.find({
        where: { name: { $startsWith: '%' } }
      })

      expect(users).toHaveLength(0)
    })

    it('should match names starting with literal _', async () => {
      // None start with _, so this should be empty
      const users = await userRepo.find({
        where: { name: { $startsWith: '_' } }
      })

      expect(users).toHaveLength(0)
    })

    it('should match names starting with substring containing %', async () => {
      const users = await userRepo.find({
        where: { name: { $startsWith: '50%' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('50% off')
      expect(names).not.toContain('sale: 50% discount')
      expect(names).not.toContain('100%_done\\finished')
    })

    it('should match names starting with substring containing _', async () => {
      const users = await userRepo.find({
        where: { name: { $startsWith: 'hello_' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('hello_world')
      expect(names).not.toContain('var_name_here')
    })

    it('should match names starting with substring containing \\', async () => {
      const users = await userRepo.find({
        where: { name: { $startsWith: 'path\\' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('path\\to\\file')
      expect(names).not.toContain('100%_done\\finished')
    })

    it('should match names starting with combination of special chars', async () => {
      const users = await userRepo.find({
        where: { name: { $startsWith: '100%_' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('100%_done\\finished')
      expect(names).not.toContain('50% off')
    })

    it('should not treat _ as single-char wildcard in $startsWith', async () => {
      // Without escaping, '_' would match any single character,
      // so $startsWith: '_ormal' would match 'Normal'. It should NOT.
      const users = await userRepo.find({
        where: { name: { $startsWith: '_ormal' } }
      })

      // Should find nothing because no name literally starts with '_ormal'
      expect(users).toHaveLength(0)
    })

    it('should not treat % as wildcard in $startsWith', async () => {
      // Without escaping, $startsWith: '%' would match everything.
      // With proper escaping, it matches only names starting with literal '%'.
      const allUsers = await userRepo.findAll()
      const usersStartingWithPercent = await userRepo.find({
        where: { name: { $startsWith: '%' } }
      })

      // None of our test names start with literal '%'
      expect(usersStartingWithPercent.length).toBeLessThan(allUsers.length)
      expect(usersStartingWithPercent).toHaveLength(0)
    })
  })

  // ==========================================================================
  // $endsWith with special characters
  // ==========================================================================

  describe('$endsWith with special characters', () => {
    it('should match names ending with literal %', async () => {
      // None of our names end with %, so this should be empty
      const users = await userRepo.find({
        where: { name: { $endsWith: '%' } }
      })

      expect(users).toHaveLength(0)
    })

    it('should match names ending with literal _', async () => {
      // None end with _, so this should be empty
      const users = await userRepo.find({
        where: { name: { $endsWith: '_' } }
      })

      expect(users).toHaveLength(0)
    })

    it('should match names ending with substring containing %', async () => {
      const users = await userRepo.find({
        where: { name: { $endsWith: '% off' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('50% off')
      expect(names).not.toContain('sale: 50% discount')
    })

    it('should match names ending with substring containing _', async () => {
      const users = await userRepo.find({
        where: { name: { $endsWith: '_world' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('hello_world')
      expect(names).not.toContain('var_name_here')
    })

    it('should match names ending with substring containing \\', async () => {
      const users = await userRepo.find({
        where: { name: { $endsWith: '\\file' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('path\\to\\file')
      expect(names).not.toContain('100%_done\\finished')
    })

    it('should match names ending with combination of special chars', async () => {
      const users = await userRepo.find({
        where: { name: { $endsWith: '\\finished' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('100%_done\\finished')
      expect(names).not.toContain('path\\to\\file')
    })

    it('should not treat _ as single-char wildcard in $endsWith', async () => {
      // Without escaping, '_ser' would match 'User' (any char + 'ser')
      const users = await userRepo.find({
        where: { name: { $endsWith: '_ser' } }
      })

      // Should find nothing, not 'Normal User'
      expect(users).toHaveLength(0)
    })
  })

  // ==========================================================================
  // $like - raw LIKE pattern (no auto-escaping)
  // ==========================================================================

  describe('$like - raw LIKE patterns (no auto-escaping)', () => {
    it('should use % as wildcard in $like', async () => {
      const users = await userRepo.find({
        where: { name: { $like: '%User%' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('Normal User')
    })

    it('should use _ as single-char wildcard in $like', async () => {
      // '_ormal User' should match 'Normal User' (_=any single char)
      const users = await userRepo.find({
        where: { name: { $like: '_ormal User' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('Normal User')
    })

    it('should allow combining wildcards in $like', async () => {
      // '%_world' should match 'hello_world' (% matches 'hello', _ matches any char, then 'world')
      const users = await userRepo.find({
        where: { name: { $like: '%_world' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('hello_world')
    })

    it('should match with leading wildcard in $like', async () => {
      const users = await userRepo.find({
        where: { name: { $like: '% off' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('50% off')
    })

    it('should match with trailing wildcard in $like', async () => {
      const users = await userRepo.find({
        where: { name: { $like: 'Normal%' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('Normal User')
      expect(names).not.toContain('50% off')
    })

    it('should return no results for exact non-matching literal $like', async () => {
      const users = await userRepo.find({
        where: { name: { $like: 'nonexistent' } }
      })

      expect(users).toHaveLength(0)
    })
  })

  // ==========================================================================
  // Combinations of special characters
  // ==========================================================================

  describe('Combinations of special characters', () => {
    it('should handle value with all three special chars: %, _, \\', async () => {
      const users = await userRepo.find({
        where: { name: { $contains: '%_done\\' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('100%_done\\finished')
      expect(names).toHaveLength(1)
    })

    it('should handle multiple % in $contains', async () => {
      // Create a user with multiple percent signs
      await userRepo.create({ email: 'multi-pct@test.com', name: '10% to 50% range' })

      const users = await userRepo.find({
        where: { name: { $contains: '% to 50%' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('10% to 50% range')
      expect(names).toHaveLength(1)
    })

    it('should handle multiple _ in $contains', async () => {
      const users = await userRepo.find({
        where: { name: { $contains: '_name_' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('var_name_here')
      expect(names).toHaveLength(1)
    })

    it('should handle multiple \\ in $contains', async () => {
      const users = await userRepo.find({
        where: { name: { $contains: '\\to\\' } }
      })

      const names = users.map(u => u.name)
      expect(names).toContain('path\\to\\file')
      expect(names).toHaveLength(1)
    })

    it('should differentiate between $like and $contains for special chars', async () => {
      // $like treats % as wildcard
      const likeUsers = await userRepo.find({
        where: { name: { $like: '%' } }
      })

      // $contains escapes % as a literal
      const containsUsers = await userRepo.find({
        where: { name: { $contains: '%' } }
      })

      // $like with just '%' matches everything
      const allUsers = await userRepo.findAll()
      expect(likeUsers).toHaveLength(allUsers.length)

      // $contains with '%' only matches names containing literal '%'
      expect(containsUsers.length).toBeLessThan(allUsers.length)
      expect(containsUsers.length).toBeGreaterThan(0)
    })

    it('should differentiate between $like and $startsWith for _', async () => {
      // $like: '_ormal User' uses _ as wildcard (matches 'Normal User')
      const likeUsers = await userRepo.find({
        where: { name: { $like: '_ormal User' } }
      })

      // $startsWith: '_ormal' escapes _ (no names start with literal '_ormal')
      const startsWithUsers = await userRepo.find({
        where: { name: { $startsWith: '_ormal' } }
      })

      expect(likeUsers).toHaveLength(1)
      expect(likeUsers[0]?.name).toBe('Normal User')

      expect(startsWithUsers).toHaveLength(0)
    })

    it('should handle empty string in $contains', async () => {
      // Empty string should match everything (LIKE '%%' matches all)
      const allUsers = await userRepo.findAll()
      const users = await userRepo.find({
        where: { name: { $contains: '' } }
      })

      expect(users).toHaveLength(allUsers.length)
    })

    it('should handle empty string in $startsWith', async () => {
      const allUsers = await userRepo.findAll()
      const users = await userRepo.find({
        where: { name: { $startsWith: '' } }
      })

      expect(users).toHaveLength(allUsers.length)
    })

    it('should handle empty string in $endsWith', async () => {
      const allUsers = await userRepo.findAll()
      const users = await userRepo.find({
        where: { name: { $endsWith: '' } }
      })

      expect(users).toHaveLength(allUsers.length)
    })
  })

  // ==========================================================================
  // Regression: ensure regular strings still work
  // ==========================================================================

  describe('Regression - regular strings still work', () => {
    it('$contains with normal substring', async () => {
      const users = await userRepo.find({
        where: { name: { $contains: 'Normal' } }
      })

      expect(users).toHaveLength(1)
      expect(users[0]?.name).toBe('Normal User')
    })

    it('$startsWith with normal prefix', async () => {
      const users = await userRepo.find({
        where: { name: { $startsWith: 'Normal' } }
      })

      expect(users).toHaveLength(1)
      expect(users[0]?.name).toBe('Normal User')
    })

    it('$endsWith with normal suffix', async () => {
      const users = await userRepo.find({
        where: { name: { $endsWith: 'User' } }
      })

      expect(users).toHaveLength(1)
      expect(users[0]?.name).toBe('Normal User')
    })

    it('$like with normal pattern', async () => {
      const users = await userRepo.find({
        where: { name: { $like: 'Normal%' } }
      })

      expect(users).toHaveLength(1)
      expect(users[0]?.name).toBe('Normal User')
    })
  })
})
