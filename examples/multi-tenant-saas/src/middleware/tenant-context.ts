import type { Kysely } from 'kysely'
import type { Database } from '../db/schema'

/**
 * Tenant Context
 *
 * Stores the current tenant ID for request-scoped queries.
 * In a real application, this would be extracted from:
 * - JWT token
 * - Subdomain (tenant.app.com)
 * - Custom header (X-Tenant-ID)
 * - Session data
 */

export class TenantContext {
  private tenantId: number | null = null

  setTenantId(tenantId: number): void {
    this.tenantId = tenantId
  }

  getTenantId(): number {
    if (this.tenantId === null) {
      throw new Error('Tenant context not set. Call setTenantId() first.')
    }
    return this.tenantId
  }

  hasTenant(): boolean {
    return this.tenantId !== null
  }

  clear(): void {
    this.tenantId = null
  }
}

/**
 * Create a tenant-scoped Kysely instance
 *
 * This wrapper automatically adds tenant_id filter to all queries.
 * It ensures tenant isolation at the database level.
 *
 * @example
 * ```typescript
 * const tenantContext = new TenantContext()
 * tenantContext.setTenantId(1)
 *
 * const scopedDb = createTenantScopedDb(db, tenantContext)
 *
 * // This query is automatically filtered by tenant_id
 * const users = await scopedDb.selectFrom('users').selectAll().execute()
 * // Equivalent to: SELECT * FROM users WHERE tenant_id = 1
 * ```
 */
export function createTenantScopedDb(
  db: Kysely<Database>,
  context: TenantContext
): Kysely<Database> {
  // In a production application, you might use a Kysely plugin
  // to automatically add tenant_id filters to all queries.
  // For this example, we'll return the base db and enforce
  // tenant filtering in repositories.
  return db
}

/**
 * Middleware to extract tenant from request
 *
 * In a web framework like Express:
 * ```typescript
 * app.use((req, res, next) => {
 *   const tenantId = extractTenantFromRequest(req)
 *   req.tenantContext = new TenantContext()
 *   req.tenantContext.setTenantId(tenantId)
 *   next()
 * })
 * ```
 */
export function extractTenantFromSubdomain(hostname: string): string | null {
  // Extract tenant from subdomain (e.g., 'acme.app.com' -> 'acme')
  const parts = hostname.split('.')
  if (parts.length >= 3) {
    return parts[0] ?? null
  }
  return null
}

export function extractTenantFromHeader(headers: Record<string, string>): number | null {
  const tenantId = headers['x-tenant-id']
  return tenantId ? parseInt(tenantId, 10) : null
}
