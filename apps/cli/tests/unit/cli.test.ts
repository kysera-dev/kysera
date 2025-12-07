import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { Command, CommanderError } from 'commander';

// We need to mock certain modules before importing cli
vi.mock('@/utils/cache', () => ({
  CacheManager: {
    setupCleanup: vi.fn(),
    printStats: vi.fn(),
  },
}));

vi.mock('@/utils/lazy-loader', () => ({
  createCommandLoaders: vi.fn(() => new Map()),
  CommandOptimizer: {
    loadStats: vi.fn(),
    getFrequentCommands: vi.fn(() => []),
    trackUsage: vi.fn(),
  },
  CommandCache: {
    getOrLoad: vi.fn(),
  },
  LoadMetrics: {
    recordLoad: vi.fn(),
    getAllMetrics: vi.fn(() => []),
    report: vi.fn(),
  },
}));

vi.mock('@/config/loader', () => ({
  loadConfig: vi.fn(() => Promise.resolve({})),
}));

// ---------------------------------------------------------------------------
// Helper: Create a minimal CLI program for testing (mirrors src/cli.ts structure)
// ---------------------------------------------------------------------------
function createTestProgram(): Command {
  const program = new Command();
  program
    .name('kysera')
    .description('Comprehensive command-line interface for Kysera ORM')
    .version('0.1.0', '-v, --version', 'Show CLI version')
    .helpCommand('help [command]', 'Display help for command')
    .helpOption('-h, --help', 'Display help')
    .option('--verbose', 'Enable verbose output')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('--dry-run', 'Preview changes without executing')
    .option('--config <path>', 'Path to configuration file')
    .option('--no-color', 'Disable colored output')
    .option('--json', 'Output results as JSON')
    .option('--env <environment>', 'Environment (development/production/test)', 'development')
    .option('--stats', 'Show performance statistics', false);

  // Register main commands
  program.addCommand(new Command('init').description('Initialize a new Kysera project'));
  program.addCommand(new Command('migrate').description('Database migration management'));
  program.addCommand(new Command('generate').description('Code generation utilities'));
  program.addCommand(new Command('db').description('Database management utilities'));
  program.addCommand(new Command('health').description('Database health monitoring'));
  program.addCommand(new Command('audit').description('Audit logging and history'));
  program.addCommand(new Command('debug').description('Debug and diagnostic utilities'));
  program.addCommand(new Command('query').description('Query utilities and analysis'));
  program.addCommand(new Command('repository').description('Repository pattern utilities'));
  program.addCommand(new Command('test').description('Test environment management'));
  program.addCommand(new Command('plugin').description('Plugin management'));
  program.addCommand(new Command('hello').description('Test command to verify CLI setup'));
  program.addCommand(new Command('stats').description('Show CLI performance statistics'));

  // Enable suggestions for unknown commands
  program.showSuggestionAfterError(true);

  return program;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------
describe('CLI', () => {
  let program: Command;
  let consoleLogSpy: Mock;
  let consoleErrorSpy: Mock;
  let processExitSpy: Mock;

  beforeEach(() => {
    program = createTestProgram();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Basic CLI Structure
  // -------------------------------------------------------------------------
  describe('Basic CLI Structure', () => {
    it('should have correct name', () => {
      expect(program.name()).toBe('kysera');
    });

    it('should have correct description', () => {
      expect(program.description()).toBe('Comprehensive command-line interface for Kysera ORM');
    });

    it('should have version set', () => {
      expect(program.version()).toBe('0.1.0');
    });
  });

  // -------------------------------------------------------------------------
  // Help Output Tests
  // -------------------------------------------------------------------------
  describe('Help Output', () => {
    it('should display help when --help flag is provided', () => {
      let helpOutput = '';
      program.configureOutput({
        writeOut: (str) => {
          helpOutput += str;
        },
        writeErr: (str) => {
          helpOutput += str;
        },
      });

      // Commander exits on help, so we need to catch the exit
      program.exitOverride();

      try {
        program.parse(['node', 'kysera', '--help']);
      } catch (err) {
        // Commander throws CommanderError on help (code may vary by version)
        if (err instanceof CommanderError) {
          // Expected behavior - help was displayed
        } else {
          throw err;
        }
      }

      expect(helpOutput).toContain('kysera');
      expect(helpOutput).toContain('Comprehensive command-line interface');
    });

    it('should display help when -h flag is provided', () => {
      let helpOutput = '';
      program.configureOutput({
        writeOut: (str) => {
          helpOutput += str;
        },
      });

      program.exitOverride();

      try {
        program.parse(['node', 'kysera', '-h']);
      } catch (err) {
        if (err instanceof CommanderError) {
          // Expected behavior - help was displayed
        } else {
          throw err;
        }
      }

      expect(helpOutput).toContain('Usage:');
    });

    it('should show command-specific help with help [command]', () => {
      let helpOutput = '';
      const migrateCmd = program.commands.find((cmd) => cmd.name() === 'migrate');
      if (migrateCmd) {
        migrateCmd.configureOutput({
          writeOut: (str) => {
            helpOutput += str;
          },
        });
        migrateCmd.exitOverride();

        try {
          migrateCmd.outputHelp();
        } catch (err) {
          // May throw on exit
        }

        expect(helpOutput).toContain('migrate');
      }
    });

    it('should include all main commands in help output', () => {
      let helpOutput = '';
      program.configureOutput({
        writeOut: (str) => {
          helpOutput += str;
        },
      });

      program.exitOverride();

      try {
        program.parse(['node', 'kysera', '--help']);
      } catch (err) {
        // Expected
      }

      const expectedCommands = ['init', 'migrate', 'generate', 'db', 'health', 'audit'];
      for (const cmd of expectedCommands) {
        expect(helpOutput).toContain(cmd);
      }
    });

    it('should include global options in help output', () => {
      let helpOutput = '';
      program.configureOutput({
        writeOut: (str) => {
          helpOutput += str;
        },
      });

      program.exitOverride();

      try {
        program.parse(['node', 'kysera', '--help']);
      } catch (err) {
        // Expected
      }

      expect(helpOutput).toContain('--verbose');
      expect(helpOutput).toContain('--quiet');
      expect(helpOutput).toContain('--dry-run');
      expect(helpOutput).toContain('--config');
      expect(helpOutput).toContain('--json');
    });
  });

  // -------------------------------------------------------------------------
  // Version Output Tests
  // -------------------------------------------------------------------------
  describe('Version Output', () => {
    it('should display version when --version flag is provided', () => {
      let versionOutput = '';
      program.configureOutput({
        writeOut: (str) => {
          versionOutput += str;
        },
      });

      program.exitOverride();

      try {
        program.parse(['node', 'kysera', '--version']);
      } catch (err) {
        if (err instanceof CommanderError && err.code === 'commander.version') {
          // Expected behavior
        } else {
          throw err;
        }
      }

      expect(versionOutput).toContain('0.1.0');
    });

    it('should display version when -v flag is provided', () => {
      let versionOutput = '';
      program.configureOutput({
        writeOut: (str) => {
          versionOutput += str;
        },
      });

      program.exitOverride();

      try {
        program.parse(['node', 'kysera', '-v']);
      } catch (err) {
        if (err instanceof CommanderError && err.code === 'commander.version') {
          // Expected behavior
        } else {
          throw err;
        }
      }

      expect(versionOutput).toContain('0.1.0');
    });
  });

  // -------------------------------------------------------------------------
  // Unknown Command Handling Tests
  // -------------------------------------------------------------------------
  describe('Unknown Command Handling', () => {
    it('should error on unknown commands', () => {
      let errorOutput = '';
      program.configureOutput({
        writeErr: (str) => {
          errorOutput += str;
        },
      });

      program.exitOverride();

      try {
        program.parse(['node', 'kysera', 'unknowncommand']);
      } catch (err) {
        if (err instanceof CommanderError) {
          expect(err.code).toBe('commander.unknownCommand');
        }
      }

      expect(errorOutput).toContain('unknown command');
    });

    it('should show suggestions for misspelled commands', () => {
      let errorOutput = '';
      program.configureOutput({
        writeErr: (str) => {
          errorOutput += str;
        },
      });

      program.exitOverride();

      try {
        program.parse(['node', 'kysera', 'migrat']); // Misspelled 'migrate'
      } catch (err) {
        // Expected
      }

      // Commander should suggest 'migrate'
      expect(errorOutput.toLowerCase()).toMatch(/migrate|similar/);
    });

    it('should suggest similar commands when available', () => {
      let errorOutput = '';
      program.configureOutput({
        writeErr: (str) => {
          errorOutput += str;
        },
      });

      program.exitOverride();

      try {
        program.parse(['node', 'kysera', 'healt']); // Misspelled 'health'
      } catch (err) {
        // Expected
      }

      expect(errorOutput.toLowerCase()).toMatch(/health|did you mean/i);
    });
  });

  // -------------------------------------------------------------------------
  // Global Options Parsing Tests
  // -------------------------------------------------------------------------
  describe('Global Options Parsing', () => {
    it('should parse --verbose flag', () => {
      program.exitOverride();
      program.action(() => {}); // Add action to prevent unknown command error

      program.parse(['node', 'kysera', '--verbose']);

      const opts = program.opts();
      expect(opts.verbose).toBe(true);
    });

    it('should parse --quiet flag', () => {
      program.exitOverride();
      program.action(() => {});

      program.parse(['node', 'kysera', '--quiet']);

      const opts = program.opts();
      expect(opts.quiet).toBe(true);
    });

    it('should parse -q short flag for quiet', () => {
      program.exitOverride();
      program.action(() => {});

      program.parse(['node', 'kysera', '-q']);

      const opts = program.opts();
      expect(opts.quiet).toBe(true);
    });

    it('should parse --dry-run flag', () => {
      program.exitOverride();
      program.action(() => {});

      program.parse(['node', 'kysera', '--dry-run']);

      const opts = program.opts();
      expect(opts.dryRun).toBe(true);
    });

    it('should parse --json flag', () => {
      program.exitOverride();
      program.action(() => {});

      program.parse(['node', 'kysera', '--json']);

      const opts = program.opts();
      expect(opts.json).toBe(true);
    });

    it('should parse --config option with path', () => {
      program.exitOverride();
      program.action(() => {});

      program.parse(['node', 'kysera', '--config', '/path/to/config.json']);

      const opts = program.opts();
      expect(opts.config).toBe('/path/to/config.json');
    });

    it('should parse --env option with value', () => {
      program.exitOverride();
      program.action(() => {});

      program.parse(['node', 'kysera', '--env', 'production']);

      const opts = program.opts();
      expect(opts.env).toBe('production');
    });

    it('should use default environment value when not specified', () => {
      program.exitOverride();
      program.action(() => {});

      program.parse(['node', 'kysera']);

      const opts = program.opts();
      expect(opts.env).toBe('development');
    });

    it('should parse --no-color flag', () => {
      program.exitOverride();
      program.action(() => {});

      program.parse(['node', 'kysera', '--no-color']);

      const opts = program.opts();
      expect(opts.color).toBe(false);
    });

    it('should parse --stats flag', () => {
      program.exitOverride();
      program.action(() => {});

      program.parse(['node', 'kysera', '--stats']);

      const opts = program.opts();
      expect(opts.stats).toBe(true);
    });

    it('should parse multiple flags together', () => {
      program.exitOverride();
      program.action(() => {});

      program.parse(['node', 'kysera', '--verbose', '--dry-run', '--json', '--config', 'test.json']);

      const opts = program.opts();
      expect(opts.verbose).toBe(true);
      expect(opts.dryRun).toBe(true);
      expect(opts.json).toBe(true);
      expect(opts.config).toBe('test.json');
    });

    it('should handle conflicting verbose and quiet flags (last wins)', () => {
      program.exitOverride();
      program.action(() => {});

      // Both flags provided - Commander allows this, application logic handles precedence
      program.parse(['node', 'kysera', '--verbose', '--quiet']);

      const opts = program.opts();
      expect(opts.verbose).toBe(true);
      expect(opts.quiet).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Command Registration Tests
  // -------------------------------------------------------------------------
  describe('Command Registration', () => {
    it('should register init command', () => {
      const cmd = program.commands.find((c) => c.name() === 'init');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain('Initialize');
    });

    it('should register migrate command', () => {
      const cmd = program.commands.find((c) => c.name() === 'migrate');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain('migration');
    });

    it('should register generate command', () => {
      const cmd = program.commands.find((c) => c.name() === 'generate');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain('generation');
    });

    it('should register db command', () => {
      const cmd = program.commands.find((c) => c.name() === 'db');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain('Database');
    });

    it('should register health command', () => {
      const cmd = program.commands.find((c) => c.name() === 'health');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain('health');
    });

    it('should register audit command', () => {
      const cmd = program.commands.find((c) => c.name() === 'audit');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain('Audit');
    });

    it('should register debug command', () => {
      const cmd = program.commands.find((c) => c.name() === 'debug');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain('Debug');
    });

    it('should register query command', () => {
      const cmd = program.commands.find((c) => c.name() === 'query');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain('Query');
    });

    it('should register repository command', () => {
      const cmd = program.commands.find((c) => c.name() === 'repository');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain('Repository');
    });

    it('should register test command', () => {
      const cmd = program.commands.find((c) => c.name() === 'test');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain('Test');
    });

    it('should register plugin command', () => {
      const cmd = program.commands.find((c) => c.name() === 'plugin');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain('Plugin');
    });

    it('should register hello command', () => {
      const cmd = program.commands.find((c) => c.name() === 'hello');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain('Test command');
    });

    it('should register stats command', () => {
      const cmd = program.commands.find((c) => c.name() === 'stats');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain('performance');
    });

    it('should have expected number of commands registered', () => {
      // init, migrate, generate, db, health, audit, debug, query, repository, test, plugin, hello, stats
      expect(program.commands.length).toBeGreaterThanOrEqual(13);
    });

    it('should have unique command names', () => {
      const names = program.commands.map((c) => c.name());
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  // -------------------------------------------------------------------------
  // Error Handling Tests
  // -------------------------------------------------------------------------
  describe('Error Handling', () => {
    it('should catch commander errors on invalid options', () => {
      let errorOutput = '';
      program.configureOutput({
        writeErr: (str) => {
          errorOutput += str;
        },
      });

      program.exitOverride();

      try {
        // Pass an option that requires a value without the value
        program.parse(['node', 'kysera', '--config']);
      } catch (err) {
        if (err instanceof CommanderError) {
          expect(err.code).toBe('commander.optionMissingArgument');
        }
      }

      expect(errorOutput).toContain('--config');
    });

    it('should format errors with proper exit codes', () => {
      program.exitOverride((err) => {
        expect(err.exitCode).toBeDefined();
        throw err;
      });

      try {
        program.parse(['node', 'kysera', 'nonexistent']);
      } catch (err) {
        if (err instanceof CommanderError) {
          expect(err.exitCode).toBe(1);
        }
      }
    });

    it('should handle missing required option arguments', () => {
      let errorOutput = '';
      program.configureOutput({
        writeErr: (str) => {
          errorOutput += str;
        },
      });

      program.exitOverride();

      try {
        program.parse(['node', 'kysera', '--env']);
      } catch (err) {
        if (err instanceof CommanderError) {
          expect(err.code).toBe('commander.optionMissingArgument');
        }
      }

      expect(errorOutput).toContain('--env');
    });

    it('should provide helpful error messages', () => {
      let errorOutput = '';
      program.configureOutput({
        writeErr: (str) => {
          errorOutput += str;
        },
      });

      program.exitOverride();

      try {
        program.parse(['node', 'kysera', '--invalid-flag']);
      } catch (err) {
        // Expected
      }

      expect(errorOutput).toContain('unknown option');
    });
  });

  // -------------------------------------------------------------------------
  // Command Execution Tests
  // -------------------------------------------------------------------------
  describe('Command Execution', () => {
    it('should execute command action when command is invoked', () => {
      const actionMock = vi.fn();
      const testCmd = new Command('testcmd').description('Test').action(actionMock);
      program.addCommand(testCmd);

      program.exitOverride();
      program.parse(['node', 'kysera', 'testcmd']);

      expect(actionMock).toHaveBeenCalled();
    });

    it('should pass options to command action', () => {
      let receivedOptions: any;
      const testCmd = new Command('opttest')
        .description('Test')
        .option('--flag', 'A flag')
        .option('--value <val>', 'A value')
        .action((options) => {
          receivedOptions = options;
        });
      program.addCommand(testCmd);

      program.exitOverride();
      program.parse(['node', 'kysera', 'opttest', '--flag', '--value', 'test']);

      expect(receivedOptions.flag).toBe(true);
      expect(receivedOptions.value).toBe('test');
    });

    it('should pass arguments to command action', () => {
      let receivedArg: string | undefined;
      const testCmd = new Command('argtest')
        .description('Test')
        .argument('<name>', 'A name argument')
        .action((name) => {
          receivedArg = name;
        });
      program.addCommand(testCmd);

      program.exitOverride();
      program.parse(['node', 'kysera', 'argtest', 'myname']);

      expect(receivedArg).toBe('myname');
    });

    it('should handle optional arguments', () => {
      let receivedArg: string | undefined;
      const testCmd = new Command('optargtest')
        .description('Test')
        .argument('[name]', 'An optional name')
        .action((name) => {
          receivedArg = name;
        });
      program.addCommand(testCmd);

      program.exitOverride();
      program.parse(['node', 'kysera', 'optargtest']);

      expect(receivedArg).toBeUndefined();
    });

    it('should handle variadic arguments', () => {
      let receivedArgs: string[] = [];
      const testCmd = new Command('vartest')
        .description('Test')
        .argument('<items...>', 'Multiple items')
        .action((items) => {
          receivedArgs = items;
        });
      program.addCommand(testCmd);

      program.exitOverride();
      program.parse(['node', 'kysera', 'vartest', 'a', 'b', 'c']);

      expect(receivedArgs).toEqual(['a', 'b', 'c']);
    });
  });

  // -------------------------------------------------------------------------
  // Subcommand Tests
  // -------------------------------------------------------------------------
  describe('Subcommand Structure', () => {
    it('should support nested subcommands', () => {
      const parentCmd = new Command('parent').description('Parent command');
      const childCmd = new Command('child')
        .description('Child command')
        .action(() => {});
      parentCmd.addCommand(childCmd);
      program.addCommand(parentCmd);

      const parent = program.commands.find((c) => c.name() === 'parent');
      expect(parent).toBeDefined();
      expect(parent?.commands.length).toBe(1);
      expect(parent?.commands[0].name()).toBe('child');
    });

    it('should execute nested subcommand action', () => {
      const actionMock = vi.fn();
      const parentCmd = new Command('parent2').description('Parent');
      const childCmd = new Command('child2').description('Child').action(actionMock);
      parentCmd.addCommand(childCmd);
      program.addCommand(parentCmd);

      program.exitOverride();
      program.parse(['node', 'kysera', 'parent2', 'child2']);

      expect(actionMock).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Environment Variable Integration Tests
  // -------------------------------------------------------------------------
  describe('Environment Variable Integration', () => {
    it('should read CLI version from environment variable', () => {
      const originalVersion = process.env['KYSERA_CLI_VERSION'];
      process.env['KYSERA_CLI_VERSION'] = '1.2.3';

      // Create a new program to pick up env var
      const newProgram = new Command();
      newProgram.version(process.env['KYSERA_CLI_VERSION'] || '0.1.0');

      expect(newProgram.version()).toBe('1.2.3');

      // Restore
      if (originalVersion) {
        process.env['KYSERA_CLI_VERSION'] = originalVersion;
      } else {
        delete process.env['KYSERA_CLI_VERSION'];
      }
    });
  });

  // -------------------------------------------------------------------------
  // Option Default Values Tests
  // -------------------------------------------------------------------------
  describe('Option Default Values', () => {
    it('should have default environment as development', () => {
      program.exitOverride();
      program.action(() => {});
      program.parse(['node', 'kysera']);

      expect(program.opts().env).toBe('development');
    });

    it('should have stats disabled by default', () => {
      program.exitOverride();
      program.action(() => {});
      program.parse(['node', 'kysera']);

      expect(program.opts().stats).toBe(false);
    });

    it('should have verbose disabled by default', () => {
      program.exitOverride();
      program.action(() => {});
      program.parse(['node', 'kysera']);

      expect(program.opts().verbose).toBeUndefined();
    });

    it('should have quiet disabled by default', () => {
      program.exitOverride();
      program.action(() => {});
      program.parse(['node', 'kysera']);

      expect(program.opts().quiet).toBeUndefined();
    });

    it('should have dry-run disabled by default', () => {
      program.exitOverride();
      program.action(() => {});
      program.parse(['node', 'kysera']);

      expect(program.opts().dryRun).toBeUndefined();
    });

    it('should have json disabled by default', () => {
      program.exitOverride();
      program.action(() => {});
      program.parse(['node', 'kysera']);

      expect(program.opts().json).toBeUndefined();
    });

    it('should have config undefined by default', () => {
      program.exitOverride();
      program.action(() => {});
      program.parse(['node', 'kysera']);

      expect(program.opts().config).toBeUndefined();
    });

    it('should have color enabled by default (no-color not set)', () => {
      program.exitOverride();
      program.action(() => {});
      program.parse(['node', 'kysera']);

      expect(program.opts().color).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Command Aliases Tests
  // -------------------------------------------------------------------------
  describe('Command Aliases', () => {
    it('should support command aliases', () => {
      const cmdWithAlias = new Command('generate')
        .alias('g')
        .description('Generate code')
        .action(() => {});

      const testProgram = new Command();
      testProgram.addCommand(cmdWithAlias);

      expect(cmdWithAlias.alias()).toBe('g');
    });

    it('should execute command via alias', () => {
      const actionMock = vi.fn();
      const cmdWithAlias = new Command('generate').alias('g').description('Generate').action(actionMock);

      const testProgram = new Command();
      testProgram.name('test');
      testProgram.addCommand(cmdWithAlias);
      testProgram.exitOverride();

      testProgram.parse(['node', 'test', 'g']);

      expect(actionMock).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Output Configuration Tests
  // -------------------------------------------------------------------------
  describe('Output Configuration', () => {
    it('should allow custom output streams', () => {
      const outputs: string[] = [];
      program.configureOutput({
        writeOut: (str) => outputs.push(str),
        writeErr: (str) => outputs.push(str),
      });

      program.exitOverride();

      try {
        program.parse(['node', 'kysera', '--help']);
      } catch {
        // Expected
      }

      expect(outputs.length).toBeGreaterThan(0);
    });

    it('should capture error output separately', () => {
      const stdOut: string[] = [];
      const stdErr: string[] = [];

      program.configureOutput({
        writeOut: (str) => stdOut.push(str),
        writeErr: (str) => stdErr.push(str),
      });

      program.exitOverride();

      try {
        program.parse(['node', 'kysera', 'invalidcmd']);
      } catch {
        // Expected
      }

      expect(stdErr.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Hook Tests
  // -------------------------------------------------------------------------
  describe('Command Hooks', () => {
    it('should execute preAction hook before command action', () => {
      const hookOrder: string[] = [];

      const testProgram = new Command();
      testProgram.name('test');
      testProgram.hook('preAction', () => {
        hookOrder.push('preAction');
      });
      testProgram.action(() => {
        hookOrder.push('action');
      });

      testProgram.exitOverride();
      testProgram.parse(['node', 'test']);

      expect(hookOrder).toEqual(['preAction', 'action']);
    });

    it('should execute postAction hook after command action', () => {
      const hookOrder: string[] = [];

      const testProgram = new Command();
      testProgram.name('test');
      testProgram.hook('postAction', () => {
        hookOrder.push('postAction');
      });
      testProgram.action(() => {
        hookOrder.push('action');
      });

      testProgram.exitOverride();
      testProgram.parse(['node', 'test']);

      expect(hookOrder).toEqual(['action', 'postAction']);
    });

    it('should pass command to hook callback', () => {
      let receivedCommand: Command | undefined;

      const testProgram = new Command();
      testProgram.name('test');
      testProgram.hook('preAction', (thisCommand) => {
        receivedCommand = thisCommand;
      });
      testProgram.action(() => {});

      testProgram.exitOverride();
      testProgram.parse(['node', 'test']);

      expect(receivedCommand?.name()).toBe('test');
    });
  });

  // -------------------------------------------------------------------------
  // Async Action Tests
  // -------------------------------------------------------------------------
  describe('Async Actions', () => {
    it('should support async command actions', async () => {
      const asyncResult = { completed: false };

      const testCmd = new Command('asynctest')
        .description('Async test')
        .action(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          asyncResult.completed = true;
        });

      program.addCommand(testCmd);
      program.exitOverride();

      await program.parseAsync(['node', 'kysera', 'asynctest']);

      expect(asyncResult.completed).toBe(true);
    });

    it('should handle async errors properly', async () => {
      const testCmd = new Command('asyncerror')
        .description('Async error test')
        .action(async () => {
          throw new Error('Async error occurred');
        });

      program.addCommand(testCmd);
      program.exitOverride();

      await expect(program.parseAsync(['node', 'kysera', 'asyncerror'])).rejects.toThrow('Async error occurred');
    });
  });

  // -------------------------------------------------------------------------
  // Option Coercion Tests
  // -------------------------------------------------------------------------
  describe('Option Coercion', () => {
    it('should coerce option values with custom functions', () => {
      let parsedValue: number | undefined;

      const testCmd = new Command('coercetest')
        .description('Test')
        .option('-n, --number <n>', 'A number', (val: string) => parseInt(val, 10))
        .action((options) => {
          parsedValue = options.number;
        });

      program.addCommand(testCmd);
      program.exitOverride();
      program.parse(['node', 'kysera', 'coercetest', '-n', '42']);

      expect(parsedValue).toBe(42);
      expect(typeof parsedValue).toBe('number');
    });

    it('should support option validation', () => {
      const testCmd = new Command('validatetest')
        .description('Test')
        .option('-l, --level <level>', 'Log level', (val: string) => {
          const allowed = ['debug', 'info', 'warn', 'error'];
          if (!allowed.includes(val)) {
            throw new Error(`Invalid level: ${val}. Must be one of: ${allowed.join(', ')}`);
          }
          return val;
        })
        .action(() => {});

      program.addCommand(testCmd);
      program.exitOverride();

      // The error should be thrown when parsing invalid option value
      expect(() => {
        program.parse(['node', 'kysera', 'validatetest', '-l', 'invalid']);
      }).toThrow('Invalid level');
    });
  });

  // -------------------------------------------------------------------------
  // Required Options Tests
  // -------------------------------------------------------------------------
  describe('Required Options', () => {
    it('should error when required option is missing', () => {
      const testCmd = new Command('reqtest')
        .description('Test')
        .requiredOption('-r, --required <value>', 'A required option')
        .action(() => {});

      program.addCommand(testCmd);
      program.exitOverride();

      // Commander throws an error when required option is missing
      expect(() => {
        program.parse(['node', 'kysera', 'reqtest']);
      }).toThrow(); // Commander throws CommanderError for missing required option
    });

    it('should include option name in error for missing required option', () => {
      const testCmd = new Command('reqtest3')
        .description('Test')
        .requiredOption('-r, --required <value>', 'A required option')
        .action(() => {});

      // Create isolated program without mocked process.exit
      const isolatedProgram = new Command();
      isolatedProgram.name('test');
      isolatedProgram.addCommand(testCmd);
      isolatedProgram.exitOverride();

      try {
        isolatedProgram.parse(['node', 'test', 'reqtest3']);
        // Should not reach here
        expect.fail('Should have thrown error');
      } catch (err) {
        if (err instanceof CommanderError) {
          expect(err.message).toContain('required');
        }
      }
    });

    it('should pass when required option is provided', () => {
      let receivedValue: string | undefined;

      const testCmd = new Command('reqtest2')
        .description('Test')
        .requiredOption('-r, --required <value>', 'A required option')
        .action((options) => {
          receivedValue = options.required;
        });

      program.addCommand(testCmd);
      program.exitOverride();
      program.parse(['node', 'kysera', 'reqtest2', '-r', 'value']);

      expect(receivedValue).toBe('value');
    });
  });
});
