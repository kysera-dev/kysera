/**
 * Audit Trail Types
 *
 * Provides type definitions for auditing RLS policy decisions.
 *
 * @module @kysera/rls/audit/types
 */

import type { Operation } from '../policy/types.js'

// ============================================================================
// Audit Event Types
// ============================================================================

/**
 * RLS policy decision result
 */
export type AuditDecision = 'allow' | 'deny' | 'filter'

/**
 * RLS audit event
 *
 * Represents a single policy evaluation event for audit logging.
 *
 * @example
 * ```typescript
 * const event: RLSAuditEvent = {
 *   timestamp: new Date(),
 *   userId: '123',
 *   operation: 'update',
 *   table: 'posts',
 *   policyName: 'ownership-allow',
 *   decision: 'allow',
 *   context: { rowId: '456', tenantId: 'acme' }
 * };
 * ```
 */
export interface RLSAuditEvent {
  /**
   * Timestamp of the event
   */
  timestamp: Date

  /**
   * User ID who performed the action
   */
  userId: string | number

  /**
   * Tenant ID (if multi-tenant)
   */
  tenantId?: string | number

  /**
   * Database operation
   */
  operation: Operation

  /**
   * Table name
   */
  table: string

  /**
   * Name of the policy that made the decision
   */
  policyName?: string

  /**
   * Decision result
   */
  decision: AuditDecision

  /**
   * Reason for the decision (especially for denials)
   */
  reason?: string

  /**
   * Additional context about the event
   */
  context?: Record<string, unknown>

  /**
   * Row ID(s) affected
   */
  rowIds?: (string | number)[]

  /**
   * Hash of the query (for grouping similar queries)
   */
  queryHash?: string

  /**
   * Request ID for tracing
   */
  requestId?: string

  /**
   * IP address of the requester
   */
  ipAddress?: string

  /**
   * User agent string
   */
  userAgent?: string

  /**
   * Duration of policy evaluation in milliseconds
   */
  durationMs?: number

  /**
   * Whether this event was filtered from logging
   * (set by filtering rules but still available for debugging)
   */
  filtered?: boolean
}

// ============================================================================
// Audit Adapter Interface
// ============================================================================

/**
 * Adapter for persisting audit events
 *
 * Implement this interface to store audit events in your preferred backend.
 *
 * @example
 * ```typescript
 * class DatabaseAuditAdapter implements RLSAuditAdapter {
 *   constructor(private db: Kysely<AuditDB>) {}
 *
 *   async log(event: RLSAuditEvent): Promise<void> {
 *     await this.db.insertInto('rls_audit_log')
 *       .values({
 *         user_id: event.userId,
 *         operation: event.operation,
 *         table_name: event.table,
 *         decision: event.decision,
 *         context: JSON.stringify(event.context),
 *         created_at: event.timestamp
 *       })
 *       .execute();
 *   }
 *
 *   async logBatch(events: RLSAuditEvent[]): Promise<void> {
 *     await this.db.insertInto('rls_audit_log')
 *       .values(events.map(e => ({
 *         user_id: e.userId,
 *         operation: e.operation,
 *         table_name: e.table,
 *         decision: e.decision,
 *         context: JSON.stringify(e.context),
 *         created_at: e.timestamp
 *       })))
 *       .execute();
 *   }
 * }
 * ```
 */
export interface RLSAuditAdapter {
  /**
   * Log a single audit event
   *
   * @param event - Event to log
   */
  log(event: RLSAuditEvent): Promise<void>

  /**
   * Log multiple audit events (for batch processing)
   *
   * @param events - Events to log
   */
  logBatch?(events: RLSAuditEvent[]): Promise<void>

  /**
   * Flush any buffered events
   */
  flush?(): Promise<void>

  /**
   * Close the adapter and release resources
   */
  close?(): Promise<void>
}

// ============================================================================
// Audit Configuration
// ============================================================================

/**
 * Configuration for table-specific audit settings
 */
export interface TableAuditConfig {
  /**
   * Whether audit is enabled for this table
   * @default true (if audit is globally enabled)
   */
  enabled?: boolean

  /**
   * Log allowed decisions
   * @default false
   */
  logAllowed?: boolean

  /**
   * Log denied decisions
   * @default true
   */
  logDenied?: boolean

  /**
   * Log filter applications
   * @default false
   */
  logFilters?: boolean

  /**
   * Context fields to include in audit logs
   * If empty, includes all available context
   */
  includeContext?: string[]

  /**
   * Context fields to exclude from audit logs
   */
  excludeContext?: string[]

  /**
   * Whether to include row data in audit logs
   * @default false (for privacy)
   */
  includeRowData?: boolean

  /**
   * Whether to include mutation data in audit logs
   * @default false (for privacy)
   */
  includeMutationData?: boolean

  /**
   * Custom filter function to determine if an event should be logged
   */
  filter?: (event: RLSAuditEvent) => boolean
}

/**
 * Global audit configuration
 */
export interface AuditConfig {
  /**
   * Audit adapter for persisting events
   */
  adapter: RLSAuditAdapter

  /**
   * Whether audit is enabled globally
   * @default true
   */
  enabled?: boolean

  /**
   * Default settings for all tables
   */
  defaults?: Omit<TableAuditConfig, 'enabled'>

  /**
   * Table-specific audit configurations
   */
  tables?: Record<string, TableAuditConfig>

  /**
   * Buffer size for batch logging
   * Events are batched until this size is reached
   * @default 100
   */
  bufferSize?: number

  /**
   * Maximum time to buffer events before flushing (ms)
   * @default 5000 (5 seconds)
   */
  flushInterval?: number

  /**
   * Whether to log asynchronously (fire-and-forget)
   * @default true (for performance)
   */
  async?: boolean

  /**
   * Error handler for audit failures
   */
  onError?: (error: Error, events: RLSAuditEvent[]) => void

  /**
   * Sample rate for audit logging (0.0 to 1.0)
   * Use for high-traffic systems to reduce log volume
   * @default 1.0 (log all)
   */
  sampleRate?: number
}

// ============================================================================
// Audit Query Types
// ============================================================================

/**
 * Query parameters for retrieving audit events
 */
export interface AuditQueryParams {
  /**
   * Filter by user ID
   */
  userId?: string | number

  /**
   * Filter by tenant ID
   */
  tenantId?: string | number

  /**
   * Filter by table name
   */
  table?: string

  /**
   * Filter by operation
   */
  operation?: Operation

  /**
   * Filter by decision
   */
  decision?: AuditDecision

  /**
   * Start timestamp (inclusive)
   */
  startTime?: Date

  /**
   * End timestamp (exclusive)
   */
  endTime?: Date

  /**
   * Filter by request ID
   */
  requestId?: string

  /**
   * Maximum results to return
   */
  limit?: number

  /**
   * Offset for pagination
   */
  offset?: number
}

/**
 * Aggregated audit statistics
 */
export interface AuditStats {
  /**
   * Total number of events
   */
  totalEvents: number

  /**
   * Events by decision type
   */
  byDecision: Record<AuditDecision, number>

  /**
   * Events by operation
   */
  byOperation: Record<Operation, number>

  /**
   * Events by table
   */
  byTable: Record<string, number>

  /**
   * Top denied users
   */
  topDeniedUsers?: { userId: string | number; count: number }[]

  /**
   * Time range of stats
   */
  timeRange: {
    start: Date
    end: Date
  }
}

// ============================================================================
// Console Audit Adapter
// ============================================================================

/**
 * Simple console-based audit adapter for development/testing
 *
 * @example
 * ```typescript
 * const adapter = new ConsoleAuditAdapter({
 *   format: 'json',
 *   colors: true
 * });
 * ```
 */
export interface ConsoleAuditAdapterOptions {
  /**
   * Output format
   * @default 'text'
   */
  format?: 'text' | 'json'

  /**
   * Use colors in output (for text format)
   * @default true
   */
  colors?: boolean

  /**
   * Include timestamp in output
   * @default true
   */
  includeTimestamp?: boolean
}

/**
 * Console audit adapter implementation
 */
export class ConsoleAuditAdapter implements RLSAuditAdapter {
  private options: Required<ConsoleAuditAdapterOptions>

  constructor(options: ConsoleAuditAdapterOptions = {}) {
    this.options = {
      format: options.format ?? 'text',
      colors: options.colors ?? true,
      includeTimestamp: options.includeTimestamp ?? true
    }
  }

  log(event: RLSAuditEvent): Promise<void> {
    if (this.options.format === 'json') {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(event))
    } else {
      const prefix = this.getPrefix(event.decision)
      const timestamp = this.options.includeTimestamp ? `[${event.timestamp.toISOString()}] ` : ''
      // eslint-disable-next-line no-console
      console.log(
        `${timestamp}${prefix} RLS ${event.decision.toUpperCase()}: ${event.operation} on ${event.table}` +
          (event.policyName ? ` (policy: ${event.policyName})` : '') +
          (event.reason ? ` - ${event.reason}` : '') +
          (event.userId ? ` [user: ${event.userId}]` : '')
      )
    }
    return Promise.resolve()
  }

  async logBatch(events: RLSAuditEvent[]): Promise<void> {
    for (const event of events) {
      await this.log(event)
    }
  }

  private getPrefix(decision: AuditDecision): string {
    if (!this.options.colors) {
      return decision === 'allow' ? '✓' : decision === 'deny' ? '✗' : '~'
    }

    switch (decision) {
      case 'allow':
        return '\x1b[32m✓\x1b[0m' // Green
      case 'deny':
        return '\x1b[31m✗\x1b[0m' // Red
      case 'filter':
        return '\x1b[33m~\x1b[0m' // Yellow
      default:
        return '?'
    }
  }
}

// ============================================================================
// In-Memory Audit Adapter
// ============================================================================

/**
 * In-memory audit adapter for testing
 *
 * Stores events in memory for later retrieval and assertion.
 */
export class InMemoryAuditAdapter implements RLSAuditAdapter {
  private events: RLSAuditEvent[] = []
  private maxSize: number

  constructor(maxSize = 10000) {
    this.maxSize = maxSize
  }

  log(event: RLSAuditEvent): Promise<void> {
    this.events.push(event)
    // Trim if exceeds max size
    if (this.events.length > this.maxSize) {
      this.events = this.events.slice(-this.maxSize)
    }
    return Promise.resolve()
  }

  logBatch(events: RLSAuditEvent[]): Promise<void> {
    this.events.push(...events)
    if (this.events.length > this.maxSize) {
      this.events = this.events.slice(-this.maxSize)
    }
    return Promise.resolve()
  }

  /**
   * Get all logged events
   */
  getEvents(): RLSAuditEvent[] {
    return [...this.events]
  }

  /**
   * Query events
   */
  query(params: AuditQueryParams): RLSAuditEvent[] {
    let results = [...this.events]

    if (params.userId !== undefined) {
      results = results.filter(e => e.userId === params.userId)
    }
    if (params.tenantId !== undefined) {
      results = results.filter(e => e.tenantId === params.tenantId)
    }
    if (params.table) {
      results = results.filter(e => e.table === params.table)
    }
    if (params.operation) {
      results = results.filter(e => e.operation === params.operation)
    }
    if (params.decision) {
      results = results.filter(e => e.decision === params.decision)
    }
    if (params.startTime) {
      results = results.filter(e => e.timestamp >= params.startTime!)
    }
    if (params.endTime) {
      results = results.filter(e => e.timestamp < params.endTime!)
    }
    if (params.requestId) {
      results = results.filter(e => e.requestId === params.requestId)
    }

    if (params.offset) {
      results = results.slice(params.offset)
    }
    if (params.limit) {
      results = results.slice(0, params.limit)
    }

    return results
  }

  /**
   * Get statistics
   */
  getStats(params?: Pick<AuditQueryParams, 'startTime' | 'endTime'>): AuditStats {
    let events = this.events

    if (params?.startTime) {
      events = events.filter(e => e.timestamp >= params.startTime!)
    }
    if (params?.endTime) {
      events = events.filter(e => e.timestamp < params.endTime!)
    }

    const byDecision: Record<AuditDecision, number> = { allow: 0, deny: 0, filter: 0 }
    const byOperation: Record<Operation, number> = { read: 0, create: 0, update: 0, delete: 0, all: 0 }
    const byTable: Record<string, number> = {}

    for (const event of events) {
      byDecision[event.decision]++
      byOperation[event.operation]++
      byTable[event.table] = (byTable[event.table] ?? 0) + 1
    }

    return {
      totalEvents: events.length,
      byDecision,
      byOperation,
      byTable,
      timeRange: {
        start: events[0]?.timestamp ?? new Date(),
        end: events[events.length - 1]?.timestamp ?? new Date()
      }
    }
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = []
  }

  /**
   * Get event count
   */
  get size(): number {
    return this.events.length
  }
}
