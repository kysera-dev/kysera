import { Command } from 'commander';
import { prism, spinner } from '@xec-sh/kit';
import { createWriteStream } from 'node:fs';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { getDatabaseConnection } from '../../utils/database.js';
import { loadConfig } from '../../config/loader.js';
import { performHealthCheck } from '@kysera/core';

export interface WatchOptions {
  interval?: number;
  json?: boolean;
  log?: string;
  config?: string;
  verbose?: boolean;
}

export function watchCommand(): Command {
  const cmd = new Command('watch')
    .description('Continuous health monitoring')
    .option('--interval <ms>', 'Check interval in ms', parseInt, 5000)
    .option('--json', 'Output as JSON')
    .option('--log <file>', 'Log to file')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-v, --verbose', 'Show detailed metrics')
    .action(async (options: WatchOptions) => {
      try {
        await watchHealthContinuous(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Health monitoring failed: ${error instanceof Error ? error.message : String(error)}`,
          'HEALTH_WATCH_ERROR'
        );
      }
    });

  return cmd;
}

async function watchHealthContinuous(options: WatchOptions): Promise<void> {
  const interval = options.interval || 5000;

  // Load configuration
  const config = await loadConfig(options.config);

  if (!config?.database) {
    throw new CLIError('Database configuration not found', 'CONFIG_ERROR', [
      'Create a kysera.config.ts file with database configuration',
      'Or specify a config file with --config option',
    ]);
  }

  // Set up log file if specified
  let logStream: ReturnType<typeof createWriteStream> | null = null;
  if (options.log) {
    logStream = createWriteStream(options.log, { flags: 'a' });
    logger.info(`Logging to file: ${options.log}`);
  }

  logger.info(`Starting continuous health monitoring`);
  logger.info(`Interval: ${interval}ms`);
  logger.info('Press Ctrl+C to stop');
  logger.info('');

  let isRunning = true;
  let checkCount = 0;
  let consecutiveFailures = 0;
  const maxConsecutiveFailures = 5;

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    isRunning = false;
    logger.info('\nStopping health monitoring...');
    if (logStream) {
      logStream.end();
    }
    process.exit(0);
  });

  // Keep persistent connection for monitoring
  const db = await getDatabaseConnection(config.database);

  if (!db) {
    throw new CLIError('Failed to connect to database', 'DATABASE_ERROR', [
      'Check your database configuration',
      'Ensure the database server is running',
    ]);
  }

  try {
    while (isRunning) {
      checkCount++;
      const checkTime = new Date();

      if (!options.json) {
        // Clear previous output for clean display
        if (checkCount > 1) {
          process.stdout.write('\x1B[2J\x1B[0f'); // Clear screen
        }
        console.log(prism.bold(`🏥 Health Monitor - Check #${checkCount}`));
        console.log(prism.gray(checkTime.toLocaleString()));
        console.log(prism.gray('─'.repeat(50)));
        console.log('');
      }

      try {
        // Perform health check
        const startTime = Date.now();
        const result = await performHealthCheck(db, {
          verbose: options.verbose,
        });
        const latency = Date.now() - startTime;

        // Reset consecutive failures on success
        if (result.status === 'healthy') {
          consecutiveFailures = 0;
        }

        // Format result
        const fullResult = {
          checkNumber: checkCount,
          ...result,
          metrics: {
            ...result.metrics,
            checkLatency: latency,
          },
          timestamp: checkTime.toISOString(),
        };

        // Output result
        if (options.json) {
          console.log(JSON.stringify(fullResult));
        } else {
          displayMonitoringResult(fullResult, options.verbose || false, consecutiveFailures);
        }

        // Log to file if specified
        if (logStream) {
          logStream.write(JSON.stringify(fullResult) + '\n');
        }
      } catch (error) {
        consecutiveFailures++;

        const errorResult = {
          checkNumber: checkCount,
          status: 'unhealthy',
          error: error instanceof Error ? error.message : String(error),
          timestamp: checkTime.toISOString(),
          consecutiveFailures,
        };

        if (options.json) {
          console.log(JSON.stringify(errorResult));
        } else {
          console.log(prism.red('❌ Health check failed'));
          console.log(prism.red(`Error: ${errorResult.error}`));
          console.log(prism.yellow(`Consecutive failures: ${consecutiveFailures}`));
        }

        // Log error to file
        if (logStream) {
          logStream.write(JSON.stringify(errorResult) + '\n');
        }

        // Alert if too many consecutive failures
        if (consecutiveFailures >= maxConsecutiveFailures) {
          console.log('');
          console.log(prism.red(`⚠️  ALERT: ${consecutiveFailures} consecutive health check failures!`));
          console.log(prism.yellow('Database may be experiencing issues'));

          if (!options.json) {
            // Could implement alerting here (email, webhook, etc.)
          }
        }
      }

      // Wait for interval
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  } finally {
    // Close database connection
    await db.destroy();
    if (logStream) {
      logStream.end();
    }
  }
}

function displayMonitoringResult(result: any, verbose: boolean, consecutiveFailures: number): void {
  // Status with icon
  const statusIcon = result.status === 'healthy' ? '✅' : result.status === 'degraded' ? '⚠️' : '❌';
  const statusColor =
    result.status === 'healthy' ? prism.green : result.status === 'degraded' ? prism.yellow : prism.red;

  console.log(`Status: ${statusIcon} ${statusColor(result.status.toUpperCase())}`);

  // Show latency
  if (result.metrics?.checkLatency) {
    const latencyColor =
      result.metrics.checkLatency < 10 ? prism.green : result.metrics.checkLatency < 50 ? prism.yellow : prism.red;
    console.log(`Latency: ${latencyColor(result.metrics.checkLatency + 'ms')}`);
  }

  // Show consecutive failures if any
  if (consecutiveFailures > 0) {
    console.log(prism.yellow(`⚠️  Consecutive failures: ${consecutiveFailures}`));
  }

  console.log('');

  // Connection status
  if (result.checks) {
    const connCheck = result.checks.find((c: any) => c.name.toLowerCase().includes('connection'));
    if (connCheck) {
      const icon = connCheck.status === 'healthy' ? '🟢' : '🔴';
      console.log(`${icon} Connection: ${connCheck.status}`);
    }
  }

  // Pool metrics
  if (result.metrics?.poolMetrics) {
    const pool = result.metrics.poolMetrics;
    const usage = Math.round((pool.activeConnections / pool.totalConnections) * 100);
    const usageBar = createProgressBar(usage, 20);

    console.log(`Pool Usage: ${usageBar} ${usage}%`);
    console.log(`Connections: ${pool.activeConnections}/${pool.totalConnections} (${pool.idleConnections} idle)`);
  }

  // Query metrics in verbose mode
  if (verbose && result.metrics?.queryMetrics) {
    console.log('');
    console.log('Query Metrics:');
    console.log(`  Total: ${result.metrics.queryMetrics.totalQueries || 0}`);
    console.log(`  Avg Response: ${result.metrics.queryMetrics.avgResponseTime || 0}ms`);
    console.log(`  Slow Queries: ${result.metrics.queryMetrics.slowQueries || 0}`);
    console.log(`  Errors: ${result.metrics.queryMetrics.errors || 0}`);
  }

  // Show errors if any
  if (result.errors && result.errors.length > 0) {
    console.log('');
    console.log(prism.red('Errors:'));
    for (const error of result.errors) {
      console.log(`  • ${error}`);
    }
  }

  console.log('');
  console.log(prism.gray('─'.repeat(50)));
}

function createProgressBar(percentage: number, width: number): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;

  let color = prism.green;
  if (percentage > 80) color = prism.red;
  else if (percentage > 60) color = prism.yellow;

  return color('█'.repeat(filled)) + prism.gray('░'.repeat(empty));
}
