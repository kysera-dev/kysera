/**
 * RLS Error Classes
 *
 * This module provides specialized error classes for Row-Level Security operations.
 * All errors extend base error classes from @kysera/core for consistency across
 * the Kysera ecosystem.
 *
 * @module @kysera/rls/errors
 */

import { DatabaseError } from '@kysera/core'
import type { ErrorCode } from '@kysera/core'

// ============================================================================
// RLS Error Codes
// ============================================================================

/**
 * RLS-specific error codes
 *
 * These codes extend the unified error codes from @kysera/core with
 * RLS-specific error conditions.
 */
export const RLSErrorCodes = {
  /** RLS context is missing or not set */
  RLS_CONTEXT_MISSING: 'RLS_CONTEXT_MISSING' as ErrorCode,
  /** RLS policy violation occurred */
  RLS_POLICY_VIOLATION: 'RLS_POLICY_VIOLATION' as ErrorCode,
  /** RLS policy definition is invalid */
  RLS_POLICY_INVALID: 'RLS_POLICY_INVALID' as ErrorCode,
  /** RLS schema definition is invalid */
  RLS_SCHEMA_INVALID: 'RLS_SCHEMA_INVALID' as ErrorCode,
  /** RLS context validation failed */
  RLS_CONTEXT_INVALID: 'RLS_CONTEXT_INVALID' as ErrorCode,
  /** RLS policy evaluation threw an error */
  RLS_POLICY_EVALUATION_ERROR: 'RLS_POLICY_EVALUATION_ERROR' as ErrorCode
} as const

/**
 * Type for RLS error codes
 */
export type RLSErrorCode = (typeof RLSErrorCodes)[keyof typeof RLSErrorCodes]

// ============================================================================
// Base RLS Error
// ============================================================================

/**
 * Base class for all RLS-related errors
 *
 * Extends DatabaseError from @kysera/core for consistency with other Kysera packages.
 * Provides common error functionality including error codes and JSON serialization.
 *
 * @example
 * ```typescript
 * throw new RLSError('Something went wrong', RLSErrorCodes.RLS_POLICY_INVALID);
 * ```
 */
export class RLSError extends DatabaseError {
  /**
   * Creates a new RLS error
   *
   * @param message - Error message
   * @param code - RLS error code
   */
  constructor(message: string, code: RLSErrorCode) {
    super(message, code)
    this.name = 'RLSError'
  }
}

// ============================================================================
// Context Errors
// ============================================================================

/**
 * Error thrown when RLS context is missing
 *
 * This error occurs when an operation requiring RLS context is executed
 * outside of a context scope (i.e., without calling withRLSContext()).
 *
 * @example
 * ```typescript
 * // This will throw RLSContextError
 * const result = await db.selectFrom('posts').execute();
 *
 * // Correct usage with context
 * await withRLSContext(rlsContext, async () => {
 *   const result = await db.selectFrom('posts').execute();
 * });
 * ```
 */
export class RLSContextError extends RLSError {
  /**
   * Creates a new RLS context error
   *
   * @param message - Error message (defaults to standard message)
   */
  constructor(message = 'No RLS context found. Ensure code runs within withRLSContext()') {
    super(message, RLSErrorCodes.RLS_CONTEXT_MISSING)
    this.name = 'RLSContextError'
  }
}

/**
 * Error thrown when RLS context validation fails
 *
 * Extends RLSError as context validation failures are RLS-specific errors.
 *
 * This error occurs when the provided RLS context is invalid or missing
 * required fields.
 *
 * @example
 * ```typescript
 * // Missing required userId field
 * const invalidContext = {
 *   auth: {
 *     roles: ['user']
 *     // userId is missing!
 *   },
 *   timestamp: new Date()
 * };
 *
 * // This will throw RLSContextValidationError
 * validateRLSContext(invalidContext);
 * ```
 */
export class RLSContextValidationError extends RLSError {
  public readonly field: string

  /**
   * Creates a new context validation error
   *
   * @param message - Error message
   * @param field - Field that failed validation
   */
  constructor(message: string, field: string) {
    super(message, RLSErrorCodes.RLS_CONTEXT_INVALID)
    this.name = 'RLSContextValidationError'
    this.field = field
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      field: this.field
    }
  }
}

// ============================================================================
// Policy Errors
// ============================================================================

/**
 * Error thrown when an RLS policy violation occurs
 *
 * This error is thrown when a database operation is denied by RLS policies.
 * It provides detailed information about the violation including the operation,
 * table, and reason for denial.
 *
 * @example
 * ```typescript
 * // User tries to update a post they don't own
 * throw new RLSPolicyViolation(
 *   'update',
 *   'posts',
 *   'User does not own this post',
 *   'ownership_policy'
 * );
 * ```
 */
export class RLSPolicyViolation extends RLSError {
  public readonly operation: string
  public readonly table: string
  public readonly reason: string
  public readonly policyName?: string

  /**
   * Creates a new policy violation error
   *
   * @param operation - Database operation that was denied (read, create, update, delete)
   * @param table - Table name where violation occurred
   * @param reason - Reason for the policy violation
   * @param policyName - Name of the policy that denied access (optional)
   */
  constructor(operation: string, table: string, reason: string, policyName?: string) {
    super(
      `RLS policy violation: ${operation} on ${table} - ${reason}`,
      RLSErrorCodes.RLS_POLICY_VIOLATION
    )
    this.name = 'RLSPolicyViolation'
    this.operation = operation
    this.table = table
    this.reason = reason
    if (policyName !== undefined) {
      this.policyName = policyName
    }
  }

  override toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      ...super.toJSON(),
      operation: this.operation,
      table: this.table,
      reason: this.reason
    }
    if (this.policyName !== undefined) {
      json['policyName'] = this.policyName
    }
    return json
  }
}

// ============================================================================
// Policy Evaluation Errors
// ============================================================================

/**
 * Error thrown when a policy condition throws an error during evaluation
 *
 * This error is distinct from RLSPolicyViolation - it indicates a bug in the
 * policy condition function itself, not a legitimate access denial.
 *
 * @example
 * ```typescript
 * // A policy with a bug
 * allow('read', ctx => {
 *   return ctx.row.someField.value; // Throws if someField is undefined
 * });
 *
 * // This will throw RLSPolicyEvaluationError, not RLSPolicyViolation
 * ```
 */
export class RLSPolicyEvaluationError extends RLSError {
  public readonly operation: string
  public readonly table: string
  public readonly policyName?: string
  public readonly originalError?: Error

  /**
   * Creates a new policy evaluation error
   *
   * @param operation - Database operation being performed
   * @param table - Table name where error occurred
   * @param message - Error message from the policy
   * @param policyName - Name of the policy that threw
   * @param originalError - The original error thrown by the policy
   */
  constructor(
    operation: string,
    table: string,
    message: string,
    policyName?: string,
    originalError?: Error
  ) {
    super(
      `RLS policy evaluation error during ${operation} on ${table}: ${message}`,
      RLSErrorCodes.RLS_POLICY_EVALUATION_ERROR
    )
    this.name = 'RLSPolicyEvaluationError'
    this.operation = operation
    this.table = table
    if (policyName !== undefined) {
      this.policyName = policyName
    }
    if (originalError !== undefined) {
      this.originalError = originalError
      // Preserve the original stack trace for debugging
      if (originalError.stack) {
        this.stack = `${this.stack}\n\nCaused by:\n${originalError.stack}`
      }
    }
  }

  override toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      ...super.toJSON(),
      operation: this.operation,
      table: this.table
    }
    if (this.policyName !== undefined) {
      json['policyName'] = this.policyName
    }
    if (this.originalError !== undefined) {
      json['originalError'] = {
        name: this.originalError.name,
        message: this.originalError.message
      }
    }
    return json
  }
}

// ============================================================================
// Schema Errors
// ============================================================================

/**
 * Error thrown when RLS schema validation fails
 *
 * Extends RLSError as schema validation failures are RLS-specific errors.
 *
 * This error occurs when the RLS schema definition is invalid or contains
 * configuration errors.
 *
 * @example
 * ```typescript
 * // Invalid policy definition
 * const invalidSchema = {
 *   posts: {
 *     policies: [
 *       {
 *         type: 'invalid-type', // Invalid policy type!
 *         operation: 'read',
 *         condition: (ctx) => true
 *       }
 *     ]
 *   }
 * };
 *
 * // This will throw RLSSchemaError
 * validateRLSSchema(invalidSchema);
 * ```
 */
export class RLSSchemaError extends RLSError {
  public readonly details: Record<string, unknown>

  /**
   * Creates a new schema validation error
   *
   * @param message - Error message
   * @param details - Additional details about the validation failure
   */
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, RLSErrorCodes.RLS_SCHEMA_INVALID)
    this.name = 'RLSSchemaError'
    this.details = details
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      details: this.details
    }
  }
}
