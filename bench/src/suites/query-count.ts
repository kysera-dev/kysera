/**
 * Suite (c): mutation round-trip query COUNT — not time.
 *
 * A counting driver records every statement that reaches SQLite (BEGIN/COMMIT
 * included) while a repository built with the full mutation stack
 * (rls + audit + soft-delete) performs single operations under a regular
 * tenant context (non-system, so no bypass).
 *
 * This documents the P0.3 baseline: today each mutation-guarding plugin
 * fetches the target row independently (RLS guard fetch + audit old-values
 * fetch), so one `update` triggers redundant SELECTs of the same row. When
 * the shared per-operation row-fetch cache lands, the SELECT count reported
 * here is the number that must drop.
 */
import { auditPlugin } from '@kysera/audit'
import { createORM } from '@kysera/repository'
import { rlsContext, rlsPlugin } from '@kysera/rls'
import { softDeletePlugin, type SoftDeleteMethods } from '@kysera/soft-delete'
import { QueryRecorder, withQueryCounting, type RecordedStatement } from '../counting.js'
import {
  benchRLSSchema,
  makeUserRepository,
  tenantUserContext,
  type UserRepository
} from '../fixtures.js'
import { createBenchDb, seedUsers, type UserRow } from '../schema.js'
import type { QueryCountEntry } from '../report.js'

type StackedRepository = UserRepository & SoftDeleteMethods<UserRow>

function countKind(statements: RecordedStatement[], kind: string): number {
  return statements.filter(statement => statement.kind === kind).length
}

function assertInvariant(
  condition: boolean,
  message: string,
  statements: RecordedStatement[]
): void {
  if (condition) return
  const trace = statements.map((s, i) => `  ${i + 1}. [${s.kind}] ${s.sql}`).join('\n')
  throw new Error(`Query-count invariant violated: ${message}\nRecorded statements:\n${trace}`)
}

export interface QueryCountResult {
  entries: QueryCountEntry[]
  notes: string[]
}

export async function runQueryCountSuite(): Promise<QueryCountResult> {
  const recorder = new QueryRecorder()
  const handle = createBenchDb(inner => withQueryCounting(inner, recorder))
  const { db } = handle
  await seedUsers(db, 10, 'qc')

  const orm = await createORM(db, [
    rlsPlugin({ schema: benchRLSSchema }),
    auditPlugin({ auditTable: 'audit_logs', getUserId: () => 'bench-user' }),
    softDeletePlugin({ tables: ['users'] })
  ])
  const repo = orm.createRepository(executor =>
    makeUserRepository(executor)
  ) as unknown as StackedRepository

  const entries: QueryCountEntry[] = []

  const record = async (
    operation: string,
    run: () => Promise<unknown>
  ): Promise<RecordedStatement[]> => {
    recorder.start()
    await run()
    recorder.stop()
    const statements = [...recorder.statements]
    const byKind: Record<string, number> = {}
    for (const statement of statements) {
      byKind[statement.kind] = (byKind[statement.kind] ?? 0) + 1
    }
    entries.push({ operation, statements, byKind })
    return statements
  }

  await rlsContext.runAsync(tenantUserContext(), async () => {
    const updateStatements = await record('update(id, { name })', async () => {
      return await repo.update(1, { name: 'Updated by bench' })
    })
    assertInvariant(
      countKind(updateStatements, 'update') === 1,
      `expected exactly 1 UPDATE for repo.update, saw ${countKind(updateStatements, 'update')}`,
      updateStatements
    )
    assertInvariant(
      updateStatements.some(s => s.kind === 'insert' && s.sql.includes('audit_logs')),
      'expected an INSERT into audit_logs for repo.update',
      updateStatements
    )

    const createStatements = await record('create(data)', async () => {
      return await repo.create({
        email: 'qc-created@bench.invalid',
        name: 'QC Created',
        tenant_id: 1
      })
    })
    assertInvariant(
      countKind(createStatements, 'insert') === 2,
      `expected 2 INSERTs for repo.create (row + audit entry), saw ${countKind(createStatements, 'insert')}`,
      createStatements
    )

    const findStatements = await record('findById(id)', async () => {
      return await repo.findById(2)
    })
    assertInvariant(
      findStatements.length === 1 && countKind(findStatements, 'select') === 1,
      `expected exactly 1 SELECT for repo.findById, saw ${findStatements.length} statements`,
      findStatements
    )

    await record('softDelete(id)', async () => {
      return await repo.softDelete(3)
    })
  })

  await handle.destroy()

  const update = entries[0]!
  const updateSelects = countKind(update.statements, 'select')
  const updateTotal = update.statements.length

  const notes = [
    `**Finding:** one \`repo.update()\` under the stacked mutation plugins currently costs **${updateTotal} statements**, including **${updateSelects} SELECT${updateSelects === 1 ? '' : 's'} of the target row** before the UPDATE.`,
    updateSelects >= 2
      ? 'The SELECTs are redundant fetches of the *same row* by different plugins (RLS mutation guard and audit old-values capture do not share their read). This is the documented baseline for the shared row-fetch optimization (P0.3): after that change the redundant SELECTs should collapse into one.'
      : 'Only one pre-UPDATE row fetch was recorded — the shared row-fetch optimization (P0.3) appears to have landed; this table now documents the post-fix behavior.',
    'BEGIN/COMMIT pairs come from the audit plugin, which wraps the mutation and its audit entry in a transaction so they commit or roll back together — that is deliberate correctness work, not waste.',
    'Counts are structural (per call), so they are machine-independent; on a networked database each extra statement is a full round-trip.'
  ]

  return { entries, notes }
}
