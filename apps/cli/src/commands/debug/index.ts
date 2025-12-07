import { Command } from 'commander';
import { sqlCommand } from './sql.js';
import { profileCommand } from './profile.js';
import { errorsCommand } from './errors.js';
import { circuitBreakerCommand } from './circuit-breaker.js';
import { analyzerCommand } from './analyzer.js';

export function debugCommand(): Command {
  const cmd = new Command('debug').description('Debug and performance analysis tools');

  // Add subcommands
  cmd.addCommand(sqlCommand());
  cmd.addCommand(profileCommand());
  cmd.addCommand(errorsCommand());
  cmd.addCommand(circuitBreakerCommand());
  cmd.addCommand(analyzerCommand());

  return cmd;
}
