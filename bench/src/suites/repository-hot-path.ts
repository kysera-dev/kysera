/**
 * Suite (b): repository hot path.
 *
 * create / findById / update through `createRepositoryFactory`, comparing a
 * repository over plain Kysely against repositories built by the plugin ORM
 * (`createORM`). All variants share the same factory and the same Zod
 * validation schemas, so the delta is plugin machinery, not validation.
 *
 * Each variant owns a separate in-memory database with an identical seed, and
 * every op runs a fixed number of iterations, so table growth stays symmetric
 * across variants.
 */
import { createORM } from '@kysera/repository'
import { rlsContext, rlsPlugin } from '@kysera/rls'
import { softDeletePlugin } from '@kysera/soft-delete'
import { timestampsPlugin } from '@kysera/timestamps'
import {
  benchRLSSchema,
  makeUserRepository,
  systemContext,
  type UserRepository
} from '../fixtures.js'
import { createBenchDb, seedUsers, type BenchDbHandle } from '../schema.js'
import { createBench, pctPhrase, runAndCollect, SHAPES, type SuiteTable } from '../runner.js'

const SEED_COUNT = 1000

interface Variant {
  name: string
  handle: BenchDbHandle
  repo: UserRepository
}

async function setupVariants(): Promise<Variant[]> {
  const rawHandle = createBenchDb()
  await seedUsers(rawHandle.db, SEED_COUNT)
  const rawRepo = makeUserRepository(rawHandle.db)

  const sdHandle = createBenchDb()
  await seedUsers(sdHandle.db, SEED_COUNT)
  const sdOrm = await createORM(sdHandle.db, [softDeletePlugin({ tables: ['users'] })])
  const sdRepo = sdOrm.createRepository(executor => makeUserRepository(executor))

  const fullHandle = createBenchDb()
  await seedUsers(fullHandle.db, SEED_COUNT)
  const fullOrm = await createORM(fullHandle.db, [
    softDeletePlugin({ tables: ['users'] }),
    timestampsPlugin(),
    rlsPlugin({ schema: benchRLSSchema })
  ])
  const fullRepo = fullOrm.createRepository(executor => makeUserRepository(executor))

  return [
    { name: 'plain repository (no ORM)', handle: rawHandle, repo: rawRepo },
    { name: 'ORM + soft-delete', handle: sdHandle, repo: sdRepo },
    { name: 'ORM + soft-delete + timestamps + rls', handle: fullHandle, repo: fullRepo }
  ]
}

export async function runRepositoryHotPathSuite(): Promise<SuiteTable[]> {
  const variants = await setupVariants()
  const baseline = 'plain repository (no ORM)'

  const findBench = createBench('repository findById', SHAPES.repoRead)
  for (const variant of variants) {
    let i = 0
    findBench.add(variant.name, async () => {
      await variant.repo.findById((i++ % SEED_COUNT) + 1)
    })
  }

  const createBenchInstance = createBench('repository create', SHAPES.repoWrite)
  variants.forEach((variant, variantIndex) => {
    let i = 0
    // Fixed-length prefix per variant so every variant inserts byte-identical
    // email shapes (unique-index work stays symmetric).
    const prefix = `v${variantIndex}`
    createBenchInstance.add(variant.name, async () => {
      await variant.repo.create({
        email: `${prefix}-${i++}@bench.invalid`,
        name: 'Bench Create',
        tenant_id: 1
      })
    })
  })

  const updateBench = createBench('repository update', SHAPES.repoWrite)
  for (const variant of variants) {
    let i = 0
    updateBench.add(variant.name, async () => {
      i++
      await variant.repo.update((i % SEED_COUNT) + 1, { name: `Updated ${i}` })
    })
  }

  // System context: the RLS-bearing variant dispatches through the plugin but
  // takes the privileged bypass, keeping the workload identical across ops.
  const [findTasks, createTasks, updateTasks] = await rlsContext.runAsync(
    systemContext(),
    async () => {
      const found = await runAndCollect(findBench)
      const created = await runAndCollect(createBenchInstance)
      const updated = await runAndCollect(updateBench)
      return [found, created, updated] as const
    }
  )

  for (const variant of variants) {
    await variant.handle.destroy()
  }

  const full = 'ORM + soft-delete + timestamps + rls'
  return [
    {
      title: 'Repository hot path — findById',
      caption:
        '`repo.findById(id)` over 1 000 seeded rows, ids cycling 1..1000. Identical Zod schemas everywhere; the ORM variants add plugin interception (soft-delete WHERE) and, for the full stack, RLS dispatch under a system context.',
      baseline,
      tasks: findTasks,
      notes: [
        `Reads through the plugin ORM run at ${pctPhrase(findTasks, baseline, 'ORM + soft-delete')} (soft-delete) and ${pctPhrase(findTasks, baseline, full)} (full stack) of the plain repository.`
      ]
    },
    {
      title: 'Repository hot path — create',
      caption:
        '`repo.create(data)` with Zod validation. The full stack adds timestamp injection into the INSERT and RLS create-policy dispatch (bypassed via system context).',
      baseline,
      tasks: createTasks,
      notes: [
        `Creates run at ${pctPhrase(createTasks, baseline, 'ORM + soft-delete')} (soft-delete) and ${pctPhrase(createTasks, baseline, full)} (full stack) of the plain repository.`
      ]
    },
    {
      title: 'Repository hot path — update',
      caption:
        '`repo.update(id, { name })` with Zod validation, ids cycling 1..1000. The full stack injects `updated_at` and dispatches RLS update guards (bypassed via system context).',
      baseline,
      tasks: updateTasks,
      notes: [
        `Updates run at ${pctPhrase(updateTasks, baseline, 'ORM + soft-delete')} (soft-delete) and ${pctPhrase(updateTasks, baseline, full)} (full stack) of the plain repository.`,
        'For non-system callers RLS adds a guard row-fetch per mutation — that cost is quantified in the query-count suite below, not here.'
      ]
    }
  ]
}
