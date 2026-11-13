import { Command } from 'commander'
import { setTimeout as delay } from 'node:timers/promises'
import { prism, select, isCancel } from '@xec-sh/kit'
import { displayTable as table } from '../../utils/table-helper.js'
import { guardDestructive, requireInteractive } from '../../utils/guard.js'
import { output } from '../../utils/output.js'
import { CLIError } from '../../utils/errors.js'
import { getDatabaseConnection } from '../../utils/database.js'
import { loadConfig } from '../../config/loader.js'
import { formatTimestampForDb } from '@kysera/core'
import type { CircuitState } from '@kysera/infra'
import type { KyseraConfig } from '../../config/schema.js'
import type { KyseraConfigWithDatabase } from '../../utils/with-database.js'

export interface CircuitBreakerOptions {
  action?: 'status' | 'reset' | 'open' | 'close'
  service?: string
  watch?: boolean
  force?: boolean
  json?: boolean
  config?: string
}

interface CircuitBreakerStatus {
  service: string
  state: CircuitState
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
    .option('-w, --watch', 'Watch mode - monitor in real-time')
    .option('--json', 'Output as JSON')
    .option('--force', 'Confirm reset without prompting')
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
  if (options.watch) {
    if (options.json || options.action !== 'status') {
      throw new CLIError(
        '--watch supports interactive status only; use --json without --watch for a snapshot',
        'INVALID_OPTIONS'
      )
    }
    requireInteractive('Watch mode requires a terminal; use --json for a snapshot', options)
  }
  // Load configuration
  // Widened: mocked loaders may resolve null even though the declared return
  // type is non-nullable; the runtime guard below must stay meaningful.
  const config = (await loadConfig(options.config)) as KyseraConfig | null

  if (!config?.database) {
    throw new CLIError('Database configuration not found', 'CONFIG_ERROR', undefined, [
      'Create a kysera.config.ts file with database configuration',
      'Or specify a config file with --config option'
    ])
  }

  // Observe stored state from the explicitly selected database.
  const circuitBreakers = await getCircuitBreakers(config as KyseraConfigWithDatabase)

  if (options.action === 'status') {
    await showCircuitBreakerStatus(circuitBreakers, options, config as KyseraConfigWithDatabase)
  } else if (options.action === 'reset') {
    await resetCircuitBreaker(circuitBreakers, options, config as KyseraConfigWithDatabase)
  } else if (options.action === 'open') {
    await openCircuitBreaker(circuitBreakers, options, config as KyseraConfigWithDatabase)
  } else if (options.action === 'close') {
    await closeCircuitBreaker(circuitBreakers, options, config as KyseraConfigWithDatabase)
  } else {
    throw new CLIError(`Invalid action: ${options.action}`, 'INVALID_ACTION', undefined, [
      'Valid actions are: status, reset, open, close'
    ])
  }
}

async function getCircuitBreakers(
  config: KyseraConfigWithDatabase
): Promise<Map<string, CircuitBreakerStatus>> {
  const breakers = new Map<string, CircuitBreakerStatus>()

  const db = await getDatabaseConnection(config.database)
  if (!db) throw new CLIError('Failed to connect to database', 'DATABASE_ERROR')
  try {
    const tables = await db.introspection.getTables()
    if (!tables.some(table => table.name === 'circuit_breaker_state')) return breakers
    const states = await db.selectFrom('circuit_breaker_state').selectAll().execute()
    for (const state of states) {
      breakers.set(state.service as string, {
        service: state.service as string,
        state: state.state as CircuitState,
        failureCount: Number(state.failure_count),
        successCount: Number(state.success_count),
        lastFailure: state.last_failure ? new Date(state.last_failure as string) : undefined,
        lastSuccess: state.last_success ? new Date(state.last_success as string) : undefined,
        nextRetry: state.next_retry ? new Date(state.next_retry as string) : undefined,
        errorThreshold: Number(state.error_threshold),
        resetTimeout: Number(state.reset_timeout),
        halfOpenRequests: Number(state.half_open_requests ?? 0)
      })
    }
    return breakers
  } finally {
    await db.destroy()
  }
}

async function showCircuitBreakerStatus(
  breakers: Map<string, CircuitBreakerStatus>,
  options: CircuitBreakerOptions,
  config: KyseraConfigWithDatabase
): Promise<void> {
  if (options.watch) {
    const controller = new AbortController()
    const stop = (): void => {
      controller.abort()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
      let observed = breakers
      for (;;) {
        controller.signal.throwIfAborted()
        console.clear()
        console.log(prism.gray('Press Ctrl+C to exit'))
        await showCircuitBreakerStatus(observed, { ...options, watch: false }, config)
        await delay(1000, undefined, { signal: controller.signal })
        controller.signal.throwIfAborted()
        observed = await getCircuitBreakers(config)
      }
    } catch (error) {
      if (!(controller.signal.aborted && error instanceof Error && error.name === 'AbortError')) {
        throw error
      }
    } finally {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
    }
    return
  }
  if (options.service) {
    const breaker = breakers.get(options.service)
    if (!breaker) {
      throw new CLIError(`Service not found: ${options.service}`, 'SERVICE_NOT_FOUND', undefined, [
        `Available services: ${Array.from(breakers.keys()).join(', ')}`
      ])
    }
    breakers = new Map([[options.service, breaker]])
  }

  if (options.json) {
    console.log(JSON.stringify(Array.from(breakers.values()), null, 2))
    return
  }

  displayCircuitBreakerStatus(breakers)
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

  table(statusData)

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
      console.log(
        prism.red(
          `  🚫 ${openBreakers.length} service(s) unavailable: ${openBreakers.map(b => b.service).join(', ')}`
        )
      )
    }
    if (halfOpenBreakers.length > 0) {
      console.log(
        prism.yellow(
          `  ⚠️  ${halfOpenBreakers.length} service(s) recovering: ${halfOpenBreakers.map(b => b.service).join(', ')}`
        )
      )
    }
  }

  // Recommendations
  const highFailureBreakers = Array.from(breakers.values()).filter(
    b => b.failureCount > b.errorThreshold * 2
  )

  if (highFailureBreakers.length > 0) {
    console.log('')
    console.log(prism.cyan('Recommendations:'))
    for (const breaker of highFailureBreakers) {
      console.log(
        prism.yellow(
          `  ⚠ High failure rate for ${breaker.service} (${breaker.failureCount} failures)`
        )
      )
      console.log('    Consider investigating the root cause')
    }
  }
}

async function resetCircuitBreaker(
  breakers: Map<string, CircuitBreakerStatus>,
  options: CircuitBreakerOptions,
  config: KyseraConfigWithDatabase
): Promise<void> {
  let servicesToReset: string[]

  if (options.service) {
    if (!breakers.has(options.service)) {
      throw new CLIError(`Service not found: ${options.service}`, 'SERVICE_NOT_FOUND')
    }
    servicesToReset = [options.service]
  } else {
    // Ask which service to reset
    requireInteractive('Specify a service using --service', options)
    const service = await select({
      message: 'Which circuit breaker to reset?',
      options: [
        { label: 'All', value: 'all' },
        ...Array.from(breakers.keys()).map(s => ({ label: s, value: s }))
      ]
    })

    if (isCancel(service)) return
    servicesToReset = service === 'all' ? Array.from(breakers.keys()) : [service]
  }

  if (servicesToReset.length === 0)
    throw new CLIError('No circuit breaker states found', 'SERVICE_NOT_FOUND')

  if (
    !(await guardDestructive(
      `Reset circuit breaker(s) for: ${servicesToReset.join(', ')}?`,
      options
    ))
  ) {
    return
  }

  // Reset circuit breakers
  for (const service of servicesToReset) {
    const breaker = breakers.get(service)
    if (!breaker) continue
    breaker.state = 'closed'
    breaker.failureCount = 0
    breaker.successCount = 0
    breaker.lastFailure = undefined
    breaker.lastSuccess = undefined
    breaker.nextRetry = undefined
    breaker.halfOpenRequests = 0
  }

  const selected = servicesToReset.map(service => {
    const breaker = breakers.get(service)
    if (!breaker) throw new CLIError(`Circuit breaker disappeared: ${service}`, 'STATE_CHANGED')
    return breaker
  })
  await persistCircuitBreakerState(selected, config)
  output(
    { action: 'reset', services: servicesToReset },
    {
      format: options.json ? 'json' : 'text',
      text: `Reset circuit breaker(s) for: ${servicesToReset.join(', ')}`
    }
  )
}

async function openCircuitBreaker(
  breakers: Map<string, CircuitBreakerStatus>,
  options: CircuitBreakerOptions,
  config: KyseraConfigWithDatabase
): Promise<void> {
  if (!options.service) {
    throw new CLIError('Service name required', 'MISSING_SERVICE', undefined, [
      'Use --service to specify which circuit breaker to open'
    ])
  }

  const breaker = breakers.get(options.service)
  if (!breaker) {
    throw new CLIError(`Service not found: ${options.service}`, 'SERVICE_NOT_FOUND')
  }

  if (breaker.state === 'open') {
    output(
      { action: 'open', service: options.service, state: breaker.state, changed: false },
      {
        format: options.json ? 'json' : 'text',
        text: `Circuit breaker for ${options.service} is already open`
      }
    )
    return
  }

  // Open the circuit breaker
  breaker.state = 'open'
  breaker.lastFailure = new Date()
  breaker.nextRetry = new Date(Date.now() + breaker.resetTimeout)

  await persistCircuitBreakerState([breaker], config)
  output(
    { action: 'open', service: options.service, state: breaker.state },
    {
      format: options.json ? 'json' : 'text',
      text: `Opened circuit breaker for: ${options.service}`
    }
  )
}

async function closeCircuitBreaker(
  breakers: Map<string, CircuitBreakerStatus>,
  options: CircuitBreakerOptions,
  config: KyseraConfigWithDatabase
): Promise<void> {
  if (!options.service) {
    throw new CLIError('Service name required', 'MISSING_SERVICE', undefined, [
      'Use --service to specify which circuit breaker to close'
    ])
  }

  const breaker = breakers.get(options.service)
  if (!breaker) {
    throw new CLIError(`Service not found: ${options.service}`, 'SERVICE_NOT_FOUND')
  }

  if (breaker.state === 'closed') {
    output(
      { action: 'close', service: options.service, state: breaker.state, changed: false },
      {
        format: options.json ? 'json' : 'text',
        text: `Circuit breaker for ${options.service} is already closed`
      }
    )
    return
  }

  // Close the circuit breaker
  breaker.state = 'closed'
  breaker.failureCount = 0
  breaker.lastSuccess = new Date()
  breaker.nextRetry = undefined
  breaker.halfOpenRequests = 0

  await persistCircuitBreakerState([breaker], config)
  output(
    { action: 'close', service: options.service, state: breaker.state },
    {
      format: options.json ? 'json' : 'text',
      text: `Closed circuit breaker for: ${options.service}`
    }
  )
}

async function persistCircuitBreakerState(
  breakers: readonly CircuitBreakerStatus[],
  config: KyseraConfigWithDatabase
): Promise<void> {
  const db = await getDatabaseConnection(config.database)
  if (!db) throw new CLIError('Failed to connect to database', 'DATABASE_ERROR')
  try {
    await db.transaction().execute(async trx => {
      for (const breaker of breakers) {
        const updated = await trx
          .updateTable('circuit_breaker_state')
          .set({
            state: breaker.state,
            failure_count: breaker.failureCount,
            success_count: breaker.successCount,
            last_failure: breaker.lastFailure
              ? formatTimestampForDb(breaker.lastFailure, config.database.dialect)
              : null,
            last_success: breaker.lastSuccess
              ? formatTimestampForDb(breaker.lastSuccess, config.database.dialect)
              : null,
            next_retry: breaker.nextRetry
              ? formatTimestampForDb(breaker.nextRetry, config.database.dialect)
              : null,
            half_open_requests: breaker.halfOpenRequests,
            updated_at: formatTimestampForDb(new Date(), config.database.dialect)
          })
          .where('service', '=', breaker.service)
          .executeTakeFirstOrThrow()
        if (updated.numUpdatedRows !== 1n) {
          throw new CLIError(
            `Circuit breaker changed before it could be saved: ${breaker.service}`,
            'STATE_CHANGED'
          )
        }
      }
    })
  } finally {
    await db.destroy()
  }
}
