/**
 * Suite (e): paginate() vs paginateCursor() on 10 000 rows.
 *
 * Offset pagination pays a COUNT(*) on every call plus OFFSET scan cost that
 * grows with depth. Cursor pagination issues a single indexed WHERE query
 * regardless of depth. Both are measured shallow and deep.
 */
import { paginate, paginateCursor } from '@kysera/core'
import { createBenchDb, seedUsers } from '../schema.js'
import { createBench, findTask, runAndCollect, SHAPES, type SuiteTable } from '../runner.js'

const SEED_COUNT = 10_000
const PAGE_SIZE = 50

export async function runPaginationSuite(): Promise<SuiteTable> {
  const handle = createBenchDb()
  const { db } = handle
  await seedUsers(db, SEED_COUNT)

  const baseQuery = () => db.selectFrom('users').select(['id', 'email', 'name'])
  const orderBy: { column: 'id'; direction: 'asc' }[] = [{ column: 'id', direction: 'asc' }]

  // Pre-compute a cursor pointing at the middle of the table via the public
  // API, so the deep-cursor task decodes a realistic production cursor.
  const midPage = await paginateCursor(baseQuery(), { orderBy, limit: SEED_COUNT / 2 })
  const midCursor = midPage.pagination.nextCursor
  if (!midCursor) throw new Error('Failed to pre-compute mid-table cursor')

  const bench = createBench('pagination', SHAPES.pagination)

  bench.add('paginate page 1 (limit 50)', async () => {
    await paginate(baseQuery().orderBy('id', 'asc'), { page: 1, limit: PAGE_SIZE })
  })

  bench.add('paginate page 100 (limit 50, offset 4 950)', async () => {
    await paginate(baseQuery().orderBy('id', 'asc'), { page: 100, limit: PAGE_SIZE })
  })

  bench.add('paginate page 190 (limit 50, offset 9 450)', async () => {
    await paginate(baseQuery().orderBy('id', 'asc'), { page: 190, limit: PAGE_SIZE })
  })

  bench.add('paginateCursor first page (limit 50)', async () => {
    await paginateCursor(baseQuery(), { orderBy, limit: PAGE_SIZE })
  })

  bench.add('paginateCursor mid-table (limit 50, from row 5 000)', async () => {
    await paginateCursor(baseQuery(), { orderBy, cursor: midCursor, limit: PAGE_SIZE })
  })

  const tasks = await runAndCollect(bench)
  await handle.destroy()

  const baseline = 'paginate page 1 (limit 50)'
  const offsetDeep = findTask(tasks, 'paginate page 190 (limit 50, offset 9 450)')
  const cursorFirst = findTask(tasks, 'paginateCursor first page (limit 50)')
  const cursorDeep = findTask(tasks, 'paginateCursor mid-table (limit 50, from row 5 000)')

  const deepGap = (cursorDeep.opsPerSec / offsetDeep.opsPerSec).toFixed(1)

  return {
    title: 'paginate() vs paginateCursor() — 10 000 rows',
    caption:
      'Offset pagination (`paginate`) runs 2 statements per call (COUNT(*) + LIMIT/OFFSET data query). Cursor pagination (`paginateCursor`) runs 1 statement (indexed WHERE + LIMIT n+1) and encodes/decodes cursors in JS.',
    baseline,
    tasks,
    notes: [
      `Cursor pagination is ${(cursorFirst.opsPerSec / findTask(tasks, baseline).opsPerSec).toFixed(1)}× the throughput of offset pagination on the first page, mostly because it skips the per-call COUNT(*) over all 10 000 rows.`,
      `Depth is the structural argument: going from page 1 to page 190 divides offset-pagination throughput by ${(findTask(tasks, baseline).opsPerSec / offsetDeep.opsPerSec).toFixed(2)} (OFFSET scans and discards 9 450 rows), so at depth the cursor variant delivers ${deepGap}× the throughput.`,
      `The gap between the two cursor tasks themselves (median ${cursorFirst.medianUs.toFixed(0)} µs first page vs ${cursorDeep.medianUs.toFixed(0)} µs mid-table) is constant per-call bookkeeping — decoding the incoming cursor and encoding an extra prevCursor — and does not grow with depth.`,
      'If totals are not needed, cursor pagination is strictly cheaper; `paginate` remains the right call when the UI requires a total page count.'
    ]
  }
}
