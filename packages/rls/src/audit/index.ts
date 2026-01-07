/**
 * Audit Trail Module
 *
 * Provides audit logging for RLS policy decisions.
 *
 * @module @kysera/rls/audit
 */

// Types
export type {
  AuditDecision,
  RLSAuditEvent,
  RLSAuditAdapter,
  TableAuditConfig,
  AuditConfig,
  AuditQueryParams,
  AuditStats,
  ConsoleAuditAdapterOptions
} from './types.js'

// Adapters
export { ConsoleAuditAdapter, InMemoryAuditAdapter } from './types.js'

// Logger
export { AuditLogger, createAuditLogger } from './logger.js'
