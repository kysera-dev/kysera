import type { Selectable, Transaction } from 'kysely';
import type { z } from 'zod';
import { createBaseRepository, type BaseRepository, type RepositoryConfig } from './base-repository.js';
import { createTableOperations } from './table-operations.js';
import type { Executor } from './helpers.js';
import type { PrimaryKeyColumn, PrimaryKeyTypeHint } from './types.js';
import { normalizePrimaryKeyConfig } from './types.js';

/**
 * Extended repository interface that includes database and table information
 * for plugin compatibility
 */
export interface Repository<Entity, DB, PK = number> extends BaseRepository<DB, Entity, PK> {
  readonly executor: Executor<DB>;
  readonly tableName: string;
  withTransaction(trx: Transaction<DB>): Repository<Entity, DB, PK>;
}

/**
 * Create a repository factory with proper type safety
 */
export function createRepositoryFactory<DB>(executor: Executor<DB>): {
  executor: Executor<DB>;
  create<TableName extends keyof DB & string, Entity, PK = number>(config: {
    tableName: TableName;
    /** Primary key column name(s). Default: 'id' */
    primaryKey?: PrimaryKeyColumn;
    /** Primary key type hint. Default: 'number' */
    primaryKeyType?: PrimaryKeyTypeHint;
    mapRow: (row: Selectable<DB[TableName]>) => Entity;
    schemas: {
      entity?: z.ZodType<Entity>;
      create: z.ZodType;
      update?: z.ZodType;
    };
    validateDbResults?: boolean;
    validationStrategy?: 'none' | 'strict';
  }): Repository<Entity, DB, PK>;
} {
  return {
    executor,

    create<TableName extends keyof DB & string, Entity, PK = number>(config: {
      tableName: TableName;
      primaryKey?: PrimaryKeyColumn;
      primaryKeyType?: PrimaryKeyTypeHint;
      mapRow: (row: Selectable<DB[TableName]>) => Entity;
      schemas: {
        entity?: z.ZodType<Entity>;
        create: z.ZodType;
        update?: z.ZodType;
      };
      validateDbResults?: boolean;
      validationStrategy?: 'none' | 'strict';
    }): Repository<Entity, DB, PK> {
      const { tableName, primaryKey, primaryKeyType } = config;
      
      const pkConfig = normalizePrimaryKeyConfig(primaryKey, primaryKeyType);

      // Create table operations for this specific table
      const operations = createTableOperations(executor, tableName, pkConfig);

      // Create base repository
      const baseRepo = createBaseRepository<DB, DB[TableName], Entity, PK>(
        operations,
        config as RepositoryConfig<DB[TableName], Entity>,
        executor
      );

      // Extend with additional properties and methods
      const repository: Repository<Entity, DB, PK> = {
        ...baseRepo,
        executor,
        tableName,

        withTransaction(trx: Transaction<DB>): Repository<Entity, DB, PK> {
          const factory = createRepositoryFactory(trx);
          return factory.create<TableName, Entity, PK>(config);
        },
      };

      return repository;
    },
  };
}

/**
 * Simple repository without factory (for plugins)
 */
export function createSimpleRepository<DB, TableName extends keyof DB & string, Entity, PK = number>(
  executor: Executor<DB>,
  tableName: TableName,
  mapRow: (row: Selectable<DB[TableName]>) => Entity,
  options?: {
    primaryKey?: PrimaryKeyColumn;
    primaryKeyType?: PrimaryKeyTypeHint;
  }
): Repository<Entity, DB, PK> {
  const factory = createRepositoryFactory(executor);

  // Build config object, only including primaryKey/primaryKeyType if defined
  const config: Parameters<typeof factory.create<TableName, Entity, PK>>[0] = {
    tableName,
    mapRow,
    schemas: {
      create: { parse: (v: unknown) => v } as z.ZodType,
      update: { parse: (v: unknown) => v } as z.ZodType,
    },
    validateDbResults: false,
  };

  // Only add primaryKey if defined
  if (options?.primaryKey !== undefined) {
    config.primaryKey = options.primaryKey;
  }
  
  // Only add primaryKeyType if defined
  if (options?.primaryKeyType !== undefined) {
    config.primaryKeyType = options.primaryKeyType;
  }

  return factory.create<TableName, Entity, PK>(config);
}
