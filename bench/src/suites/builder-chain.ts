/**
 * Suite (a): builder-chain overhead.
 *
 * The same query — `selectFrom('users').select(['id','name']).where('id','=',N)`
 * — is built through raw Kysely and through KyseraExecutor proxies with a
 * growing plugin stack. Measured twice: compile-only (builder + plugin
 * interception + SQL compilation, no I/O) and full execution against
 * in-memory SQLite.
 *
 * Note the honest asymmetry: with soft-delete attached the compiled SQL gains
 * a `deleted_at is null` predicate, so the variant does strictly more work by
 * design — that extra WHERE *is* the feature.
 */
import { createExecutor } from '@kysera/executor'
import { rlsContext, rlsPlugin } from '@kysera/rls'
import { softDeletePlugin } from '@kysera/soft-delete'
import { timestampsPlugin } from '@kysera/timestamps'
import type { Kysely } from 'kysely'
import { benchRLSSchema, systemContext } from '../fixtures.js'
import { createBenchDb, seedUsers, type BenchDb } from '../schema.js'
import { createBench, pctPhrase, runAndCollect, SHAPES, type SuiteTable } from '../runner.js'

const SEED_COUNT = 1000

function buildQuery(source: Kysely<BenchDb>, id: number) {
  return source.selectFrom('users').select(['id', 'name']).where('id', '=', id)
}

export async function runBuilderChainSuite(): Promise<SuiteTable[]> {
  const handle = createBenchDb()
  const { db } = handle
  await seedUsers(db, SEED_COUNT)

  const executorNoPlugins = await createExecutor(db, [])
  const executorSoftDelete = await createExecutor(db, [softDeletePlugin({ tables: ['users'] })])
  const executorFullStack = await createExecutor(db, [
    softDeletePlugin({ tables: ['users'] }),
    timestampsPlugin(),
    rlsPlugin({ schema: benchRLSSchema })
  ])

  const variants: [string, Kysely<BenchDb>][] = [
    ['raw kysely', db],
    ['executor, 0 plugins', executorNoPlugins],
    ['executor + soft-delete', executorSoftDelete],
    ['executor + soft-delete + timestamps + rls', executorFullStack]
  ]

  const compileBench = createBench('builder-chain compile', SHAPES.compile)
  for (const [name, source] of variants) {
    let i = 0
    compileBench.add(name, () => {
      buildQuery(source, (i++ % SEED_COUNT) + 1).compile()
    })
  }

  const executeBench = createBench('builder-chain execute', SHAPES.execute)
  for (const [name, source] of variants) {
    let i = 0
    executeBench.add(name, async () => {
      await buildQuery(source, (i++ % SEED_COUNT) + 1).execute()
    })
  }

  // The RLS variant requires an active context even for interception checks.
  // Running the whole bench inside a system context keeps the per-op cost
  // limited to plugin dispatch (AsyncLocalStorage read + bypass), which is
  // exactly the "rls attached, privileged caller" scenario.
  const [compileTasks, executeTasks] = await rlsContext.runAsync(systemContext(), async () => {
    const compiled = await runAndCollect(compileBench)
    const executed = await runAndCollect(executeBench)
    return [compiled, executed] as const
  })

  await handle.destroy()

  const baseline = 'raw kysely'
  const compileSuite: SuiteTable = {
    title: 'Builder-chain overhead — compile only',
    caption:
      "Cost of building **and compiling** `selectFrom('users').select(['id','name']).where('id','=',N)` to SQL. No query is executed; this isolates proxy dispatch, plugin interception and compilation.",
    baseline,
    tasks: compileTasks,
    notes: [
      `A marker-only executor (0 plugins) compiles at ${pctPhrase(compileTasks, baseline, 'executor, 0 plugins')} of raw Kysely throughput, soft-delete brings it to ${pctPhrase(compileTasks, baseline, 'executor + soft-delete')} (part of that is compiling the extra \`deleted_at is null\` predicate the plugin exists to add), and the 3-plugin stack lands at ${pctPhrase(compileTasks, baseline, 'executor + soft-delete + timestamps + rls')}.`,
      'Compile-only is the worst case for relative overhead because there is no I/O to amortize against; it is µs-scale work either way.'
    ]
  }

  const executeSuite: SuiteTable = {
    title: 'Builder-chain overhead — execute',
    caption:
      'Same query, executed against in-memory SQLite (1 000 seeded rows). This is the fairest proxy for real single-query cost on the fastest possible backend.',
    baseline,
    tasks: executeTasks,
    notes: [
      `Once the query actually runs, relative throughput is ${pctPhrase(executeTasks, baseline, 'executor, 0 plugins')} (0 plugins), ${pctPhrase(executeTasks, baseline, 'executor + soft-delete')} (soft-delete) and ${pctPhrase(executeTasks, baseline, 'executor + soft-delete + timestamps + rls')} (full stack) of raw Kysely.`,
      'In-memory SQLite is a synchronous, zero-latency backend — the most hostile setting for measuring wrapper overhead. Any network round-trip (~100 µs LAN, ~1 ms cloud) shrinks these percentages toward 100 %.'
    ]
  }

  return [compileSuite, executeSuite]
}
