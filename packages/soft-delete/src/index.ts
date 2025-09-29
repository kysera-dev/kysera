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
}

/**
 * Soft Delete Plugin
 * Automatically filters out soft-deleted records from queries
 */
export const softDeletePlugin = (options: SoftDeleteOptions = {}): Plugin => {
  const {
    deletedAtColumn = 'deleted_at',
    includeDeleted = false
  } = options

  return {
    name: '@kysera/soft-delete',
    version: '1.0.0',

    interceptQuery(qb, context) {
      // Only filter SELECT queries when not explicitly including deleted
      if (
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
        context.operation === 'delete' &&
        !context.metadata['hardDelete']
      ) {
        // This requires special handling in repository
        context.metadata['convertToSoftDelete'] = true
      }

      return qb
    },

    extendRepository(repo) {
      return {
        ...repo,

        async softDelete(id: number) {
          return repo.update(id, { [deletedAtColumn]: new Date() })
        },

        async restore(id: number) {
          return repo.update(id, { [deletedAtColumn]: null })
        },

        async hardDelete(id: number) {
          // Use metadata to bypass soft delete conversion
          return repo.delete(id, { hardDelete: true })
        },

        async findWithDeleted(id: number) {
          // Query with metadata to include deleted records
          return repo.findById(id, { includeDeleted: true })
        },

        async findAllWithDeleted() {
          // Query with metadata to include deleted records
          return repo.findAll({ includeDeleted: true })
        },

        async findDeleted() {
          return repo.executor
            .selectFrom(repo.tableName)
            .selectAll()
            .where(`${deletedAtColumn}`, 'is not', null)
            .execute()
        }
      }
    }
  }
}