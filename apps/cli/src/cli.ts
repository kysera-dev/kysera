import { Command } from 'commander'
import chalk from 'chalk'
import { loadConfig } from './config/loader.js'
import { logger } from './utils/logger.js'
import { handleError } from './utils/errors.js'

// Import commands (to be implemented)
// import { initCommand } from './commands/init/index.js'
// import { migrateCommand } from './commands/migrate/index.js'
// import { healthCommand } from './commands/health/index.js'
// import { auditCommand } from './commands/audit/index.js'
// import { generateCommand } from './commands/generate/index.js'
// import { dbCommand } from './commands/db/index.js'
// import { testCommand } from './commands/test/index.js'
// import { pluginCommand } from './commands/plugin/index.js'
// import { debugCommand } from './commands/debug/index.js'
// import { queryCommand } from './commands/query/index.js'
// import { repositoryCommand } from './commands/repository/index.js'

export async function cli(argv: string[]): Promise<void> {
  const program = new Command()

  // Configure CLI
  program
    .name('kysera')
    .description('Comprehensive command-line interface for Kysera ORM')
    .version(process.env['KYSERA_CLI_VERSION'] || '0.1.0', '-v, --version', 'Show CLI version')
    .helpCommand('help [command]', 'Display help for command')
    .helpOption('-h, --help', 'Display help')
    .addHelpText('after', `
${chalk.gray('Examples:')}
  ${chalk.cyan('kysera init my-app')}              Initialize new project
  ${chalk.cyan('kysera migrate up')}               Run pending migrations
  ${chalk.cyan('kysera generate crud User')}       Generate CRUD for User
  ${chalk.cyan('kysera health check')}             Check database health

${chalk.gray('Documentation:')} ${chalk.underline.blue('https://kysera.dev/docs/cli')}
${chalk.gray('GitHub:')} ${chalk.underline.blue('https://github.com/kysera/kysera')}
`)

  // Global options
  program
    .option('-c, --config <path>', 'Path to configuration file', 'kysera.config.ts')
    .option('--env <environment>', 'Environment (development/production/test)', 'development')
    .option('--verbose', 'Verbose output', false)
    .option('--quiet', 'Suppress non-essential output', false)
    .option('--no-color', 'Disable colored output')
    .option('--json', 'Output results as JSON', false)

  // Global hooks
  program.hook('preAction', async (thisCommand, actionCommand) => {
    const opts = actionCommand.opts()

    // Set up environment
    process.env.NODE_ENV = opts.env || process.env.NODE_ENV || 'development'

    // Configure chalk colors
    if (opts.color === false) {
      process.env.FORCE_COLOR = '0'
    }

    // Set logging level
    if (opts.verbose) {
      logger.level = 'debug'
    } else if (opts.quiet) {
      logger.level = 'error'
    }

    // Load configuration
    try {
      const config = await loadConfig(opts.config)
      actionCommand.setOptionValue('_config', config)
    } catch (error) {
      // Config is optional for some commands (like init)
      if (!['init', 'help'].includes(actionCommand.name())) {
        logger.debug('Configuration not found, using defaults')
      }
    }
  })

  // Register commands (these will be implemented in Phase 2+)
  // program.addCommand(initCommand())
  // program.addCommand(migrateCommand())
  // program.addCommand(healthCommand())
  // program.addCommand(auditCommand())
  // program.addCommand(generateCommand())
  // program.addCommand(dbCommand())
  // program.addCommand(testCommand())
  // program.addCommand(pluginCommand())
  // program.addCommand(debugCommand())
  // program.addCommand(queryCommand())
  // program.addCommand(repositoryCommand())

  // Temporary test command to verify CLI works
  program
    .command('hello')
    .description('Test command to verify CLI setup')
    .option('-n, --name <name>', 'Name to greet', 'World')
    .action((options) => {
      logger.info(chalk.green(`Hello, ${options.name}! 👋`))
      logger.debug('CLI is working correctly!')
    })

  // Error handling
  program.exitOverride()
  program.showSuggestionAfterError(true)

  try {
    await program.parseAsync(argv)
  } catch (error: any) {
    handleError(error)
    process.exit(1)
  }
}