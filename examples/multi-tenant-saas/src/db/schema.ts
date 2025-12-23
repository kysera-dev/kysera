import type { Generated } from 'kysely'

/**
 * Multi-tenant SaaS Database Schema
 *
 * This schema demonstrates tenant isolation using a discriminator column (tenant_id).
 * All tenant-scoped tables include tenant_id for row-level security.
 */

export interface Database {
  // Tenants (organizations)
  tenants: {
    id: Generated<number>
    name: string
    slug: string // unique identifier (e.g., 'acme-corp')
    plan: 'free' | 'pro' | 'enterprise'
    max_users: number
    created_at: Generated<Date>
    updated_at: Generated<Date>
  }

  // Users (scoped to tenant)
  users: {
    id: Generated<number>
    tenant_id: number // FK to tenants.id
    email: string
    name: string
    role: 'owner' | 'admin' | 'member'
    created_at: Generated<Date>
    updated_at: Generated<Date>
  }

  // Projects (scoped to tenant)
  projects: {
    id: Generated<number>
    tenant_id: number // FK to tenants.id
    name: string
    description: string | null
    status: 'active' | 'archived'
    created_at: Generated<Date>
    updated_at: Generated<Date>
  }

  // Tasks (scoped to tenant)
  tasks: {
    id: Generated<number>
    tenant_id: number // FK to tenants.id
    project_id: number // FK to projects.id
    title: string
    description: string | null
    status: 'todo' | 'in_progress' | 'done'
    assigned_to: number | null // FK to users.id
    created_at: Generated<Date>
    updated_at: Generated<Date>
  }

  // Audit log (scoped to tenant)
  audit_logs: {
    id: Generated<number>
    tenant_id: number // FK to tenants.id
    table_name: string
    entity_id: string
    operation: 'INSERT' | 'UPDATE' | 'DELETE'
    old_values: string | null
    new_values: string | null
    user_id: number | null
    created_at: Generated<Date>
  }

  // Migrations tracking (internal)
  migrations: {
    name: string
    executed_at: Generated<Date>
  }
}

export type Tenant = Database['tenants']
export type TenantUser = Database['users']
export type Project = Database['projects']
export type Task = Database['tasks']
