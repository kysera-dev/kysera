import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { addGlobalOptions } from './utils/global-options.js'
import { initCommand } from './commands/init/index.js'
import { migrateCommand } from './commands/migrate/index.js'
import { generateCommand } from './commands/generate/index.js'
import { dbCommand } from './commands/db/index.js'
import { healthCommand } from './commands/health/index.js'
import { doctorCommand } from './commands/doctor/index.js'
import { rlsCommand } from './commands/rls/index.js'
import { auditCommand } from './commands/audit/index.js'
import { debugCommand } from './commands/debug/index.js'
import { queryCommand } from './commands/query/index.js'
import { repositoryCommand } from './commands/repository/index.js'
import { testCommand } from './commands/test/index.js'
import { pluginCommand } from './commands/plugin/index.js'
import { schemaCommand } from './commands/schema/index.js'

/**
 * Read the CLI version from package.json (dist/index.js sits one level
 * below the package root, src/cli.ts likewise).
 */
function cliVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: string
    }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * Build the full command tree. All command groups are registered eagerly
 * so --help is complete everywhere; heavy dependencies (database drivers,
 * template engines, generators) are only imported when an action runs.
 */
export function buildProgram(): Command {
  const program = new Command()

  program
    .name('kysera')
    .description('Comprehensive command-line interface for Kysera toolkit')
    // Long form only: a root -v short would swallow subcommand -v flags
    // (e.g. `kysera migrate status -v` printed the version instead of
    // running the command with --verbose).
    .version(cliVersion(), '--version', 'Show CLI version')
    .helpCommand('help [command]', 'Display help for command')
    .helpOption('-h, --help', 'Display help')
    .addHelpText(
      'after',
      `
${prism.gray('Examples:')}
  ${prism.cyan('kysera init my-app')}              Initialize new project
  ${prism.cyan('kysera migrate up')}               Run pending migrations
  ${prism.cyan('kysera generate crud User')}       Generate CRUD for User
  ${prism.cyan('kysera health check')}             Check database health
  ${prism.cyan('kysera schema list')}              List PostgreSQL schemas

${prism.gray('Documentation:')} ${prism.underline(prism.blue('https://kysera.dev/docs/cli'))}
${prism.gray('GitHub:')} ${prism.underline(prism.blue('https://github.com/kysera/kysera'))}
`
    )

  addGlobalOptions(program).option(
    '--env <environment>',
    'Environment (development/production/test)',
    'development'
  )

  program.hook('preAction', thisCommand => {
    const envOption = thisCommand.opts<{ env?: string }>().env
    if (thisCommand.getOptionValueSource('env') === 'cli' && envOption) {
      process.env.NODE_ENV = envOption
    } else if (!process.env.NODE_ENV && envOption) {
      process.env.NODE_ENV = envOption
    }
  })

  program.addCommand(initCommand())
  program.addCommand(migrateCommand())
  program.addCommand(generateCommand())
  program.addCommand(dbCommand())
  program.addCommand(healthCommand())
  program.addCommand(doctorCommand())
  program.addCommand(auditCommand())
  program.addCommand(debugCommand())
  program.addCommand(queryCommand())
  program.addCommand(repositoryCommand())
  program.addCommand(testCommand())
  program.addCommand(pluginCommand())
  program.addCommand(schemaCommand())
  program.addCommand(rlsCommand())

  program.showSuggestionAfterError(true)

  return program
}

/**
 * Run the CLI.
 */
export async function cli(argv: string[]): Promise<void> {
  // Load .env from the working directory first so configuration can rely
  // on it (real environment variables are never overridden). Non-fatal
  // when absent.
  const { config: loadDotenv } = await import('dotenv')
  loadDotenv({ quiet: true })

  const program = buildProgram()
  await program.parseAsync(argv)
}
