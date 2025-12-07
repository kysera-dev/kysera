import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect, type Generated } from 'kysely';
import Database from 'better-sqlite3';
import { paginateCursor, type PaginatedResult } from '../src/pagination.js';

interface TestDatabase {
  products: {
    id: Generated<number>;
    name: string;
    score: number;
    created_at: Generated<string>;
    price: number;
  };
}

describe('Cursor Pagination - Complex Scenarios', () => {
  let db: Kysely<TestDatabase>;
  let database: Database.Database;

  beforeEach(async () => {
    database = new Database(':memory:');
    db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({
        database,
      }),
    });

    // Create test table
    await db.schema
      .createTable('products')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('score', 'integer', (col) => col.notNull())
      .addColumn('created_at', 'text', (col) => col.notNull())
      .addColumn('price', 'integer', (col) => col.notNull())
      .execute();

    // Insert test data with various combinations
    const testData = [
      { name: 'Product A', score: 100, created_at: '2024-01-01', price: 10 },
      { name: 'Product B', score: 100, created_at: '2024-01-02', price: 20 },
      { name: 'Product C', score: 100, created_at: '2024-01-03', price: 30 },
      { name: 'Product D', score: 90, created_at: '2024-01-01', price: 15 },
      { name: 'Product E', score: 90, created_at: '2024-01-02', price: 25 },
      { name: 'Product F', score: 80, created_at: '2024-01-01', price: 5 },
      { name: 'Product G', score: 80, created_at: '2024-01-02', price: 35 },
      { name: 'Product H', score: 70, created_at: '2024-01-01', price: 40 },
      { name: 'Product I', score: 60, created_at: '2024-01-01', price: 45 },
      { name: 'Product J', score: 50, created_at: '2024-01-01', price: 50 },
    ];

    await db.insertInto('products').values(testData).execute();
  });

  afterEach(async () => {
    await db.destroy();
    database.close();
  });

  describe('Single column ordering', () => {
    it('should paginate with single column ASC', async () => {
      const page1 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 3,
        orderBy: [{ column: 'score', direction: 'asc' }],
      });

      expect(page1.data).toHaveLength(3);
      expect(page1.pagination.hasNext).toBe(true);
      expect(page1.data[0]?.score).toBe(50);
      expect(page1.data[1]?.score).toBe(60);
      expect(page1.data[2]?.score).toBe(70);

      // Page 2
      const page2 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 3,
        cursor: page1.pagination.nextCursor,
        orderBy: [{ column: 'score', direction: 'asc' }],
      });

      expect(page2.data).toHaveLength(3);
      expect(page2.data[0]?.score).toBe(80);
      expect(page2.data[1]?.score).toBe(80);
      expect(page2.data[2]?.score).toBe(90);
    });

    it('should paginate with single column DESC', async () => {
      const page1 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 3,
        orderBy: [{ column: 'score', direction: 'desc' }],
      });

      expect(page1.data).toHaveLength(3);
      expect(page1.pagination.hasNext).toBe(true);
      expect(page1.data[0]?.score).toBe(100);
      expect(page1.data[1]?.score).toBe(100);
      expect(page1.data[2]?.score).toBe(100);

      // Page 2
      const page2 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 3,
        cursor: page1.pagination.nextCursor,
        orderBy: [{ column: 'score', direction: 'desc' }],
      });

      expect(page2.data).toHaveLength(3);
      expect(page2.data[0]?.score).toBe(90);
      expect(page2.data[1]?.score).toBe(90);
      expect(page2.data[2]?.score).toBe(80);
    });
  });

  describe('Multi-column ordering - All ASC', () => {
    it('should correctly paginate with compound cursor (score ASC, created_at ASC)', async () => {
      const page1 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 3,
        orderBy: [
          { column: 'score', direction: 'asc' },
          { column: 'created_at', direction: 'asc' },
        ],
      });

      expect(page1.data).toHaveLength(3);
      // Should get: score 50 (2024-01-01), score 60 (2024-01-01), score 70 (2024-01-01)
      expect(page1.data[0]?.score).toBe(50);
      expect(page1.data[1]?.score).toBe(60);
      expect(page1.data[2]?.score).toBe(70);

      // Page 2
      const page2 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 3,
        cursor: page1.pagination.nextCursor,
        orderBy: [
          { column: 'score', direction: 'asc' },
          { column: 'created_at', direction: 'asc' },
        ],
      });

      expect(page2.data).toHaveLength(3);
      // Should get: score 80 (2024-01-01), score 80 (2024-01-02), score 90 (2024-01-01)
      expect(page2.data[0]?.score).toBe(80);
      expect(page2.data[0]?.created_at).toBe('2024-01-01');
      expect(page2.data[1]?.score).toBe(80);
      expect(page2.data[1]?.created_at).toBe('2024-01-02');
      expect(page2.data[2]?.score).toBe(90);
    });

    it('should handle three-column ordering (all ASC)', async () => {
      const page1 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 2,
        orderBy: [
          { column: 'score', direction: 'asc' },
          { column: 'created_at', direction: 'asc' },
          { column: 'price', direction: 'asc' },
        ],
      });

      expect(page1.data).toHaveLength(2);
      expect(page1.pagination.hasNext).toBe(true);

      // Verify next page continues correctly
      const page2 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 2,
        cursor: page1.pagination.nextCursor,
        orderBy: [
          { column: 'score', direction: 'asc' },
          { column: 'created_at', direction: 'asc' },
          { column: 'price', direction: 'asc' },
        ],
      });

      expect(page2.data).toHaveLength(2);
      // Should continue from where page1 left off
      const lastPage1Score = page1.data[page1.data.length - 1]?.score;
      const firstPage2Score = page2.data[0]?.score;
      expect(firstPage2Score).toBeGreaterThanOrEqual(lastPage1Score!);
    });
  });

  describe('Multi-column ordering - All DESC', () => {
    it('should correctly paginate with compound cursor (score DESC, created_at DESC)', async () => {
      const page1 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 3,
        orderBy: [
          { column: 'score', direction: 'desc' },
          { column: 'created_at', direction: 'desc' },
        ],
      });

      expect(page1.data).toHaveLength(3);
      // Should get: score 100 (2024-01-03), score 100 (2024-01-02), score 100 (2024-01-01)
      expect(page1.data[0]?.score).toBe(100);
      expect(page1.data[0]?.created_at).toBe('2024-01-03');
      expect(page1.data[1]?.score).toBe(100);
      expect(page1.data[1]?.created_at).toBe('2024-01-02');
      expect(page1.data[2]?.score).toBe(100);
      expect(page1.data[2]?.created_at).toBe('2024-01-01');

      // Page 2
      const page2 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 3,
        cursor: page1.pagination.nextCursor,
        orderBy: [
          { column: 'score', direction: 'desc' },
          { column: 'created_at', direction: 'desc' },
        ],
      });

      expect(page2.data).toHaveLength(3);
      // Should get: score 90 (2024-01-02), score 90 (2024-01-01), score 80 (2024-01-02)
      expect(page2.data[0]?.score).toBe(90);
      expect(page2.data[0]?.created_at).toBe('2024-01-02');
      expect(page2.data[1]?.score).toBe(90);
      expect(page2.data[1]?.created_at).toBe('2024-01-01');
      expect(page2.data[2]?.score).toBe(80);
    });
  });

  describe('Multi-column ordering - MIXED (Critical!)', () => {
    it('should correctly paginate with mixed ordering (score DESC, created_at ASC)', async () => {
      const page1 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 3,
        orderBy: [
          { column: 'score', direction: 'desc' },
          { column: 'created_at', direction: 'asc' },
        ],
      });

      expect(page1.data).toHaveLength(3);
      // Should get: score 100 (2024-01-01), score 100 (2024-01-02), score 100 (2024-01-03)
      expect(page1.data[0]?.score).toBe(100);
      expect(page1.data[0]?.created_at).toBe('2024-01-01');
      expect(page1.data[1]?.score).toBe(100);
      expect(page1.data[1]?.created_at).toBe('2024-01-02');
      expect(page1.data[2]?.score).toBe(100);
      expect(page1.data[2]?.created_at).toBe('2024-01-03');

      // Page 2 - This is the critical test!
      const page2 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 3,
        cursor: page1.pagination.nextCursor,
        orderBy: [
          { column: 'score', direction: 'desc' },
          { column: 'created_at', direction: 'asc' },
        ],
      });

      expect(page2.data).toHaveLength(3);
      // Should get: score 90 (2024-01-01), score 90 (2024-01-02), score 80 (2024-01-01)
      expect(page2.data[0]?.score).toBe(90);
      expect(page2.data[0]?.created_at).toBe('2024-01-01');
      expect(page2.data[1]?.score).toBe(90);
      expect(page2.data[1]?.created_at).toBe('2024-01-02');
      expect(page2.data[2]?.score).toBe(80);
      expect(page2.data[2]?.created_at).toBe('2024-01-01');
    });

    it('should correctly paginate with mixed ordering (score ASC, created_at DESC)', async () => {
      const page1 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 3,
        orderBy: [
          { column: 'score', direction: 'asc' },
          { column: 'created_at', direction: 'desc' },
        ],
      });

      expect(page1.data).toHaveLength(3);
      // Should get: score 50 (2024-01-01), score 60 (2024-01-01), score 70 (2024-01-01)
      expect(page1.data[0]?.score).toBe(50);
      expect(page1.data[1]?.score).toBe(60);
      expect(page1.data[2]?.score).toBe(70);

      // Page 2
      const page2 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 3,
        cursor: page1.pagination.nextCursor,
        orderBy: [
          { column: 'score', direction: 'asc' },
          { column: 'created_at', direction: 'desc' },
        ],
      });

      expect(page2.data).toHaveLength(3);
      // Should get: score 80 (2024-01-02), score 80 (2024-01-01), score 90 (2024-01-02)
      expect(page2.data[0]?.score).toBe(80);
      expect(page2.data[0]?.created_at).toBe('2024-01-02');
      expect(page2.data[1]?.score).toBe(80);
      expect(page2.data[1]?.created_at).toBe('2024-01-01');
      expect(page2.data[2]?.score).toBe(90);
      expect(page2.data[2]?.created_at).toBe('2024-01-02');
    });

    it('should handle complex three-column mixed ordering', async () => {
      const page1 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 2,
        orderBy: [
          { column: 'score', direction: 'desc' },
          { column: 'created_at', direction: 'asc' },
          { column: 'price', direction: 'desc' },
        ],
      });

      expect(page1.data).toHaveLength(2);
      expect(page1.pagination.hasNext).toBe(true);

      // Page 2
      const page2 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 2,
        cursor: page1.pagination.nextCursor,
        orderBy: [
          { column: 'score', direction: 'desc' },
          { column: 'created_at', direction: 'asc' },
          { column: 'price', direction: 'desc' },
        ],
      });

      expect(page2.data).toHaveLength(2);
      // Verify continuity
      const lastPage1 = page1.data[page1.data.length - 1]!;
      const firstPage2 = page2.data[0]!;

      // Either different score, or same score but different created_at, or same both but different price
      const scoreDiff = lastPage1.score - firstPage2.score;
      if (scoreDiff === 0) {
        // Same score, check created_at
        expect(firstPage2.created_at >= lastPage1.created_at).toBe(true);
        if (firstPage2.created_at === lastPage1.created_at) {
          // Same created_at, price should be less (DESC)
          expect(firstPage2.price <= lastPage1.price).toBe(true);
        }
      } else {
        // Score should decrease (DESC)
        expect(scoreDiff > 0).toBe(true);
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle empty results', async () => {
      const result = await paginateCursor(db.selectFrom('products').selectAll().where('score', '>', 1000), {
        limit: 10,
        orderBy: [{ column: 'score', direction: 'asc' }],
      });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.nextCursor).toBeUndefined();
    });

    it('should handle exact limit match', async () => {
      const result = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 10, // Exactly matches number of rows
        orderBy: [{ column: 'score', direction: 'asc' }],
      });

      expect(result.data).toHaveLength(10);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.nextCursor).toBeUndefined();
    });

    it('should handle limit greater than total rows', async () => {
      const result = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 100,
        orderBy: [{ column: 'score', direction: 'asc' }],
      });

      expect(result.data).toHaveLength(10);
      expect(result.pagination.hasNext).toBe(false);
    });

    it('should handle pagination through all records', async () => {
      const allRecords: any[] = [];
      let cursor: string | undefined = undefined;
      let pageCount = 0;

      // Fetch all records using pagination
      while (true) {
        const page: PaginatedResult<any> = await paginateCursor(db.selectFrom('products').selectAll(), {
          limit: 3,
          cursor,
          orderBy: [
            { column: 'score', direction: 'desc' },
            { column: 'created_at', direction: 'asc' },
          ],
        });

        allRecords.push(...page.data);
        pageCount++;

        if (!page.pagination.hasNext || !page.pagination.nextCursor) break;
        cursor = page.pagination.nextCursor;

        // Safety check
        if (pageCount > 10) {
          throw new Error('Infinite loop detected');
        }
      }

      expect(allRecords).toHaveLength(10);
      expect(pageCount).toBe(4); // 3 + 3 + 3 + 1 = 10
    });
  });

  describe('No duplicate or missing records', () => {
    it('should return all records exactly once when paginating', async () => {
      const seenIds = new Set<number>();
      let cursor: string | undefined = undefined;

      while (true) {
        const page: PaginatedResult<any> = await paginateCursor(db.selectFrom('products').selectAll(), {
          limit: 3,
          cursor,
          orderBy: [
            { column: 'score', direction: 'desc' },
            { column: 'created_at', direction: 'asc' },
            { column: 'id', direction: 'asc' },
          ],
        });

        for (const product of page.data) {
          expect(seenIds.has(product.id)).toBe(false); // No duplicates
          seenIds.add(product.id);
        }

        if (!page.pagination.hasNext || !page.pagination.nextCursor) break;
        cursor = page.pagination.nextCursor;
      }

      expect(seenIds.size).toBe(10); // All records retrieved
    });
  });

  describe('Cursor validation', () => {
    it('should reject invalid base64 cursor', async () => {
      await expect(
        paginateCursor(db.selectFrom('products').selectAll(), {
          cursor: 'invalid-cursor-not-base64!!!',
          orderBy: [{ column: 'score', direction: 'asc' }],
        })
      ).rejects.toThrow('Invalid pagination cursor: unable to decode');
    });

    it('should reject cursor with invalid JSON', async () => {
      // Create base64 of invalid JSON
      const invalidCursor = Buffer.from('not valid json').toString('base64');

      await expect(
        paginateCursor(db.selectFrom('products').selectAll(), {
          cursor: invalidCursor,
          orderBy: [{ column: 'score', direction: 'asc' }],
        })
      ).rejects.toThrow('Invalid pagination cursor: unable to decode');
    });

    it('should reject cursor missing required columns', async () => {
      // Create cursor with only 'score' but query needs 'score' and 'created_at'
      const incompleteCursor = Buffer.from(JSON.stringify({ score: 100 })).toString('base64');

      await expect(
        paginateCursor(db.selectFrom('products').selectAll(), {
          cursor: incompleteCursor,
          orderBy: [
            { column: 'score', direction: 'asc' },
            { column: 'created_at', direction: 'asc' },
          ],
        })
      ).rejects.toThrow("Invalid pagination cursor: missing column 'created_at'");
    });

    it('should reject cursor with wrong columns', async () => {
      // Create cursor with 'price' instead of 'score'
      const wrongCursor = Buffer.from(JSON.stringify({ price: 100 })).toString('base64');

      await expect(
        paginateCursor(db.selectFrom('products').selectAll(), {
          cursor: wrongCursor,
          orderBy: [{ column: 'score', direction: 'asc' }],
        })
      ).rejects.toThrow("Invalid pagination cursor: missing column 'score'");
    });

    it('should accept valid cursor with extra columns', async () => {
      // Cursor with extra columns should be accepted (cursor has more data than needed)
      const validCursor = Buffer.from(
        JSON.stringify({
          score: 80,
          created_at: '2024-01-01',
          extraField: 'ignored',
        })
      ).toString('base64');

      const result = await paginateCursor(db.selectFrom('products').selectAll(), {
        cursor: validCursor,
        orderBy: [
          { column: 'score', direction: 'asc' },
          { column: 'created_at', direction: 'asc' },
        ],
      });

      // Should work and return results after score 80, created_at '2024-01-01'
      expect(result.data.length).toBeGreaterThanOrEqual(0);
      for (const item of result.data) {
        expect(item.score > 80 || (item.score === 80 && item.created_at > '2024-01-01')).toBe(true);
      }
    });

    it('should handle empty cursor string', async () => {
      // Empty string should be treated as no cursor
      const result = await paginateCursor(db.selectFrom('products').selectAll(), {
        cursor: '',
        orderBy: [{ column: 'score', direction: 'asc' }],
        limit: 100,
      });

      // Should return first page since empty cursor is falsy
      expect(result.data).toHaveLength(10); // All 10 products
      expect(result.data[0]?.score).toBe(50); // Starts from lowest score
    });
  });
});
