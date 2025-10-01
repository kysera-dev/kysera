import type { Plugin, AnyQueryBuilder } from '@kysera/repository'
import type { SelectQueryBuilder, Kysely } from 'kysely'

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

interface BaseRepository {
  tableName: string
  executor: Kysely<Record<string, unknown>>
  findAll: () => Promise<unknown[]>
  findById: (id: number) => Promise<unknown>
  update: (id: number, data: Record<string, unknown>) => Promise<unknown>
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

    interceptQuery<QB extends AnyQueryBuilder>(qb: QB, context: { operation: string; table: string; metadata: Record<string, unknown> }): QB {
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
        type GenericSelectQueryBuilder = SelectQueryBuilder<
          Record<string, unknown>,
          string,
          Record<string, unknown>
        >
        return (qb as unknown as GenericSelectQueryBuilder)
          .where(`${context.table}.${deletedAtColumn}` as never, 'is', null) as QB
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

    extendRepository<T extends object>(repo: T): T {
      // Type assertion is safe here as we're checking for BaseRepository properties
      const baseRepo = repo as unknown as BaseRepository

      // Check if it's actually a repository (has required properties)
      if (!('tableName' in baseRepo) || !('executor' in baseRepo)) {
        return repo
      }

      // Check if table supports soft delete
      const supportsSoftDelete = !tables || tables.includes(baseRepo.tableName)

      // If table doesn't support soft delete, return unmodified repo
      if (!supportsSoftDelete) {
        return repo
      }

      // Wrap original methods to apply soft delete filtering
      const originalFindAll = baseRepo.findAll.bind(baseRepo)
      const originalFindById = baseRepo.findById.bind(baseRepo)

      const extendedRepo = {
        ...baseRepo,

        // Override base methods to filter soft-deleted records
        async findAll(): Promise<unknown[]> {
          if (!includeDeleted) {
            const result = await baseRepo.executor
              .selectFrom(baseRepo.tableName)
              .selectAll()
              .where(deletedAtColumn as never, 'is', null)
              .execute()
            return result as unknown[]
          }
          return await originalFindAll()
        },

        async findById(id: number): Promise<unknown> {
          if (!includeDeleted) {
            const result = await baseRepo.executor
              .selectFrom(baseRepo.tableName)
              .selectAll()
              .where('id' as never, '=', id as never)
              .where(deletedAtColumn as never, 'is', null)
              .executeTakeFirst()
            return result ?? null
          }
          return await originalFindById(id)
        },

        async softDelete(id: number): Promise<unknown> {
          return await baseRepo.update(id, { [deletedAtColumn]: new Date().toISOString() })
        },

        async restore(id: number): Promise<unknown> {
          return await baseRepo.update(id, { [deletedAtColumn]: null })
        },

        async hardDelete(id: number): Promise<void> {
          // Direct hard delete - bypass soft delete
          await baseRepo.executor
            .deleteFrom(baseRepo.tableName)
            .where('id' as never, '=', id as never)
            .execute()
        },

        async findWithDeleted(id: number): Promise<unknown> {
          // Use original method without filtering
          return await originalFindById(id)
        },

        async findAllWithDeleted(): Promise<unknown[]> {
          // Use original method without filtering
          return await originalFindAll()
        },

        async findDeleted(): Promise<unknown[]> {
          const result = await baseRepo.executor
            .selectFrom(baseRepo.tableName)
            .selectAll()
            .where(deletedAtColumn as never, 'is not', null)
            .execute()
          return result as unknown[]
        }
      }

      return extendedRepo as T
    }
  }
}