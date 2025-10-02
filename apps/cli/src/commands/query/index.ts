import { Command } from 'commander'

// Import query commands
import { byTimestampCommand } from './by-timestamp.js'
import { softDeletedCommand } from './soft-deleted.js'
import { analyzeCommand } from './analyze.js'
import { explainCommand } from './explain.js'

export function queryCommand(): Command {
  const cmd = new Command('query')
    .description('Database query utilities and tools')
    .addHelpText('after', `

Examples:
  kysera query by-timestamp users --today                Query today's records
  kysera query by-timestamp orders --last-days 7         Query last 7 days
  kysera query soft-deleted users --action list          List soft-deleted users
  kysera query analyze "SELECT * FROM users WHERE..."    Analyze query performance
  kysera query explain "SELECT * FROM orders WHERE..."   Show execution plan

Subcommands:
  by-timestamp    Query records by timestamp ranges
  soft-deleted    Manage soft-deleted records
  analyze         Analyze query performance
  explain         Show query execution plan

For more information on a subcommand, run:
  kysera query <subcommand> --help
`)

  // Add subcommands
  cmd.addCommand(byTimestampCommand())
  cmd.addCommand(softDeletedCommand())
  cmd.addCommand(analyzeCommand())
  cmd.addCommand(explainCommand())

  return cmd
}