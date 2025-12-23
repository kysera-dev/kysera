import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kysely, SqliteDialect, type Generated } from 'kysely'
import Database from 'better-sqlite3'
import { paginateCursor } from '../src/pagination.js'
import { BadRequestError } from '../src/errors.js'

interface TestDatabase {
  users: {
    id: Generated<number>
    name: string
    email: string
    created_at: Generated<string>
  }
}

describe('Cursor Pagination with Security', () => {
  let db: Kysely<TestDatabase>
  let database: Database.Database
  const testSecret = 'test-secret-key-at-least-16-chars-long-for-security'

  beforeEach(async () => {
    database = new Database(':memory:')
    db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({
        database
      })
    })

    // Create test table
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('name', 'text', col => col.notNull())
      .addColumn('email', 'text', col => col.notNull())
      .addColumn('created_at', 'text', col => col.notNull())
      .execute()

    // Insert test data
    const users = Array.from({ length: 20 }, (_, i) => ({
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      created_at: new Date(2024, 0, i + 1).toISOString()
    }))

    await db.insertInto('users').values(users).execute()
  })

  afterEach(async () => {
    await db.destroy()
    database.close()
  })

  describe('Cursor signing (HMAC)', () => {
    it('should paginate with signed cursors', async () => {
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret }
      })

      expect(page1.data).toHaveLength(5)
      expect(page1.pagination.hasNext).toBe(true)
      expect(page1.pagination.nextCursor).toBeDefined()

      // Cursor should contain a signature (contains a dot)
      expect(page1.pagination.nextCursor).toContain('.')

      // Page 2 with signed cursor
      const page2 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        cursor: page1.pagination.nextCursor,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret }
      })

      expect(page2.data).toHaveLength(5)
      expect(page2.data[0]?.id).toBe(6)
    })

    it('should reject tampered signed cursor', async () => {
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret }
      })

      // Tamper with the cursor by modifying the signature
      const [cursorPart, signaturePart] = page1.pagination.nextCursor!.split('.')
      const tamperedSignature = signaturePart!.replace('a', 'b').replace('0', '1')
      const tamperedCursor = `${cursorPart}.${tamperedSignature}`

      // Should throw BadRequestError
      await expect(
        paginateCursor(db.selectFrom('users').selectAll(), {
          limit: 5,
          cursor: tamperedCursor,
          orderBy: [{ column: 'id', direction: 'asc' }],
          security: { secret: testSecret }
        })
      ).rejects.toThrow(BadRequestError)

      await expect(
        paginateCursor(db.selectFrom('users').selectAll(), {
          limit: 5,
          cursor: tamperedCursor,
          orderBy: [{ column: 'id', direction: 'asc' }],
          security: { secret: testSecret }
        })
      ).rejects.toThrow('cursor has been tampered with')
    })

    it('should reject cursor signed with different secret', async () => {
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret }
      })

      const wrongSecret = 'wrong-secret-key-at-least-16-chars-long-for-security'

      // Should throw BadRequestError
      await expect(
        paginateCursor(db.selectFrom('users').selectAll(), {
          limit: 5,
          cursor: page1.pagination.nextCursor,
          orderBy: [{ column: 'id', direction: 'asc' }],
          security: { secret: wrongSecret }
        })
      ).rejects.toThrow(BadRequestError)
    })

    it('should work with different HMAC algorithms', async () => {
      const algorithms: Array<'sha256' | 'sha384' | 'sha512'> = ['sha256', 'sha384', 'sha512']

      for (const algorithm of algorithms) {
        const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
          limit: 5,
          orderBy: [{ column: 'id', direction: 'asc' }],
          security: { secret: testSecret, algorithm }
        })

        expect(page1.data).toHaveLength(5)
        expect(page1.pagination.nextCursor).toBeDefined()

        // Page 2 with same algorithm
        const page2 = await paginateCursor(db.selectFrom('users').selectAll(), {
          limit: 5,
          cursor: page1.pagination.nextCursor,
          orderBy: [{ column: 'id', direction: 'asc' }],
          security: { secret: testSecret, algorithm }
        })

        expect(page2.data).toHaveLength(5)
        expect(page2.data[0]?.id).toBe(6)
      }
    })

    it('should work with multi-column ordering', async () => {
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [
          { column: 'name', direction: 'asc' },
          { column: 'created_at', direction: 'desc' }
        ],
        security: { secret: testSecret }
      })

      expect(page1.data).toHaveLength(5)
      expect(page1.pagination.nextCursor).toBeDefined()

      // Page 2
      const page2 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        cursor: page1.pagination.nextCursor,
        orderBy: [
          { column: 'name', direction: 'asc' },
          { column: 'created_at', direction: 'desc' }
        ],
        security: { secret: testSecret }
      })

      expect(page2.data).toHaveLength(5)
    })
  })

  describe('Cursor encryption (AES-256-GCM)', () => {
    it('should paginate with encrypted cursors', async () => {
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret, encrypt: true }
      })

      expect(page1.data).toHaveLength(5)
      expect(page1.pagination.hasNext).toBe(true)
      expect(page1.pagination.nextCursor).toBeDefined()

      // Encrypted cursor should have signature (dot) and multiple parts
      const cursor = page1.pagination.nextCursor!
      expect(cursor).toContain('.')

      // Page 2 with encrypted cursor
      const page2 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        cursor: page1.pagination.nextCursor,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret, encrypt: true }
      })

      expect(page2.data).toHaveLength(5)
      expect(page2.data[0]?.id).toBe(6)
    })

    it('should reject tampered encrypted cursor', async () => {
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret, encrypt: true }
      })

      // Tamper with the cursor
      const tamperedCursor = page1.pagination.nextCursor!.replace('a', 'b')

      // Should throw BadRequestError
      await expect(
        paginateCursor(db.selectFrom('users').selectAll(), {
          limit: 5,
          cursor: tamperedCursor,
          orderBy: [{ column: 'id', direction: 'asc' }],
          security: { secret: testSecret, encrypt: true }
        })
      ).rejects.toThrow(BadRequestError)
    })

    it('should reject encrypted cursor with wrong secret', async () => {
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret, encrypt: true }
      })

      const wrongSecret = 'wrong-secret-key-at-least-16-chars-long-for-security'

      // Should throw BadRequestError
      await expect(
        paginateCursor(db.selectFrom('users').selectAll(), {
          limit: 5,
          cursor: page1.pagination.nextCursor,
          orderBy: [{ column: 'id', direction: 'asc' }],
          security: { secret: wrongSecret, encrypt: true }
        })
      ).rejects.toThrow(BadRequestError)
    })

    it('should produce different encrypted cursors each time (random IV)', async () => {
      // Get two pages with same data
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret, encrypt: true }
      })

      // Reset and get again
      const page2 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret, encrypt: true }
      })

      // Cursors should be different due to random IV
      expect(page1.pagination.nextCursor).not.toBe(page2.pagination.nextCursor)

      // But they should both decrypt to the same data when used
      const nextPage1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        cursor: page1.pagination.nextCursor,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret, encrypt: true }
      })

      const nextPage2 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        cursor: page2.pagination.nextCursor,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret, encrypt: true }
      })

      // Should return same data
      expect(nextPage1.data[0]?.id).toBe(nextPage2.data[0]?.id)
    })
  })

  describe('Combined encryption and signing', () => {
    it('should work with both encryption and signing enabled', async () => {
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret, encrypt: true, algorithm: 'sha384' }
      })

      expect(page1.data).toHaveLength(5)
      expect(page1.pagination.nextCursor).toBeDefined()

      // Page 2
      const page2 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        cursor: page1.pagination.nextCursor,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret, encrypt: true, algorithm: 'sha384' }
      })

      expect(page2.data).toHaveLength(5)
      expect(page2.data[0]?.id).toBe(6)
    })

    it('should reject tampered encrypted+signed cursor', async () => {
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret, encrypt: true }
      })

      // Tamper with cursor
      const tamperedCursor = page1.pagination.nextCursor!.replace('a', 'b')

      await expect(
        paginateCursor(db.selectFrom('users').selectAll(), {
          limit: 5,
          cursor: tamperedCursor,
          orderBy: [{ column: 'id', direction: 'asc' }],
          security: { secret: testSecret, encrypt: true }
        })
      ).rejects.toThrow(BadRequestError)
    })
  })

  describe('prevCursor with security', () => {
    it('should generate signed prevCursor', async () => {
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret }
      })

      const page2 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        cursor: page1.pagination.nextCursor,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret }
      })

      expect(page2.pagination.prevCursor).toBeDefined()
      expect(page2.pagination.prevCursor).toContain('.')

      // prevCursor points to the first item of page 2
      // Using it as cursor should give us items AFTER the first item of page 2
      const pageFromPrev = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        cursor: page2.pagination.prevCursor,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret }
      })

      // prevCursor encodes the first item of page2, so next page starts after it
      // Should start from the second item of page 2 (or first item after the cursor)
      expect(pageFromPrev.data[0]?.id).toBeGreaterThan(page2.data[0]!.id)
    })

    it('should generate encrypted prevCursor', async () => {
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret, encrypt: true }
      })

      const page2 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        cursor: page1.pagination.nextCursor,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret, encrypt: true }
      })

      expect(page2.pagination.prevCursor).toBeDefined()
      expect(page2.pagination.prevCursor).toContain('.')
    })
  })

  describe('Security edge cases', () => {
    it('should work without security options (backward compatible)', async () => {
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }]
      })

      expect(page1.data).toHaveLength(5)
      expect(page1.pagination.nextCursor).toBeDefined()

      const page2 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        cursor: page1.pagination.nextCursor,
        orderBy: [{ column: 'id', direction: 'asc' }]
      })

      expect(page2.data).toHaveLength(5)
    })

    it('should not accept unsigned cursor when security is enabled', async () => {
      // Get unsigned cursor
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }]
      })

      // Try to use unsigned cursor with security enabled
      await expect(
        paginateCursor(db.selectFrom('users').selectAll(), {
          limit: 5,
          cursor: page1.pagination.nextCursor,
          orderBy: [{ column: 'id', direction: 'asc' }],
          security: { secret: testSecret }
        })
      ).rejects.toThrow(BadRequestError)
    })

    it('should not accept signed cursor when security is disabled', async () => {
      // Get signed cursor
      const page1 = await paginateCursor(db.selectFrom('users').selectAll(), {
        limit: 5,
        orderBy: [{ column: 'id', direction: 'asc' }],
        security: { secret: testSecret }
      })

      // Try to use signed cursor without security
      await expect(
        paginateCursor(db.selectFrom('users').selectAll(), {
          limit: 5,
          cursor: page1.pagination.nextCursor,
          orderBy: [{ column: 'id', direction: 'asc' }]
        })
      ).rejects.toThrow(BadRequestError)
    })
  })
})
