/* eslint-disable @typescript-eslint/no-deprecated -- DialectConfig kept for backwards compatibility */
import type { Selectable, Transaction } from 'kysely'
import {
  createBaseRepository,
  type BaseRepository,
  type RepositoryConfig
} from './base-repository.js'
import { createTableOperations } from './table-operations.js'
import type { Executor } from './helpers.js'
import type { PrimaryKeyColumn, PrimaryKeyTypeHint, DialectConfig, Dialect } from './types.js'
import { normalizePrimaryKeyConfig } from './types.js'
import { nativeAdapter, type ValidationSchema } from './validation-adapter.js'

/**
 * Extended repository interface that includes database and table information
 * for plugin compatibility
 */
export interface Repository<Entity, DB, PK = number> extends BaseRepository<DB, Entity, PK> {
  readonly executor: Executor<DB>
  readonly tableName: string
  withTransaction(trx: Transaction<DB>): Repository<Entity, DB, PK>
}

/**
 * Create a repository factory with proper type safety.
 * Supports any ValidationSchema-compatible validator (Zod, Valibot, TypeBox, etc.)
 *
 * @example With Zod adapter
 * ```typescript
 * import { z } from 'zod';
 * import { createRepositoryFactory, zodAdapter } from '@kysera/repository';
 *
 * const factory = createRepositoryFactory(db);
 * const userRepo = factory.create({
 *   tableName: 'users',
 *   mapRow: (row) => row,
 *   schemas: {
 *     create: zodAdapter(z.object({ name: z.string(), email: z.string() })),
 *   },
 * });
 * ```
 *
 * @example With native adapter (no validation)
 * ```typescript
 * import { createRepositoryFactory, nativeAdapter } from '@kysera/repository';
 *
 * const factory = createRepositoryFactory(db);
 * const userRepo = factory.create({
 *   tableName: 'users',
 *   mapRow: (row) => row,
 *   schemas: {
 *     create: nativeAdapter<CreateUserInput>(),
 *   },
 * });
 * ```
 */
export function createRepositoryFactory<DB>(executor: Executor<DB>): {
  executor: Executor<DB>
  create<TableName extends keyof DB & string, Entity, PK = number>(config: {
    tableName: TableName
    /**
     * PostgreSQL schema for this repository.
     * When set, all queries are scoped to this schema.
     * @example 'auth', 'admin', 'tenant_123'
     */
    schema?: string
    /** Primary key column name(s). Default: 'id' */
    primaryKey?: PrimaryKeyColumn
    /** Primary key type hint. Default: 'number' */
    primaryKeyType?: PrimaryKeyTypeHint
    /**
     * Database dialect configuration.
     * Recommended for production to avoid relying on Kysely internals.
     */
    dialect?: DialectConfig
    mapRow: (row: Selectable<DB[TableName]>) => Entity
    schemas: {
      entity?: ValidationSchema<Entity>
      create: ValidationSchema
      update?: ValidationSchema
    }
    validateDbResults?: boolean
    validationStrategy?: 'none' | 'strict'
  }): Repository<Entity, DB, PK>
} {
  return {
    executor,

    create<TableName extends keyof DB & string, Entity, PK = number>(config: {
      tableName: TableName
      /** PostgreSQL schema for this repository */
      schema?: string
      primaryKey?: PrimaryKeyColumn
      primaryKeyType?: PrimaryKeyTypeHint
      dialect?: DialectConfig
      mapRow: (row: Selectable<DB[TableName]>) => Entity
      schemas: {
        entity?: ValidationSchema<Entity>
        create: ValidationSchema
        update?: ValidationSchema
      }
      validateDbResults?: boolean
      validationStrategy?: 'none' | 'strict'
    }): Repository<Entity, DB, PK> {
      const { tableName, primaryKey, primaryKeyType, dialect, schema } = config

      const pkConfig = normalizePrimaryKeyConfig(primaryKey, primaryKeyType)

      // Create table operations for this specific table
      // Pass schema and dialect options - use conditional to satisfy exactOptionalPropertyTypes
      const tableOpsOptions: Parameters<typeof createTableOperations>[3] = (() => {
        const opts: { dialect?: Dialect; schema?: string } = {}
        if (dialect?.dialect) opts.dialect = dialect.dialect
        if (schema) opts.schema = schema
        return Object.keys(opts).length > 0 ? opts : undefined
      })()
      const operations = createTableOperations(executor, tableName, pkConfig, tableOpsOptions)

      // Create base repository
      const baseRepo = createBaseRepository<DB, DB[TableName], Entity, PK>(
        operations,
        config as RepositoryConfig<DB[TableName], Entity>,
        executor
      )

      // Extend with additional properties and methods
      const repository: Repository<Entity, DB, PK> = {
        ...baseRepo,
        executor,
        tableName,

        withTransaction(trx: Transaction<DB>): Repository<Entity, DB, PK> {
          const factory = createRepositoryFactory(trx)
          return factory.create<TableName, Entity, PK>(config)
        }
      }

      return repository
    }
  }
}

/**
 * Simple repository without factory (for plugins).
 * Uses nativeAdapter (no validation) by default.
 */
export function createSimpleRepository<
  DB,
  TableName extends keyof DB & string,
  Entity,
  PK = number
>(
  executor: Executor<DB>,
  tableName: TableName,
  mapRow: (row: Selectable<DB[TableName]>) => Entity,
  options?: {
    primaryKey?: PrimaryKeyColumn
    primaryKeyType?: PrimaryKeyTypeHint
    dialect?: DialectConfig
  }
): Repository<Entity, DB, PK> {
  const factory = createRepositoryFactory(executor)

  // Build config object, only including primaryKey/primaryKeyType/dialect if defined
  const config: Parameters<typeof factory.create<TableName, Entity, PK>>[0] = {
    tableName,
    mapRow,
    schemas: {
      create: nativeAdapter(),
      update: nativeAdapter()
    },
    validateDbResults: false
  }

  // Only add primaryKey if defined
  if (options?.primaryKey !== undefined) {
    config.primaryKey = options.primaryKey
  }

  // Only add primaryKeyType if defined
  if (options?.primaryKeyType !== undefined) {
    config.primaryKeyType = options.primaryKeyType
  }

  // Only add dialect if defined
  if (options?.dialect !== undefined) {
    config.dialect = options.dialect
  }

  return factory.create<TableName, Entity, PK>(config)
}
