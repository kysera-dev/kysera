import { Command } from 'commander';

// Import test commands
import { testSetupCommand } from './setup.js';
import { testTeardownCommand } from './teardown.js';
import { testSeedCommand } from './seed.js';
import { fixturesCommand } from './fixtures.js';

export function testCommand(): Command {
  const cmd = new Command('test').description('Test environment management and utilities').addHelpText(
    'after',
    `

Examples:
  kysera test setup --environment test --migrate      Set up test database
  kysera test seed --strategy realistic --count 100   Seed with realistic data
  kysera test fixtures --load users                   Load user fixtures
  kysera test teardown --force                        Clean up test environment

Subcommands:
  setup       Set up test database and environment
  teardown    Clean up test databases and artifacts
  seed        Seed test database with sample data
  fixtures    Load and manage test fixtures

Workflow:
  1. kysera test setup --clean --migrate    # Set up fresh test database
  2. kysera test seed --strategy realistic  # Populate with test data
  3. npm test                                # Run your tests
  4. kysera test teardown                   # Clean up after testing

For more information on a subcommand, run:
  kysera test <subcommand> --help
`
  );

  // Add subcommands
  cmd.addCommand(testSetupCommand());
  cmd.addCommand(testTeardownCommand());
  cmd.addCommand(testSeedCommand());
  cmd.addCommand(fixturesCommand());

  return cmd;
}
