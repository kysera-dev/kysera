/**
 * Tests for helper utilities.
 */

import { describe, it, expect, vi } from 'vitest'
import type { Kysely } from 'kysely'
import {
  waitFor,
  snapshotTable,
  countRows,
  assertRowExists,
  assertRowNotExists
} from '../src/helpers.js'

describe('waitFor', () => {
  it('should resolve immediately if condition is true', async () => {
    await waitFor(() => true)
    // Should not throw
  })

  it('should wait for condition to become true', async () => {
    let value = false

    setTimeout(() => {
      value = true
    }, 50)

    await waitFor(() => value, { timeout: 1000, interval: 10 })
    expect(value).toBe(true)
  })

  it('should support async condition functions', async () => {
    let value = false

    setTimeout(() => {
      value = true
    }, 50)

    await waitFor(
      async () => {
        return Promise.resolve(value)
      },
      { timeout: 1000, interval: 10 }
    )

    expect(value).toBe(true)
  })

  it('should throw on timeout', async () => {
    await expect(waitFor(() => false, { timeout: 50, interval: 10 })).rejects.toThrow(
      'Condition not met within timeout'
    )
  })

  it('should use custom timeout message', async () => {
    await expect(
      waitFor(() => false, {
        timeout: 50,
        interval: 10,
        timeoutMessage: 'Custom timeout message'
      })
    ).rejects.toThrow('Custom timeout message')
  })

  it('should check condition at specified interval', async () => {
    const condition = vi.fn().mockReturnValue(false)

    // Will timeout after ~100ms, checking every ~25ms
    try {
      await waitFor(condition, { timeout: 100, interval: 25 })
    } catch {
      // Expected to throw
    }

    // Should have been called multiple times (roughly 100/25 = 4 times)
    expect(condition).toHaveBeenCalled()
    expect(condition.mock.calls.length).toBeGreaterThanOrEqual(3)
  })
})

describe('snapshotTable', () => {
  it('should return all rows from a table', async () => {
    const mockRows = [
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' },
      { id: 3, name: 'Charlie', email: 'charlie@example.com' }
    ]

    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(mockRows)
    } as unknown as Kysely<unknown>

    const snapshot = await snapshotTable(mockDb, 'users')

    expect(snapshot).toEqual(mockRows)
    expect(mockDb.selectFrom).toHaveBeenCalledWith('users')
  })

  it('should return empty array for empty table', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([])
    } as unknown as Kysely<unknown>

    const snapshot = await snapshotTable(mockDb, 'empty_table')

    expect(snapshot).toEqual([])
    expect(snapshot.length).toBe(0)
  })

  it('should handle single row table', async () => {
    const mockRow = { id: 1, value: 'single' }

    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([mockRow])
    } as unknown as Kysely<unknown>

    const snapshot = await snapshotTable(mockDb, 'singleton')

    expect(snapshot).toEqual([mockRow])
    expect(snapshot.length).toBe(1)
  })

  it('should handle table with many rows', async () => {
    const mockRows = Array.from({ length: 1000 }, (_, i) => ({
      id: i + 1,
      name: `User ${i + 1}`
    }))

    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(mockRows)
    } as unknown as Kysely<unknown>

    const snapshot = await snapshotTable(mockDb, 'large_table')

    expect(snapshot.length).toBe(1000)
    expect(snapshot[0]).toEqual({ id: 1, name: 'User 1' })
    expect(snapshot[999]).toEqual({ id: 1000, name: 'User 1000' })
  })
})

describe('countRows', () => {
  it('should return count of rows in a table', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ count: '42' })
    } as unknown as Kysely<unknown>

    const count = await countRows(mockDb, 'users')

    expect(count).toBe(42)
    expect(mockDb.selectFrom).toHaveBeenCalledWith('users')
  })

  it('should return zero for empty table', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ count: '0' })
    } as unknown as Kysely<unknown>

    const count = await countRows(mockDb, 'empty_table')

    expect(count).toBe(0)
  })

  it('should handle large counts', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ count: '1000000' })
    } as unknown as Kysely<unknown>

    const count = await countRows(mockDb, 'large_table')

    expect(count).toBe(1000000)
  })

  it('should return zero when result is null', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(null)
    } as unknown as Kysely<unknown>

    const count = await countRows(mockDb, 'nonexistent_table')

    expect(count).toBe(0)
  })

  it('should return zero when result is undefined', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(undefined)
    } as unknown as Kysely<unknown>

    const count = await countRows(mockDb, 'nonexistent_table')

    expect(count).toBe(0)
  })

  it('should handle numeric string counts', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ count: '123' })
    } as unknown as Kysely<unknown>

    const count = await countRows(mockDb, 'some_table')

    expect(count).toBe(123)
    expect(typeof count).toBe('number')
  })
})

describe('assertRowExists', () => {
  it('should return row when it exists with single condition', async () => {
    const mockRow = { id: 1, email: 'test@example.com', name: 'Test User' }

    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(mockRow)
    } as unknown as Kysely<unknown>

    const result = await assertRowExists(mockDb, 'users', {
      email: 'test@example.com'
    })

    expect(result).toEqual(mockRow)
    expect(mockDb.selectFrom).toHaveBeenCalledWith('users')
  })

  it('should return row when it exists with multiple conditions', async () => {
    const mockRow = {
      id: 1,
      email: 'test@example.com',
      name: 'Test User',
      active: true
    }

    const mockWhere = vi.fn().mockReturnThis()
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: mockWhere,
      executeTakeFirst: vi.fn().mockResolvedValue(mockRow)
    } as unknown as Kysely<unknown>

    const result = await assertRowExists(mockDb, 'users', {
      email: 'test@example.com',
      active: true
    })

    expect(result).toEqual(mockRow)
    expect(mockWhere).toHaveBeenCalledTimes(2)
    expect(mockWhere).toHaveBeenCalledWith('email', '=', 'test@example.com')
    expect(mockWhere).toHaveBeenCalledWith('active', '=', true)
  })

  it('should throw error when row does not exist', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(undefined)
    } as unknown as Kysely<unknown>

    await expect(
      assertRowExists(mockDb, 'users', { email: 'notfound@example.com' })
    ).rejects.toThrow(
      'Expected row to exist in users with conditions: {"email":"notfound@example.com"}'
    )
  })

  it('should throw error with multiple conditions when row does not exist', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(null)
    } as unknown as Kysely<unknown>

    await expect(
      assertRowExists(mockDb, 'users', {
        email: 'test@example.com',
        active: true
      })
    ).rejects.toThrow(
      'Expected row to exist in users with conditions: {"email":"test@example.com","active":true}'
    )
  })

  it('should handle numeric condition values', async () => {
    const mockRow = { id: 42, name: 'User 42' }

    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(mockRow)
    } as unknown as Kysely<unknown>

    const result = await assertRowExists(mockDb, 'users', { id: 42 })

    expect(result).toEqual(mockRow)
  })

  it('should handle null condition values', async () => {
    const mockRow = { id: 1, deleted_at: null }

    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(mockRow)
    } as unknown as Kysely<unknown>

    const result = await assertRowExists(mockDb, 'users', { deleted_at: null })

    expect(result).toEqual(mockRow)
  })
})

describe('assertRowNotExists', () => {
  it('should not throw when row does not exist', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(undefined)
    } as unknown as Kysely<unknown>

    await expect(
      assertRowNotExists(mockDb, 'users', { email: 'notfound@example.com' })
    ).resolves.toBeUndefined()
  })

  it('should not throw when row does not exist with multiple conditions', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(null)
    } as unknown as Kysely<unknown>

    await expect(
      assertRowNotExists(mockDb, 'users', {
        email: 'notfound@example.com',
        active: true
      })
    ).resolves.toBeUndefined()
  })

  it('should throw error when row exists', async () => {
    const mockRow = { id: 1, email: 'exists@example.com' }

    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(mockRow)
    } as unknown as Kysely<unknown>

    await expect(
      assertRowNotExists(mockDb, 'users', { email: 'exists@example.com' })
    ).rejects.toThrow(
      'Expected no row to exist in users with conditions: {"email":"exists@example.com"}'
    )
  })

  it('should throw error when row exists with multiple conditions', async () => {
    const mockRow = { id: 1, email: 'exists@example.com', active: true }

    const mockWhere = vi.fn().mockReturnThis()
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: mockWhere,
      executeTakeFirst: vi.fn().mockResolvedValue(mockRow)
    } as unknown as Kysely<unknown>

    await expect(
      assertRowNotExists(mockDb, 'users', {
        email: 'exists@example.com',
        active: true
      })
    ).rejects.toThrow(
      'Expected no row to exist in users with conditions: {"email":"exists@example.com","active":true}'
    )

    expect(mockWhere).toHaveBeenCalledTimes(2)
    expect(mockWhere).toHaveBeenCalledWith('email', '=', 'exists@example.com')
    expect(mockWhere).toHaveBeenCalledWith('active', '=', true)
  })

  it('should verify all conditions are applied', async () => {
    const mockWhere = vi.fn().mockReturnThis()
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: mockWhere,
      executeTakeFirst: vi.fn().mockResolvedValue(undefined)
    } as unknown as Kysely<unknown>

    await assertRowNotExists(mockDb, 'users', {
      email: 'test@example.com',
      name: 'Test User',
      active: false
    })

    expect(mockWhere).toHaveBeenCalledTimes(3)
    expect(mockWhere).toHaveBeenCalledWith('email', '=', 'test@example.com')
    expect(mockWhere).toHaveBeenCalledWith('name', '=', 'Test User')
    expect(mockWhere).toHaveBeenCalledWith('active', '=', false)
  })

  it('should handle numeric condition values', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(undefined)
    } as unknown as Kysely<unknown>

    await assertRowNotExists(mockDb, 'users', { id: 999 })
  })

  it('should handle null condition values', async () => {
    const mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(undefined)
    } as unknown as Kysely<unknown>

    await assertRowNotExists(mockDb, 'users', { deleted_at: null })
  })
})
