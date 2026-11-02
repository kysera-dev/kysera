import type { KyseraConfigInput } from './config/schema.js'

export type { KyseraConfig, KyseraConfigInput } from './config/schema.js'
export type { SeedContext } from './commands/db/seed-runner.js'

/** Preserve the supplied configuration. The loader applies schema defaults on read. */
export function defineConfig<T extends KyseraConfigInput>(config: T): T {
  return config
}
