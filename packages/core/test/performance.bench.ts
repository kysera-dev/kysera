import { describe, bench } from 'vitest'
import { Kysely, SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'
import { paginateCursor } from '../src/index.js'

describe('Performance Benchmarks', () => {
  describe('Cursor Encoding', () => {
    bench('single-column cursor encoding (optimized)', () => {
      const data = { id: 12345 }
      const orderBy = [{ column: 'id' as const, direction: 'asc' as const }]

      // Simulate what encodeCursor does internally
      const column = orderBy[0]!.column
      const value = data[column]
      const columnB64 = btoa(encodeURIComponent(String(column)))
      const valueB64 = btoa(encodeURIComponent(JSON.stringify(value)))
      void `${columnB64}:${valueB64}`
    })

    bench('single-column cursor encoding (old JSON approach)', () => {
      const data = { id: 12345 }
      const orderBy = [{ column: 'id' as const, direction: 'asc' as const }]

      // Old approach: always use JSON
      type ColumnKey = 'id'
      const cursorObj = orderBy.reduce(
        (acc, { column }) => {
          acc[column] = data[column]
          return acc
        },
        {} as Record<ColumnKey, number>
      )

      void btoa(encodeURIComponent(JSON.stringify(cursorObj)))
    })

    bench('multi-column cursor encoding', () => {
      const data = { score: 100, created_at: '2024-01-01', id: 12345 }
      const orderBy = [
        { column: 'score' as const, direction: 'desc' as const },
        { column: 'created_at' as const, direction: 'asc' as const },
        { column: 'id' as const, direction: 'asc' as const }
      ]

      type ColumnKey = 'score' | 'created_at' | 'id'
      const cursorObj = orderBy.reduce(
        (acc, { column }) => {
          acc[column] = data[column]
          return acc
        },
        {} as Record<ColumnKey, number | string>
      )

      void btoa(encodeURIComponent(JSON.stringify(cursorObj)))
    })
  })

  // Debug Plugin benchmarks moved to @kysera/debug package
  // to avoid circular dependency with @kysera/core

  describe('Pagination Query Performance', () => {
    const database = new Database(':memory:')
    const db = new Kysely<{
      products: { id: number; name: string; score: number; created_at: string }
    }>({
      dialect: new SqliteDialect({ database })
    })

    // Create test table with data
    database.exec(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        score INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `)

    // Insert 1000 test rows
    const values = Array.from(
      { length: 1000 },
      (_, i) => `('Product ${i}', ${Math.floor(Math.random() * 100)}, '2024-01-0${(i % 9) + 1}')`
    ).join(',')
    database.exec(`INSERT INTO products (name, score, created_at) VALUES ${values}`)

    bench('cursor pagination - single column', async () => {
      const result = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 20,
        orderBy: [{ column: 'id', direction: 'asc' }]
      })
      void result.data.length
    })

    bench('cursor pagination - multi-column', async () => {
      const result = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 20,
        orderBy: [
          { column: 'score', direction: 'desc' },
          { column: 'created_at', direction: 'asc' }
        ]
      })
      void result.data.length
    })

    bench('cursor pagination - with cursor (second page)', async () => {
      // Get first page
      const page1 = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 20,
        orderBy: [{ column: 'id', direction: 'asc' }]
      })

      // Benchmark second page retrieval
      const result = await paginateCursor(db.selectFrom('products').selectAll(), {
        limit: 20,
        cursor: page1.pagination.nextCursor,
        orderBy: [{ column: 'id', direction: 'asc' }]
      })
      void result.data.length
    })
  })
})
