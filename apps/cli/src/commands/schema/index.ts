import { Command } from 'commander'
import { listCommand } from './list.js'
import { createCommand } from './create.js'
import { dropCommand } from './drop.js'
import { infoCommand } from './info.js'
import { cloneCommand } from './clone.js'
import { compareCommand } from './compare.js'

export function schemaCommand(): Command {
  const cmd = new Command('schema').description(
    'PostgreSQL schema management for multi-tenant and modular architectures'
  )

  // Add subcommands
  cmd.addCommand(listCommand())
  cmd.addCommand(createCommand())
  cmd.addCommand(dropCommand())
  cmd.addCommand(infoCommand())
  cmd.addCommand(cloneCommand())
  cmd.addCommand(compareCommand())

  return cmd
}
