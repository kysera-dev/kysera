import { Command } from 'commander'
import { databaseCommand } from './database.js'
import { modelCommand } from './model.js'
import { repositoryCommand } from './repository.js'
import { schemaCommand } from './schema.js'
import { crudCommand } from './crud.js'

export function generateCommand(): Command {
  const cmd = new Command('generate').alias('g').description('Generate code from database schema')

  cmd.addCommand(databaseCommand())
  cmd.addCommand(modelCommand())
  cmd.addCommand(repositoryCommand())
  cmd.addCommand(schemaCommand())
  cmd.addCommand(crudCommand())

  return cmd
}
