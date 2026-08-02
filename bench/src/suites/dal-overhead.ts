/**
 * Suite (d): DAL query-function call overhead.
 *
 * `createQuery` wraps a plain function with context normalization
 * (`toContext`). This suite measures that wrapper against calling Kysely
 * directly, and against the same query function fed a KyseraExecutor.
 */
import { createQuery, type DbContext } from '@kysera/dal'
import { createExecutor } from '@kysera/executor'
import { softDeletePlugin } from '@kysera/soft-delete'
import { createBenchDb, seedUsers, type BenchDb } from '../schema.js'
import { createBench, pctPhrase, runAndCollect, SHAPES, type SuiteTable } from '../runner.js'

const SEED_COUNT = 1000

export async function runDalOverheadSuite(): Promise<SuiteTable> {
  const handle = createBenchDb()
  const { db } = handle
  await seedUsers(db, SEED_COUNT)

  const executorNoPlugins = await createExecutor(db, [])
  const executorSoftDelete = await createExecutor(db, [softDeletePlugin({ tables: ['users'] })])

  const getUserById = createQuery((ctx: DbContext<BenchDb>, id: number) =>
    ctx.db.selectFrom('users').select(['id', 'name']).where('id', '=', id).executeTakeFirst()
  )

  const bench = createBench('dal overhead', SHAPES.dal)

  let a = 0
  bench.add('direct kysely call', async () => {
    await db
      .selectFrom('users')
      .select(['id', 'name'])
      .where('id', '=', (a++ % SEED_COUNT) + 1)
      .executeTakeFirst()
  })

  let b = 0
  bench.add('DAL query fn (raw db)', async () => {
    await getUserById(db, (b++ % SEED_COUNT) + 1)
  })

  let c = 0
  bench.add('DAL query fn (executor, 0 plugins)', async () => {
    await getUserById(executorNoPlugins, (c++ % SEED_COUNT) + 1)
  })

  let d = 0
  bench.add('DAL query fn (executor + soft-delete)', async () => {
    await getUserById(executorSoftDelete, (d++ % SEED_COUNT) + 1)
  })

  const tasks = await runAndCollect(bench)
  await handle.destroy()

  const baseline = 'direct kysely call'
  return {
    title: 'DAL query-function call overhead',
    caption:
      'The same single-row select called directly on Kysely vs through a `createQuery` function (which normalizes its first argument into a `DbContext` per call), vs the DAL function over KyseraExecutor.',
    baseline,
    tasks,
    notes: [
      `Wrapping the call in a DAL query function keeps ${pctPhrase(tasks, baseline, 'DAL query fn (raw db)')} of direct-call throughput — the wrapper is one function call plus one small context object per invocation.`,
      `Feeding the same query function an executor yields ${pctPhrase(tasks, baseline, 'DAL query fn (executor, 0 plugins)')} (no plugins) and ${pctPhrase(tasks, baseline, 'DAL query fn (executor + soft-delete)')} (soft-delete filter applied).`
    ]
  }
}
