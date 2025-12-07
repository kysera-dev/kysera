import type { Selectable, Transaction } from 'kysely';
import type { z } from 'zod';
import type { Executor } from './helpers.js';
import type { PrimaryKeyColumn, PrimaryKeyTypeHint, PrimaryKeyInput, PrimaryKeyConfig } from './types.js';
import { normalizePrimaryKeyConfig, getPrimaryKeyColumns } from './types.js';
import { NotFoundError } from '@kysera/core';

/**
 * Core repository interface
 * Designed to work with any entity type and database schema
 * Supports custom primary keys (single, composite, UUID)
 */
export interface BaseRepository<DB, Entity, PK = number> {
  findById(id: PK): Promise<Entity | null>;
  findAll(): Promise<Entity[]>;
  create(input: unknown): Promise<Entity>;
  update(id: PK, input: unknown): Promise<Entity>;
  delete(id: PK): Promise<boolean>;
  findByIds(ids: PK[]): Promise<Entity[]>;
  bulkCreate(inputs: unknown[]): Promise<Entity[]>;
  bulkUpdate(updates: { id: PK; data: unknown }[]): Promise<Entity[]>;
  bulkDelete(ids: PK[]): Promise<number>;
  find(options?: { where?: Record<string, unknown> }): Promise<Entity[]>;
  findOne(options?: { where?: Record<string, unknown> }): Promise<Entity | null>;
  count(options?: { where?: Record<string, unknown> }): Promise<number>;
  exists(options?: { where?: Record<string, unknown> }): Promise<boolean>;
  transaction<R>(fn: (trx: Transaction<DB>) => Promise<R>): Promise<R>;
  paginate(options: {
    limit: number;
    offset?: number;
    orderBy?: string;
    orderDirection?: 'asc' | 'desc';
  }): Promise<{ items: Entity[]; total: number; limit: number; offset: number }>;
  paginateCursor<K extends keyof Entity>(options: {
    limit: number;
    cursor?: {
      value: Entity[K];
      id: PK;
    } | null;
    orderBy?: K;
    orderDirection?: 'asc' | 'desc';
  }): Promise<{
    items: Entity[];
    nextCursor: { value: Entity[K]; id: PK } | null;
    hasMore: boolean;
  }>;
}

/**
 * Configuration for creating a repository
 */
export interface RepositoryConfig<Table, Entity> {
  tableName: string;
  /** Primary key column name(s). Default: 'id' */
  primaryKey?: PrimaryKeyColumn;
  /** Primary key type hint. Default: 'number' */
  primaryKeyType?: PrimaryKeyTypeHint;
  mapRow: (row: Selectable<Table>) => Entity;
  schemas: {
    entity?: z.ZodType<Entity>;
    create: z.ZodType;
    update?: z.ZodType;
  };
  validateDbResults?: boolean;
  validationStrategy?: 'none' | 'strict';
}

/**
 * Type-safe table operations interface
 * These methods must be provided by the specific table implementation
 */
export interface TableOperations<Table> {
  selectAll(): Promise<Selectable<Table>[]>;
  selectById(id: PrimaryKeyInput): Promise<Selectable<Table> | undefined>;
  selectByIds(ids: PrimaryKeyInput[]): Promise<Selectable<Table>[]>;
  selectWhere(conditions: Record<string, unknown>): Promise<Selectable<Table>[]>;
  selectOneWhere(conditions: Record<string, unknown>): Promise<Selectable<Table> | undefined>;
  insert(data: unknown): Promise<Selectable<Table>>;
  insertMany(data: unknown[]): Promise<Selectable<Table>[]>;
  updateById(id: PrimaryKeyInput, data: unknown): Promise<Selectable<Table> | undefined>;
  deleteById(id: PrimaryKeyInput): Promise<boolean>;
  deleteByIds(ids: PrimaryKeyInput[]): Promise<number>;
  count(conditions?: Record<string, unknown>): Promise<number>;
  paginate(options: {
    limit: number;
    offset: number;
    orderBy: string;
    orderDirection: 'asc' | 'desc';
  }): Promise<Selectable<Table>[]>;
  paginateCursor(options: {
    limit: number;
    cursor?: {
      value: unknown;
      id: PrimaryKeyInput;
    } | null;
    orderBy: string;
    orderDirection: 'asc' | 'desc';
  }): Promise<Selectable<Table>[]>;
}

/**
 * Extract primary key value from an entity based on config
 */
function extractPrimaryKey<Entity, PK>(
  entity: Entity,
  pkConfig: PrimaryKeyConfig
): PK {
  const columns = getPrimaryKeyColumns(pkConfig.columns);
  
  if (columns.length === 1) {
    const column = columns[0]!;
    return (entity as any)[column] as PK;
  }

  // For composite keys, return an object
  const result: Record<string, unknown> = {};
  for (const column of columns) {
    result[column] = (entity as any)[column];
  }
  return result as PK;
}

/**
 * Create a base repository implementation
 * This function creates a repository with full CRUD operations
 */
export function createBaseRepository<DB, Table, Entity, PK = number>(
  operations: TableOperations<Table>,
  config: RepositoryConfig<Table, Entity>,
  db: Executor<DB>
): BaseRepository<DB, Entity, PK> {
  const {
    mapRow,
    schemas,
    primaryKey,
    primaryKeyType,
    validateDbResults = (typeof process !== 'undefined' && process.env && process.env['NODE_ENV'] === 'development') ||
      false,
    validationStrategy = 'strict',
  } = config;

  const pkConfig = normalizePrimaryKeyConfig(primaryKey, primaryKeyType);
  const defaultOrderColumn = getPrimaryKeyColumns(pkConfig.columns)[0] ?? 'id';

  // Helper to validate and map rows
  const processRow = (row: Selectable<Table>): Entity => {
    const entity = mapRow(row);
    return validateDbResults && schemas.entity ? schemas.entity.parse(entity) : entity;
  };

  // Helper to validate and map multiple rows
  const processRows = (rows: Selectable<Table>[]): Entity[] => {
    const entities = rows.map(mapRow);
    return validateDbResults && schemas.entity ? entities.map((e) => schemas.entity!.parse(e)) : entities;
  };

  // Helper to validate input
  const validateInput = (input: unknown, schema: z.ZodType): unknown => {
    return validationStrategy === 'none' ? input : schema.parse(input);
  };

  // Get the appropriate update schema
  const getUpdateSchema = (): z.ZodType => {
    if (schemas.update) return schemas.update;

    // Try to create a partial schema from create schema if it's a ZodObject
    const createSchema = schemas.create;
    if ('partial' in createSchema && typeof createSchema.partial === 'function') {
      return createSchema.partial();
    }

    return schemas.create;
  };

  // Convert PK type to PrimaryKeyInput for table operations
  const toPrimaryKeyInput = (pk: PK): PrimaryKeyInput => {
    return pk as unknown as PrimaryKeyInput;
  };

  return {
    async findById(id: PK): Promise<Entity | null> {
      const row = await operations.selectById(toPrimaryKeyInput(id));
      return row ? processRow(row) : null;
    },

    async findAll(): Promise<Entity[]> {
      const rows = await operations.selectAll();
      return processRows(rows);
    },

    async create(input: unknown): Promise<Entity> {
      const validatedInput = validateInput(input, schemas.create);
      const row = await operations.insert(validatedInput);
      return processRow(row);
    },

    async update(id: PK, input: unknown): Promise<Entity> {
      const updateSchema = getUpdateSchema();
      const validatedInput = validateInput(input, updateSchema);
      const row = await operations.updateById(toPrimaryKeyInput(id), validatedInput);

      if (!row) {
        throw new NotFoundError('Record', { id });
      }

      return processRow(row);
    },

    async delete(id: PK): Promise<boolean> {
      return operations.deleteById(toPrimaryKeyInput(id));
    },

    async findByIds(ids: PK[]): Promise<Entity[]> {
      if (ids.length === 0) return [];
      const rows = await operations.selectByIds(ids.map(toPrimaryKeyInput));
      return processRows(rows);
    },

    async bulkCreate(inputs: unknown[]): Promise<Entity[]> {
      if (inputs.length === 0) return [];
      const validatedInputs = inputs.map((input) => validateInput(input, schemas.create));
      const rows = await operations.insertMany(validatedInputs);
      return processRows(rows);
    },

    async bulkUpdate(updates: { id: PK; data: unknown }[]): Promise<Entity[]> {
      if (updates.length === 0) return [];

      const updateSchema = getUpdateSchema();

      // Execute updates in parallel for better performance
      // Note: If transaction atomicity is required, wrap the bulkUpdate call
      // in a transaction at the application level
      const promises = updates.map(async ({ id, data }) => {
        const validatedInput = validateInput(data, updateSchema);
        const row = await operations.updateById(toPrimaryKeyInput(id), validatedInput);

        if (!row) {
          throw new NotFoundError('Record', { id });
        }

        return processRow(row);
      });

      return Promise.all(promises);
    },

    async bulkDelete(ids: PK[]): Promise<number> {
      if (ids.length === 0) return 0;
      return operations.deleteByIds(ids.map(toPrimaryKeyInput));
    },

    async find(options?: { where?: Record<string, unknown> }): Promise<Entity[]> {
      const rows = options?.where ? await operations.selectWhere(options.where) : await operations.selectAll();
      return processRows(rows);
    },

    async findOne(options?: { where?: Record<string, unknown> }): Promise<Entity | null> {
      if (!options?.where) {
        const rows = await operations.selectAll();
        return rows[0] ? processRow(rows[0]) : null;
      }

      const row = await operations.selectOneWhere(options.where);
      return row ? processRow(row) : null;
    },

    async count(options?: { where?: Record<string, unknown> }): Promise<number> {
      return operations.count(options?.where);
    },

    async exists(options?: { where?: Record<string, unknown> }): Promise<boolean> {
      const count = await operations.count(options?.where);
      return count > 0;
    },

    async transaction<R>(fn: (trx: Transaction<DB>) => Promise<R>): Promise<R> {
      return db.transaction().execute(fn);
    },

    async paginate(options: {
      limit: number;
      offset?: number;
      orderBy?: string;
      orderDirection?: 'asc' | 'desc';
    }): Promise<{ items: Entity[]; total: number; limit: number; offset: number }> {
      const { limit, offset = 0, orderBy = defaultOrderColumn, orderDirection = 'asc' } = options;

      const total = await operations.count();
      const rows = await operations.paginate({
        limit,
        offset,
        orderBy,
        orderDirection,
      });

      const items = processRows(rows);

      return {
        items,
        total,
        limit,
        offset,
      };
    },

    async paginateCursor<K extends keyof Entity>(options: {
      limit: number;
      cursor?: {
        value: Entity[K];
        id: PK;
      } | null;
      orderBy?: K;
      orderDirection?: 'asc' | 'desc';
    }): Promise<{
      items: Entity[];
      nextCursor: { value: Entity[K]; id: PK } | null;
      hasMore: boolean;
    }> {
      const { limit, cursor, orderBy = defaultOrderColumn as K, orderDirection = 'asc' } = options;

      // Fetch limit + 1 to determine if there are more results
      const rows = await operations.paginateCursor({
        limit: limit + 1,
        cursor: cursor
          ? {
              value: cursor.value,
              id: toPrimaryKeyInput(cursor.id),
            }
          : null,
        orderBy: String(orderBy),
        orderDirection,
      });

      const hasMore = rows.length > limit;
      const items = processRows(hasMore ? rows.slice(0, limit) : rows);

      // Generate nextCursor from the last item
      let nextCursor: { value: Entity[K]; id: PK } | null = null;
      if (hasMore && items.length > 0) {
        const lastItem = items[items.length - 1];
        if (lastItem) {
          nextCursor = {
            value: lastItem[orderBy],
            id: extractPrimaryKey<Entity, PK>(lastItem, pkConfig),
          };
        }
      }

      return {
        items,
        nextCursor,
        hasMore,
      };
    },
  };
}
