import { Command } from 'commander'
import { baselineCommand } from './baseline.js'
import { createCommand } from './create.js'
import { downCommand } from './down.js'
import { listCommand } from './list.js'
import { resetCommand, freshCommand } from './reset.js'
import { statusCommand } from './status.js'
import { upCommand } from './up.js'
import { verifyCommand } from './verify.js'

export function migrateCommand(): Command {
  const cmd = new Command('migrate').description('Manage database migrations')

  cmd.addCommand(createCommand())
  cmd.addCommand(upCommand())
  cmd.addCommand(downCommand())
  cmd.addCommand(statusCommand())
  cmd.addCommand(listCommand())
  cmd.addCommand(baselineCommand())
  cmd.addCommand(verifyCommand())
  cmd.addCommand(resetCommand())
  cmd.addCommand(freshCommand())

  return cmd
}
