import { Command } from 'commander';
import { prism } from '@xec-sh/kit';
import { loadConfig } from './config/loader.js';
import { logger } from './utils/logger.js';
import { ErrorHandler } from './utils/error-handler.js';
import { addGlobalOptions, globalOptions } from './utils/global-options.js';
import { createCommandLoaders, CommandOptimizer, CommandCache, LoadMetrics } from './utils/lazy-loader.js';
import { CacheManager } from './utils/cache.js';

/**
 * Optimized CLI with lazy loading and caching
 */
export async function cli(argv: string[]): Promise<void> {
  const startTime = Date.now();

  // Setup cache cleanup handlers
  CacheManager.setupCleanup();

  // Load usage statistics for optimization
  await CommandOptimizer.loadStats();

  const program = new Command();

  // Configure CLI
  program
    .name('kysera')
    .description('Comprehensive command-line interface for Kysera ORM')
    .version(process.env['KYSERA_CLI_VERSION'] || '0.5.1', '-v, --version', 'Show CLI version')
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

${prism.gray('Documentation:')} ${prism.underline(prism.blue('https://kysera.dev/docs/cli'))}
${prism.gray('GitHub:')} ${prism.underline(prism.blue('https://github.com/kysera/kysera'))}
`
    );

  // Global options
  addGlobalOptions(program)
    .option('--env <environment>', 'Environment (development/production/test)', 'development')
    .option('--stats', 'Show performance statistics', false);

  // Global hooks
  program.hook('preAction', async (_thisCommand, actionCommand) => {
    // Track command usage
    CommandOptimizer.trackUsage(actionCommand.name());

    // Get global options from the parent command
    const opts = program.opts();

    // Set up environment
    process.env['NODE_ENV'] = opts['env'] || process.env['NODE_ENV'] || 'development';

    // Load configuration (if not init or help command)
    if (!['init', 'help', 'stats'].includes(actionCommand.name())) {
      try {
        const configPath = globalOptions.getOptions().config || opts['config'];
        const config = await loadConfig(configPath);
        actionCommand.setOptionValue('_config', config);
      } catch (error) {
        // Config is optional for some commands
        if (globalOptions.isVerbose()) {
          logger.debug('Configuration not found, using defaults');
        }
      }
    }
  });

  // Lazy load commands
  const commandLoaders = createCommandLoaders();

  // Get frequently used commands to preload
  const frequentCommands = CommandOptimizer.getFrequentCommands();
  const commandsToPreload = frequentCommands.filter((name) => commandLoaders.has(name)).slice(0, 3); // Preload top 3

  // Preload frequent commands in parallel
  if (commandsToPreload.length > 0 && !globalOptions.isQuiet()) {
    const preloadPromises = commandsToPreload.map(async (name) => {
      const loader = commandLoaders.get(name)!;
      try {
        const command = await CommandCache.getOrLoad(name, loader.loader);
        program.addCommand(command);
        commandLoaders.delete(name); // Remove from lazy loaders
      } catch (error) {
        // Preload failed, will lazy load on demand
      }
    });

    await Promise.all(preloadPromises);
  }

  // Add remaining commands as lazy-loaded
  for (const [name, loader] of commandLoaders) {
    const placeholderCommand = new Command(name)
      .description(loader.description)
      .allowUnknownOption(true)
      .allowExcessArguments(true)
      .action(async function (this: Command, ...args: any[]) {
        const loadStart = Date.now();

        // Load the actual command
        const actualCommand = await CommandCache.getOrLoad(name, loader.loader);
        LoadMetrics.recordLoad(name, Date.now() - loadStart);

        // Replace placeholder with actual command
        const parent = this.parent;
        if (parent) {
          const index = parent.commands.findIndex((cmd) => cmd.name() === name);
          if (index >= 0) {
            // Create a new array with the replacement
            const newCommands = [...parent.commands];
            newCommands[index] = actualCommand;
            // @ts-ignore - We need to replace the commands array
            parent.commands = newCommands;
          }
        }

        // Find where this command starts in argv
        const cmdIndex = process.argv.indexOf(name);
        if (cmdIndex >= 0) {
          // Get the arguments after the command name
          const subArgs = process.argv.slice(cmdIndex + 1);
          // Parse with the actual command, passing only the subcommand arguments
          await actualCommand.parseAsync(subArgs, { from: 'user' });
        } else {
          // Fallback: parse with all remaining args
          await actualCommand.parseAsync(args, { from: 'user' });
        }
      });

    program.addCommand(placeholderCommand);
  }

  // Test command (always available for quick checks)
  program
    .command('hello')
    .description('Test command to verify CLI setup')
    .option('-n, --name <name>', 'Name to greet', 'World')
    .action((options) => {
      logger.info(prism.green(`Hello, ${options.name}! 👋`));
      logger.debug('CLI is working correctly!');
    });

  // Performance stats command
  program
    .command('stats')
    .description('Show CLI performance statistics')
    .action(() => {
      console.log(prism.bold('CLI Performance Statistics'));
      console.log(prism.gray('─'.repeat(60)));

      // Load metrics
      const loadMetrics = LoadMetrics.getAllMetrics();
      if (loadMetrics.length > 0) {
        console.log(prism.cyan('Command Load Times:'));
        loadMetrics.forEach((m) => {
          console.log(`  ${m.name}: ${m.loadTime}ms (used ${m.executionCount} times)`);
        });
        console.log();
      }

      // Cache statistics
      CacheManager.printStats();

      // Usage statistics
      const frequent = CommandOptimizer.getFrequentCommands();
      if (frequent.length > 0) {
        console.log(prism.cyan('Most Used Commands:'));
        frequent.forEach((cmd, i) => {
          console.log(`  ${i + 1}. ${cmd}`);
        });
      }

      console.log(prism.gray('─'.repeat(60)));
      const totalTime = Date.now() - startTime;
      console.log(`Startup time: ${totalTime}ms`);
    });

  // Install global error handlers
  ErrorHandler.install(program);
  program.showSuggestionAfterError(true);

  // Parse and execute command
  await program.parseAsync(argv);

  // Show stats if requested
  if (program.opts()['stats']) {
    console.log();
    console.log(prism.gray('─'.repeat(60)));
    console.log(`Command completed in ${Date.now() - startTime}ms`);
    LoadMetrics.report();
  }
}
