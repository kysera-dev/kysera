import { Command } from 'commander'

// Import repository commands
import { listRepositoriesCommand } from './list.js'
import { inspectRepositoryCommand } from './inspect.js'
import { validateRepositoryCommand } from './validate.js'
import { showMethodsCommand } from './methods.js'

export function repositoryCommand(): Command {
  const cmd = new Command('repository')
    .description('Repository introspection and management')
    .addHelpText('after', `

Examples:
  kysera repository list --show-methods        List all repositories with methods
  kysera repository inspect UserRepository     Inspect specific repository
  kysera repository validate --strict          Validate all repositories strictly
  kysera repository methods --show-signatures  Show repository method signatures

Subcommands:
  list        List all repository classes
  inspect     Inspect a repository in detail
  validate    Validate schemas against database
  methods     Show available methods

For more information on a subcommand, run:
  kysera repository <subcommand> --help
`)

  // Add subcommands
  cmd.addCommand(listRepositoriesCommand())
  cmd.addCommand(inspectRepositoryCommand())
  cmd.addCommand(validateRepositoryCommand())
  cmd.addCommand(showMethodsCommand())

  return cmd
}