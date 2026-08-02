import { Command } from 'commander'
import { generateCommand } from './generate.js'
import { migrationCommand } from './migration.js'

export function rlsCommand(): Command {
  const cmd = new Command('rls').description(
    'Row-Level Security utilities (native PostgreSQL policies)'
  )

  cmd.addCommand(generateCommand())
  cmd.addCommand(migrationCommand())

  return cmd
}
