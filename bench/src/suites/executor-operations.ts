import { createExecutorSync, type Plugin } from '@kysera/executor'
import { createBench, runAndCollect, SHAPES, type SuiteTable } from '../runner.js'
import { createBenchDb, seedUsers } from '../schema.js'

export async function runExecutorOperationsSuite(): Promise<SuiteTable[]> {
  const handle = createBenchDb()
  const { db } = handle
  try {
    await seedUsers(db, 1)
    const marker: Plugin = { name: 'marker', version: '1.0.0' }
    const observer: Plugin = { ...marker, interceptQuery: builder => builder }
    const construction = createBench('sync executor construction', SHAPES.compile)
    construction.add('0 plugins', () => { createExecutorSync(db, []) })
    construction.add('marker only', () => { createExecutorSync(db, [marker]) })
    construction.add('1 interceptor', () => { createExecutorSync(db, [observer]) })

    const executor = createExecutorSync(db, [observer])
    const queries = createBench('SQLite statement throughput', SHAPES.repoWrite)
    let sequence = 0
    queries.add('select one', async () => { await executor.selectFrom('users').select('id').where('id', '=', 1).execute() })
    queries.add('insert one', async () => {
      await executor.insertInto('users').values({ email: `bench-${++sequence}@invalid.test`, name: 'bench', tenant_id: 1,
        deleted_at: null, created_at: null, updated_at: null }).execute()
    })
    queries.add('update one', async () => { await executor.updateTable('users').set({ name: 'bench' }).where('id', '=', 1).execute() })
    queries.add('delete miss', async () => { await executor.deleteFrom('users').where('id', '=', -1).execute() })
    return [
      { title: 'Synchronous executor construction', caption: 'Creation over an existing Kysely connection.', baseline: '0 plugins',
        tasks: await runAndCollect(construction), notes: [] },
      { title: 'Executor statement throughput', caption: 'One pass-through interceptor over in-memory SQLite. Each insert uses a new key.', baseline: 'select one',
        tasks: await runAndCollect(queries), notes: [] }
    ]
  } finally { await handle.destroy() }
}
