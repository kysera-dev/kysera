import { Command } from 'commander'
import { seedCommand } from './seed.js'
import { resetCommand } from './reset.js'
import { tablesCommand } from './tables.js'
import { dumpCommand } from './dump.js'
import { restoreCommand } from './restore.js'
import { introspectCommand } from './introspect.js'
import { consoleCommand } from './console.js'

export function dbCommand(): Command {
  const cmd = new Command('db')
    .description('Database utilities and operations')

  // Add subcommands
  cmd.addCommand(seedCommand())
  cmd.addCommand(resetCommand())
  cmd.addCommand(tablesCommand())
  cmd.addCommand(dumpCommand())
  cmd.addCommand(restoreCommand())
  cmd.addCommand(introspectCommand())
  cmd.addCommand(consoleCommand())

  return cmd
}