import { Command } from 'commander'
import { createCommand } from './create.js'
import { upCommand } from './up.js'
import { downCommand } from './down.js'
import { statusCommand } from './status.js'
import { listCommand } from './list.js'
import { resetCommand, freshCommand } from './reset.js'

export function migrateCommand(): Command {
  const cmd = new Command('migrate')
    .description('Manage database migrations')

  // Add subcommands
  cmd.addCommand(createCommand())
  cmd.addCommand(upCommand())
  cmd.addCommand(downCommand())
  cmd.addCommand(statusCommand())
  cmd.addCommand(listCommand())
  cmd.addCommand(resetCommand())
  cmd.addCommand(freshCommand())

  return cmd
}