import type { Plugin } from '@kysera/repository'
import type { SelectQueryBuilder } from 'kysely'

export interface SoftDeleteOptions {
  /**
   * Column name for soft delete timestamp
   */
  deletedAtColumn?: string

  /**
   * Include deleted records by default
   */
  includeDeleted?: boolean

  /**
   * List of tables that support soft delete.
   * If not provided, all tables are assumed to support it.
   */
  tables?: string[]
}

/**
 * Soft Delete Plugin
 * Automatically filters out soft-deleted records from queries
 */
export const softDeletePlugin = (options: SoftDeleteOptions = {}): Plugin => {
  const {
    deletedAtColumn = 'deleted_at',
    includeDeleted = false,
    tables
  } = options

  return {
    name: '@kysera/soft-delete',
    version: '1.0.0',

    interceptQuery(qb, context) {
      // Check if table supports soft delete
      const supportsSoftDelete = !tables || tables.includes(context.table)

      // Only filter SELECT queries when not explicitly including deleted
      if (
        supportsSoftDelete &&
        context.operation === 'select' &&
        !context.metadata['includeDeleted'] &&
        !includeDeleted
      ) {
        // Add WHERE deleted_at IS NULL to the query builder
        return (qb as SelectQueryBuilder<any, any, any>)
          .where(`${context.table}.${deletedAtColumn}`, 'is', null) as any
      }

      // For DELETE operations, convert to soft delete
      if (
        supportsSoftDelete &&
        context.operation === 'delete' &&
        !context.metadata['hardDelete']
      ) {
        // This requires special handling in repository
        context.metadata['convertToSoftDelete'] = true
      }

      return qb
    },

    extendRepository(repo) {
      // Check if table supports soft delete
      const supportsSoftDelete = !tables || tables.includes(repo.tableName)

      // If table doesn't support soft delete, return unmodified repo
      if (!supportsSoftDelete) {
        return repo
      }

      // Wrap original methods to apply soft delete filtering
      const originalFindAll = repo.findAll.bind(repo)
      const originalFindById = repo.findById.bind(repo)

      return {
        ...repo,

        // Override base methods to filter soft-deleted records
        async findAll(): Promise<any[]> {
          if (!includeDeleted) {
            return repo.executor
              .selectFrom(repo.tableName)
              .selectAll()
              .where(deletedAtColumn, 'is', null)
              .execute()
          }
          return originalFindAll()
        },

        async findById(id: number): Promise<any> {
          if (!includeDeleted) {
            return repo.executor
              .selectFrom(repo.tableName)
              .selectAll()
              .where('id', '=', id)
              .where(deletedAtColumn, 'is', null)
              .executeTakeFirst()
          }
          return originalFindById(id)
        },

        async softDelete(id: number) {
          return repo.update(id, { [deletedAtColumn]: new Date().toISOString() })
        },

        async restore(id: number) {
          return repo.update(id, { [deletedAtColumn]: null })
        },

        async hardDelete(id: number) {
          // Direct hard delete - bypass soft delete
          await repo.executor
            .deleteFrom(repo.tableName)
            .where('id', '=', id)
            .execute()
        },

        async findWithDeleted(id: number) {
          // Use original method without filtering
          return originalFindById(id)
        },

        async findAllWithDeleted() {
          // Use original method without filtering
          return originalFindAll()
        },

        async findDeleted() {
          return repo.executor
            .selectFrom(repo.tableName)
            .selectAll()
            .where(deletedAtColumn, 'is not', null)
            .execute()
        }
      }
    }
  }
}