import { Command } from 'commander'
import { prism, spinner, table, confirm, select } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { CircuitBreakerState } from '@kysera/core'

export interface CircuitBreakerOptions {
  action?: 'status' | 'reset' | 'open' | 'close'
  service?: string
  threshold?: string
  timeout?: string
  watch?: boolean
  json?: boolean
  config?: string
}

interface CircuitBreakerStatus {
  service: string
  state: CircuitBreakerState
  failureCount: number
  successCount: number
  lastFailure?: Date
  lastSuccess?: Date
  nextRetry?: Date
  errorThreshold: number
  resetTimeout: number
  halfOpenRequests: number
}

export function circuitBreakerCommand(): Command {
  const cmd = new Command('circuit-breaker')
    .description('Circuit breaker monitoring and management')
    .option('-a, --action <type>', 'Action to perform (status/reset/open/close)', 'status')
    .option('-s, --service <name>', 'Service name (database/cache/api)')
    .option('-t, --threshold <n>', 'Error threshold for opening circuit', '5')
    .option('--timeout <ms>', 'Reset timeout in milliseconds', '30000')
    .option('-w, --watch', 'Watch mode - monitor in real-time')
    .option('--json', 'Output as JSON')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options: CircuitBreakerOptions) => {
      try {
        await manageCircuitBreaker(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to manage circuit breaker: ${error instanceof Error ? error.message : String(error)}`,
          'CIRCUIT_BREAKER_ERROR'
        )
      }
    })

  return cmd
}

async function manageCircuitBreaker(options: CircuitBreakerOptions): Promise<void> {
  // Load configuration
  const config = await loadConfig(options.config)

  if (!config?.database) {
    throw new CLIError(
      'Database configuration not found',
      'CONFIG_ERROR',
      [
        'Create a kysera.config.ts file with database configuration',
        'Or specify a config file with --config option'
      ]
    )
  }

  // Get circuit breaker instance from config or create one
  const circuitBreakers = await getCircuitBreakers(config)

  if (options.action === 'status') {
    await showCircuitBreakerStatus(circuitBreakers, options)
  } else if (options.action === 'reset') {
    await resetCircuitBreaker(circuitBreakers, options)
  } else if (options.action === 'open') {
    await openCircuitBreaker(circuitBreakers, options)
  } else if (options.action === 'close') {
    await closeCircuitBreaker(circuitBreakers, options)
  } else {
    throw new CLIError(
      `Invalid action: ${options.action}`,
      'INVALID_ACTION',
      ['Valid actions are: status, reset, open, close']
    )
  }
}

async function getCircuitBreakers(config: any): Promise<Map<string, CircuitBreakerStatus>> {
  const breakers = new Map<string, CircuitBreakerStatus>()

  // Check for circuit breaker state in a dedicated table or Redis
  const db = await getDatabaseConnection(config.database)

  try {
    // Check if circuit_breaker_state table exists
    const tables = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_name', '=', 'circuit_breaker_state')
      .execute()

    if (tables.length > 0) {
      // Load circuit breaker states from database
      const states = await db
        .selectFrom('circuit_breaker_state')
        .selectAll()
        .execute()

      for (const state of states) {
        breakers.set(state.service as string, {
          service: state.service as string,
          state: state.state as CircuitBreakerState,
          failureCount: Number(state.failure_count),
          successCount: Number(state.success_count),
          lastFailure: state.last_failure ? new Date(state.last_failure as string) : undefined,
          lastSuccess: state.last_success ? new Date(state.last_success as string) : undefined,
          nextRetry: state.next_retry ? new Date(state.next_retry as string) : undefined,
          errorThreshold: Number(state.error_threshold),
          resetTimeout: Number(state.reset_timeout),
          halfOpenRequests: Number(state.half_open_requests || 0)
        })
      }
    } else {
      // Create default circuit breaker states
      breakers.set('database', {
        service: 'database',
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        errorThreshold: 5,
        resetTimeout: 30000,
        halfOpenRequests: 0
      })

      breakers.set('cache', {
        service: 'cache',
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        errorThreshold: 3,
        resetTimeout: 10000,
        halfOpenRequests: 0
      })

      breakers.set('api', {
        service: 'api',
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        errorThreshold: 10,
        resetTimeout: 60000,
        halfOpenRequests: 0
      })
    }

    await db.destroy()
  } catch (error) {
    logger.debug(`Failed to load circuit breaker states: ${error}`)

    // Return default states
    breakers.set('database', {
      service: 'database',
      state: 'closed',
      failureCount: 0,
      successCount: 0,
      errorThreshold: 5,
      resetTimeout: 30000,
      halfOpenRequests: 0
    })
  }

  return breakers
}

async function showCircuitBreakerStatus(
  breakers: Map<string, CircuitBreakerStatus>,
  options: CircuitBreakerOptions
): Promise<void> {
  if (options.service) {
    const breaker = breakers.get(options.service)
    if (!breaker) {
      throw new CLIError(
        `Service not found: ${options.service}`,
        'SERVICE_NOT_FOUND',
        [`Available services: ${Array.from(breakers.keys()).join(', ')}`]
      )
    }
    breakers = new Map([[options.service, breaker]])
  }

  if (options.json) {
    console.log(JSON.stringify(Array.from(breakers.values()), null, 2))
    return
  }

  if (options.watch) {
    // Watch mode - monitor in real-time
    console.log(prism.cyan('⚡ Circuit Breaker Monitor'))
    console.log(prism.gray('Press Ctrl+C to exit'))
    console.log('')

    const interval = setInterval(() => {
      // Clear console and redraw
      console.clear()
      console.log(prism.cyan('⚡ Circuit Breaker Monitor'))
      console.log(prism.gray('Press Ctrl+C to exit'))
      console.log('')
      displayCircuitBreakerStatus(breakers)
    }, 1000)

    // Keep the process running
    await new Promise((resolve) => {
      process.on('SIGINT', () => {
        clearInterval(interval)
        console.log('')
        console.log(prism.gray('Monitoring stopped'))
        resolve(undefined)
      })
    })
  } else {
    displayCircuitBreakerStatus(breakers)
  }
}

function displayCircuitBreakerStatus(breakers: Map<string, CircuitBreakerStatus>): void {
  console.log(prism.bold('⚡ Circuit Breaker Status'))
  console.log(prism.gray('─'.repeat(60)))

  const statusData = Array.from(breakers.values()).map(breaker => {
    let stateIcon: string
    let stateColor: (text: string) => string

    switch (breaker.state) {
      case 'closed':
        stateIcon = '✅'
        stateColor = prism.green
        break
      case 'open':
        stateIcon = '🚫'
        stateColor = prism.red
        break
      case 'half-open':
        stateIcon = '⚠️'
        stateColor = prism.yellow
        break
      default:
        stateIcon = '❓'
        stateColor = prism.gray
    }

    return {
      Service: breaker.service,
      State: `${stateIcon} ${stateColor(breaker.state.toUpperCase())}`,
      Failures: breaker.failureCount,
      Successes: breaker.successCount,
      Threshold: breaker.errorThreshold,
      'Timeout (ms)': breaker.resetTimeout
    }
  })

  console.log(table(statusData))

  // Show details for each breaker
  for (const breaker of breakers.values()) {
    if (breaker.state !== 'closed') {
      console.log('')
      console.log(prism.cyan(`${breaker.service}:`))

      if (breaker.lastFailure) {
        console.log(`  Last Failure: ${breaker.lastFailure.toLocaleString()}`)
      }

      if (breaker.lastSuccess) {
        console.log(`  Last Success: ${breaker.lastSuccess.toLocaleString()}`)
      }

      if (breaker.state === 'open' && breaker.nextRetry) {
        const timeUntilRetry = breaker.nextRetry.getTime() - Date.now()
        if (timeUntilRetry > 0) {
          console.log(`  Next Retry: in ${Math.round(timeUntilRetry / 1000)}s`)
        } else {
          console.log(`  Next Retry: ready`)
        }
      }

      if (breaker.state === 'half-open') {
        console.log(`  Half-Open Requests: ${breaker.halfOpenRequests}`)
      }
    }
  }

  // Overall health assessment
  console.log('')
  console.log(prism.gray('─'.repeat(60)))
  console.log(prism.gray('Health Assessment:'))

  const openBreakers = Array.from(breakers.values()).filter(b => b.state === 'open')
  const halfOpenBreakers = Array.from(breakers.values()).filter(b => b.state === 'half-open')

  if (openBreakers.length === 0 && halfOpenBreakers.length === 0) {
    console.log(prism.green('  ✅ All services operational'))
  } else {
    if (openBreakers.length > 0) {
      console.log(prism.red(`  🚫 ${openBreakers.length} service(s) unavailable: ${openBreakers.map(b => b.service).join(', ')}`))
    }
    if (halfOpenBreakers.length > 0) {
      console.log(prism.yellow(`  ⚠️  ${halfOpenBreakers.length} service(s) recovering: ${halfOpenBreakers.map(b => b.service).join(', ')}`))
    }
  }

  // Recommendations
  const highFailureBreakers = Array.from(breakers.values())
    .filter(b => b.failureCount > b.errorThreshold * 2)

  if (highFailureBreakers.length > 0) {
    console.log('')
    console.log(prism.cyan('Recommendations:'))
    for (const breaker of highFailureBreakers) {
      console.log(prism.yellow(`  ⚠ High failure rate for ${breaker.service} (${breaker.failureCount} failures)`))
      console.log('    Consider investigating the root cause')
    }
  }
}

async function resetCircuitBreaker(
  breakers: Map<string, CircuitBreakerStatus>,
  options: CircuitBreakerOptions
): Promise<void> {
  let servicesToReset: string[]

  if (options.service) {
    if (!breakers.has(options.service)) {
      throw new CLIError(
        `Service not found: ${options.service}`,
        'SERVICE_NOT_FOUND'
      )
    }
    servicesToReset = [options.service]
  } else {
    // Ask which service to reset
    const service = await select({
      message: 'Which circuit breaker to reset?',
      options: [
        { label: 'All', value: 'all' },
        ...Array.from(breakers.keys()).map(s => ({ label: s, value: s }))
      ]
    })

    servicesToReset = service === 'all' ? Array.from(breakers.keys()) : [service as string]
  }

  // Confirm reset
  const confirmed = await confirm({
    message: `Reset circuit breaker(s) for: ${servicesToReset.join(', ')}?`,
    initialValue: false
  })

  if (!confirmed) {
    console.log(prism.gray('Reset cancelled'))
    return
  }

  // Reset circuit breakers
  for (const service of servicesToReset) {
    const breaker = breakers.get(service)!
    breaker.state = 'closed'
    breaker.failureCount = 0
    breaker.successCount = 0
    breaker.lastFailure = undefined
    breaker.lastSuccess = undefined
    breaker.nextRetry = undefined
    breaker.halfOpenRequests = 0
  }

  console.log(prism.green(`✅ Reset circuit breaker(s) for: ${servicesToReset.join(', ')}`))

  // Persist state if using database
  await persistCircuitBreakerState(breakers)
}

async function openCircuitBreaker(
  breakers: Map<string, CircuitBreakerStatus>,
  options: CircuitBreakerOptions
): Promise<void> {
  if (!options.service) {
    throw new CLIError(
      'Service name required',
      'MISSING_SERVICE',
      ['Use --service to specify which circuit breaker to open']
    )
  }

  const breaker = breakers.get(options.service)
  if (!breaker) {
    throw new CLIError(
      `Service not found: ${options.service}`,
      'SERVICE_NOT_FOUND'
    )
  }

  if (breaker.state === 'open') {
    console.log(prism.yellow(`Circuit breaker for ${options.service} is already open`))
    return
  }

  // Open the circuit breaker
  breaker.state = 'open'
  breaker.lastFailure = new Date()
  breaker.nextRetry = new Date(Date.now() + breaker.resetTimeout)

  console.log(prism.red(`🚫 Opened circuit breaker for: ${options.service}`))
  console.log(prism.gray(`Will retry in ${breaker.resetTimeout / 1000} seconds`))

  // Persist state
  await persistCircuitBreakerState(breakers)
}

async function closeCircuitBreaker(
  breakers: Map<string, CircuitBreakerStatus>,
  options: CircuitBreakerOptions
): Promise<void> {
  if (!options.service) {
    throw new CLIError(
      'Service name required',
      'MISSING_SERVICE',
      ['Use --service to specify which circuit breaker to close']
    )
  }

  const breaker = breakers.get(options.service)
  if (!breaker) {
    throw new CLIError(
      `Service not found: ${options.service}`,
      'SERVICE_NOT_FOUND'
    )
  }

  if (breaker.state === 'closed') {
    console.log(prism.yellow(`Circuit breaker for ${options.service} is already closed`))
    return
  }

  // Close the circuit breaker
  breaker.state = 'closed'
  breaker.failureCount = 0
  breaker.lastSuccess = new Date()
  breaker.nextRetry = undefined
  breaker.halfOpenRequests = 0

  console.log(prism.green(`✅ Closed circuit breaker for: ${options.service}`))

  // Persist state
  await persistCircuitBreakerState(breakers)
}

async function persistCircuitBreakerState(breakers: Map<string, CircuitBreakerStatus>): Promise<void> {
  // This would typically persist to database or Redis
  // For now, just log the action
  logger.debug('Circuit breaker state updated')

  // If you have a circuit_breaker_state table, update it here
  try {
    const config = await loadConfig()
    if (config?.database) {
      const db = await getDatabaseConnection(config.database)

      for (const breaker of breakers.values()) {
        await db
          .insertInto('circuit_breaker_state')
          .values({
            service: breaker.service,
            state: breaker.state,
            failure_count: breaker.failureCount,
            success_count: breaker.successCount,
            last_failure: breaker.lastFailure,
            last_success: breaker.lastSuccess,
            next_retry: breaker.nextRetry,
            error_threshold: breaker.errorThreshold,
            reset_timeout: breaker.resetTimeout,
            half_open_requests: breaker.halfOpenRequests,
            updated_at: new Date()
          })
          .onConflict((oc) => oc
            .column('service')
            .doUpdateSet({
              state: breaker.state,
              failure_count: breaker.failureCount,
              success_count: breaker.successCount,
              last_failure: breaker.lastFailure,
              last_success: breaker.lastSuccess,
              next_retry: breaker.nextRetry,
              half_open_requests: breaker.halfOpenRequests,
              updated_at: new Date()
            })
          )
          .execute()
      }

      await db.destroy()
    }
  } catch (error) {
    logger.debug(`Failed to persist circuit breaker state: ${error}`)
  }
}