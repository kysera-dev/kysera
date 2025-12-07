import { Command } from 'commander';
import { prism, spinner } from '@xec-sh/kit';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { withDatabase } from '../../utils/with-database.js';
import { performHealthCheck, type HealthCheckResult } from '@kysera/core';

export interface CheckOptions {
  json?: boolean;
  watch?: boolean;
  interval?: number;
  verbose?: boolean;
  config?: string;
}

export function checkCommand(): Command {
  const cmd = new Command('check')
    .description('Perform a health check')
    .option('--json', 'Output as JSON')
    .option('--watch', 'Watch mode (continuous monitoring)')
    .option('--interval <ms>', 'Check interval in ms', parseInt, 5000)
    .option('-v, --verbose', 'Show detailed metrics')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: CheckOptions) => {
      try {
        if (options.watch) {
          await watchHealth(options);
        } else {
          await checkHealth(options);
        }
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
          'HEALTH_CHECK_ERROR'
        );
      }
    });

  return cmd;
}

async function checkHealth(options: CheckOptions): Promise<void> {
  await withDatabase({ config: options.config, verbose: options.verbose }, async (db) => {
    const checkSpinner = spinner() as any;
    if (!options.json) {
      checkSpinner.start('Performing health check...');
    }

    // Perform health check
    const startTime = Date.now();
    const result = await performHealthCheck(db, {
      verbose: options.verbose,
    });
    const latency = Date.now() - startTime;

    if (!options.json) {
      checkSpinner.succeed('Health check complete');
    }

    // Add latency to result
    const fullResult: HealthCheckResult = {
      ...result,
      metrics: {
        ...result.metrics,
        checkLatency: latency,
      },
      timestamp: result.timestamp || new Date(),
    };

    if (options.json) {
      // Output as JSON - convert Date to ISO string for JSON output
      const jsonOutput = {
        ...fullResult,
        timestamp: fullResult.timestamp.toISOString(),
      };
      console.log(JSON.stringify(jsonOutput, null, 2));
      return;
    }

    // Display health check results
    displayHealthResults(fullResult, options.verbose || false);
  });
}

async function watchHealth(options: CheckOptions): Promise<void> {
  const interval = options.interval || 5000;

  logger.info(`Starting health monitoring (interval: ${interval}ms)`);
  logger.info('Press Ctrl+C to stop');
  logger.info('');

  // Set up interval for continuous monitoring
  let isRunning = true;
  let checkCount = 0;

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    isRunning = false;
    logger.info('\nStopping health monitoring...');
    process.exit(0);
  });

  while (isRunning) {
    checkCount++;

    if (!options.json) {
      // Clear previous output for clean display
      if (checkCount > 1) {
        process.stdout.write('\x1B[2J\x1B[0f'); // Clear screen
      }
      console.log(prism.bold(`Health Check #${checkCount}`));
      console.log(prism.gray(new Date().toLocaleString()));
      console.log('');
    }

    try {
      await checkHealth({ ...options, watch: false });
    } catch (error) {
      if (!options.json) {
        logger.error(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Wait for interval
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

function displayHealthResults(result: HealthCheckResult, verbose: boolean): void {
  console.log('');
  console.log(prism.bold('Database Health Check'));
  console.log('');

  // Overall status
  const statusIcon = result.status === 'healthy' ? '[OK]' : result.status === 'degraded' ? '[WARN]' : '[ERR]';
  const statusColor =
    result.status === 'healthy' ? prism.green : result.status === 'degraded' ? prism.yellow : prism.red;
  console.log(`Status: ${statusColor(statusIcon + ' ' + result.status.charAt(0).toUpperCase() + result.status.slice(1))}`);
  console.log('');

  // Connection info
  console.log('Connection:');
  const connChecks = result.checks.filter((c) => c.name.includes('connection') || c.name.includes('Connection'));
  for (const check of connChecks) {
    const icon = check.status === 'healthy' ? prism.green('[OK]') : prism.red('[ERR]');
    console.log(`  ${icon} ${check.name}`);
    if (check.message && (verbose || check.status !== 'healthy')) {
      console.log(`     ${prism.gray(check.message)}`);
    }
  }

  if (result.metrics?.checkLatency !== undefined) {
    console.log(`  ${prism.green('[OK]')} Latency: ${result.metrics.checkLatency}ms`);
  }

  if (result.metrics?.databaseVersion) {
    console.log(`  ${prism.green('[OK]')} Version: ${result.metrics.databaseVersion}`);
  }
  console.log('');

  // Pool metrics (if available)
  if (result.metrics?.poolMetrics) {
    const pool = result.metrics.poolMetrics;
    console.log('Pool:');
    console.log(`  Active: ${pool.activeConnections}/${pool.totalConnections}`);
    console.log(`  Idle: ${pool.idleConnections}`);
    console.log(`  Waiting: ${pool.waitingRequests || 0}`);
    console.log('');
  }

  // Query metrics (if available and verbose)
  if (verbose && result.metrics?.queryMetrics) {
    const queries = result.metrics.queryMetrics;
    console.log('Queries (last 1m):');
    console.log(`  Total: ${queries.totalQueries || 'N/A'}`);
    console.log(`  Avg: ${queries.avgResponseTime || 'N/A'}ms`);
    console.log(`  Slow (>100ms): ${queries.slowQueries || 0}`);
    console.log(`  Errors: ${queries.errors || 0}`);
    console.log('');
  }

  // Show all checks in verbose mode
  if (verbose) {
    const otherChecks = result.checks.filter((c) => !c.name.includes('connection') && !c.name.includes('Connection'));
    if (otherChecks.length > 0) {
      console.log('Additional Checks:');
      for (const check of otherChecks) {
        const icon =
          check.status === 'healthy'
            ? prism.green('[OK]')
            : check.status === 'degraded'
              ? prism.yellow('[WARN]')
              : prism.red('[ERR]');
        console.log(`  ${icon} ${check.name}`);
        if (check.message) {
          console.log(`     ${prism.gray(check.message)}`);
        }
        if (check.details) {
          for (const [key, value] of Object.entries(check.details)) {
            console.log(`     ${prism.gray(`${key}: ${value}`)}`);
          }
        }
      }
      console.log('');
    }
  }

  // Errors
  if (result.errors && result.errors.length > 0) {
    console.log(prism.red('Errors:'));
    for (const error of result.errors) {
      console.log(`  * ${error}`);
    }
    console.log('');
  }

  console.log(prism.gray(`Last check: ${result.timestamp.toISOString()}`));
}
