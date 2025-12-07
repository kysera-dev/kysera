import { Command } from 'commander';
import { checkCommand } from './check.js';
import { watchCommand } from './watch.js';
import { metricsCommand } from './metrics.js';

export function healthCommand(): Command {
  const cmd = new Command('health').description('Monitor database health and performance');

  // Add subcommands
  cmd.addCommand(checkCommand());
  cmd.addCommand(watchCommand());
  cmd.addCommand(metricsCommand());

  return cmd;
}
