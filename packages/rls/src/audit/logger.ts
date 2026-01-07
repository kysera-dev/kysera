/**
 * Audit Logger
 *
 * Manages audit event logging with buffering and filtering.
 *
 * @module @kysera/rls/audit/logger
 */

import type {
  RLSAuditEvent,
  RLSAuditAdapter,
  AuditConfig,
  TableAuditConfig,
  AuditDecision
} from './types.js'
import type { Operation, RLSContext } from '../policy/types.js'
import { rlsContext } from '../context/manager.js'

// ============================================================================
// Audit Logger
// ============================================================================

/**
 * Audit Logger
 *
 * Manages RLS audit event logging with buffering, filtering, and sampling.
 *
 * @example
 * ```typescript
 * const logger = new AuditLogger({
 *   adapter: new DatabaseAuditAdapter(db),
 *   bufferSize: 50,
 *   flushInterval: 5000,
 *   defaults: {
 *     logAllowed: false,
 *     logDenied: true,
 *     logFilters: false
 *   },
 *   tables: {
 *     sensitive_data: {
 *       logAllowed: true,
 *       includeContext: ['requestId', 'ipAddress']
 *     }
 *   }
 * });
 *
 * // Log an event
 * await logger.logDecision('update', 'posts', 'allow', 'ownership-allow');
 *
 * // Ensure all events are flushed
 * await logger.flush();
 * ```
 */
export class AuditLogger {
  private adapter: RLSAuditAdapter
  private config: Required<Omit<AuditConfig, 'adapter' | 'tables' | 'onError'>> & {
    tables: Record<string, TableAuditConfig>
    onError?: (error: Error, events: RLSAuditEvent[]) => void
  }
  private buffer: RLSAuditEvent[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private isShuttingDown = false

  constructor(config: AuditConfig) {
    this.adapter = config.adapter
    const baseConfig = {
      enabled: config.enabled ?? true,
      defaults: config.defaults ?? {
        logAllowed: false,
        logDenied: true,
        logFilters: false
      },
      tables: config.tables ?? {},
      bufferSize: config.bufferSize ?? 100,
      flushInterval: config.flushInterval ?? 5000,
      async: config.async ?? true,
      sampleRate: config.sampleRate ?? 1.0
    }

    this.config = config.onError !== undefined
      ? { ...baseConfig, onError: config.onError }
      : baseConfig

    // Start flush timer
    if (this.config.flushInterval > 0) {
      this.startFlushTimer()
    }
  }

  /**
   * Log a policy decision
   *
   * @param operation - Database operation
   * @param table - Table name
   * @param decision - Decision result
   * @param policyName - Name of the policy
   * @param options - Additional options
   */
  async logDecision(
    operation: Operation,
    table: string,
    decision: AuditDecision,
    policyName?: string,
    options?: {
      reason?: string
      rowIds?: (string | number)[]
      queryHash?: string
      durationMs?: number
      context?: Record<string, unknown>
    }
  ): Promise<void> {
    if (!this.config.enabled || this.isShuttingDown) {
      return
    }

    // Check sampling
    if (this.config.sampleRate < 1.0 && Math.random() > this.config.sampleRate) {
      return
    }

    // Get table config
    const tableConfig = this.getTableConfig(table)

    // Check if this decision type should be logged
    if (!this.shouldLog(decision, tableConfig)) {
      return
    }

    // Get current RLS context
    const ctx = rlsContext.getContextOrNull()

    // Build event
    const event = this.buildEvent(operation, table, decision, policyName, ctx, tableConfig, options)

    // Apply custom filter if present
    if (tableConfig.filter && !tableConfig.filter(event)) {
      event.filtered = true
      return
    }

    // Log the event
    await this.logEvent(event)
  }

  /**
   * Log an allow decision
   */
  async logAllow(
    operation: Operation,
    table: string,
    policyName?: string,
    options?: {
      reason?: string
      rowIds?: (string | number)[]
      context?: Record<string, unknown>
    }
  ): Promise<void> {
    await this.logDecision(operation, table, 'allow', policyName, options)
  }

  /**
   * Log a deny decision
   */
  async logDeny(
    operation: Operation,
    table: string,
    policyName?: string,
    options?: {
      reason?: string
      rowIds?: (string | number)[]
      context?: Record<string, unknown>
    }
  ): Promise<void> {
    await this.logDecision(operation, table, 'deny', policyName, options)
  }

  /**
   * Log a filter application
   */
  async logFilter(
    table: string,
    policyName?: string,
    options?: {
      context?: Record<string, unknown>
    }
  ): Promise<void> {
    await this.logDecision('read', table, 'filter', policyName, options)
  }

  /**
   * Flush buffered events
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return
    }

    const eventsToFlush = [...this.buffer]
    this.buffer = []

    try {
      if (this.adapter.logBatch) {
        await this.adapter.logBatch(eventsToFlush)
      } else {
        for (const event of eventsToFlush) {
          await this.adapter.log(event)
        }
      }
    } catch (error) {
      this.config.onError?.(error instanceof Error ? error : new Error(String(error)), eventsToFlush)
    }
  }

  /**
   * Close the logger
   */
  async close(): Promise<void> {
    this.isShuttingDown = true

    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    await this.flush()
    await this.adapter.flush?.()
    await this.adapter.close?.()
  }

  /**
   * Get buffer size
   */
  get bufferSize(): number {
    return this.buffer.length
  }

  /**
   * Check if logger is enabled
   */
  get enabled(): boolean {
    return this.config.enabled
  }

  /**
   * Enable or disable logging
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get table-specific config with defaults
   */
  private getTableConfig(table: string): TableAuditConfig {
    const tableOverride = this.config.tables[table]
    return {
      ...this.config.defaults,
      ...tableOverride,
      enabled: tableOverride?.enabled ?? true
    }
  }

  /**
   * Check if decision should be logged
   */
  private shouldLog(decision: AuditDecision, tableConfig: TableAuditConfig): boolean {
    if (!tableConfig.enabled) {
      return false
    }

    switch (decision) {
      case 'allow':
        return tableConfig.logAllowed ?? false
      case 'deny':
        return tableConfig.logDenied ?? true
      case 'filter':
        return tableConfig.logFilters ?? false
      default:
        return false
    }
  }

  /**
   * Build audit event
   */
  private buildEvent(
    operation: Operation,
    table: string,
    decision: AuditDecision,
    policyName: string | undefined,
    ctx: RLSContext | null,
    tableConfig: TableAuditConfig,
    options?: {
      reason?: string
      rowIds?: (string | number)[]
      queryHash?: string
      durationMs?: number
      context?: Record<string, unknown>
    }
  ): RLSAuditEvent {
    const event: RLSAuditEvent = {
      timestamp: new Date(),
      userId: ctx?.auth.userId ?? 'anonymous',
      operation,
      table,
      decision
    }

    // Add tenant ID if present
    if (ctx?.auth.tenantId !== undefined) {
      event.tenantId = ctx.auth.tenantId
    }

    // Add policy name
    if (policyName) {
      event.policyName = policyName
    }

    // Add options
    if (options?.reason) {
      event.reason = options.reason
    }
    if (options?.rowIds && options.rowIds.length > 0) {
      event.rowIds = options.rowIds
    }
    if (options?.queryHash) {
      event.queryHash = options.queryHash
    }
    if (options?.durationMs !== undefined) {
      event.durationMs = options.durationMs
    }

    // Add request context
    if (ctx?.request) {
      if (ctx.request.requestId) {
        event.requestId = ctx.request.requestId
      }
      if (ctx.request.ipAddress) {
        event.ipAddress = ctx.request.ipAddress
      }
      if (ctx.request.userAgent) {
        event.userAgent = ctx.request.userAgent
      }
    }

    // Build context
    const context = this.buildContext(ctx, tableConfig, options?.context)
    if (context !== undefined) {
      event.context = context
    }

    return event
  }

  /**
   * Build context object with filtering
   */
  private buildContext(
    ctx: RLSContext | null,
    tableConfig: TableAuditConfig,
    additionalContext?: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    const context: Record<string, unknown> = {}

    // Add roles
    if (ctx?.auth.roles && ctx.auth.roles.length > 0) {
      context['roles'] = ctx.auth.roles
    }

    // Add organization IDs if present
    if (ctx?.auth.organizationIds && ctx.auth.organizationIds.length > 0) {
      context['organizationIds'] = ctx.auth.organizationIds
    }

    // Add meta if present
    if (ctx?.meta && typeof ctx.meta === 'object') {
      Object.assign(context, ctx.meta)
    }

    // Add additional context
    if (additionalContext) {
      Object.assign(context, additionalContext)
    }

    // Apply include/exclude filters
    let filteredContext = context

    if (tableConfig.includeContext && tableConfig.includeContext.length > 0) {
      filteredContext = {}
      for (const key of tableConfig.includeContext) {
        if (key in context) {
          filteredContext[key] = context[key]
        }
      }
    }

    if (tableConfig.excludeContext && tableConfig.excludeContext.length > 0) {
      for (const key of tableConfig.excludeContext) {
        // Use destructuring to avoid dynamic delete
        const { [key]: _, ...rest } = filteredContext
        filteredContext = rest
      }
    }

    return Object.keys(filteredContext).length > 0 ? filteredContext : undefined
  }

  /**
   * Log event to buffer or directly
   */
  private async logEvent(event: RLSAuditEvent): Promise<void> {
    if (this.config.async && this.config.bufferSize > 0) {
      // Buffered async logging
      this.buffer.push(event)

      if (this.buffer.length >= this.config.bufferSize) {
        // Buffer full, flush now
        await this.flush()
      }
    } else if (this.config.async) {
      // Async fire-and-forget
      this.adapter.log(event).catch((error: unknown) => {
        this.config.onError?.(error instanceof Error ? error : new Error(String(error)), [event])
      })
    } else {
      // Synchronous logging
      try {
        await this.adapter.log(event)
      } catch (error) {
        this.config.onError?.(error instanceof Error ? error : new Error(String(error)), [event])
      }
    }
  }

  /**
   * Start the flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch((error: unknown) => {
        this.config.onError?.(error instanceof Error ? error : new Error(String(error)), [...this.buffer])
      })
    }, this.config.flushInterval)

    // Don't block process exit
    if (this.flushTimer.unref) {
      this.flushTimer.unref()
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an audit logger
 */
export function createAuditLogger(config: AuditConfig): AuditLogger {
  return new AuditLogger(config)
}
