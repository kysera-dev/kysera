import { Command } from 'commander'
import { logsCommand } from './logs.js'
import { historyCommand } from './history.js'
import { restoreCommand } from './restore.js'
import { statsCommand } from './stats.js'
import { cleanupCommand } from './cleanup.js'
import { compareCommand } from './compare.js'
import { diffCommand } from './diff.js'

export function auditCommand(): Command {
  const cmd = new Command('audit')
    .description('Audit logging and history tracking')

  // Add subcommands
  cmd.addCommand(logsCommand())
  cmd.addCommand(historyCommand())
  cmd.addCommand(restoreCommand())
  cmd.addCommand(statsCommand())
  cmd.addCommand(cleanupCommand())
  cmd.addCommand(compareCommand())
  cmd.addCommand(diffCommand())

  return cmd
}