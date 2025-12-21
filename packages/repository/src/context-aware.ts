import type { Selectable } from 'kysely';
import type { Executor } from './helpers.js';
import { applyOffset, type OffsetOptions } from '@kysera/core';

/**
 * Abstract repository class that supports executor switching for transactions.
 *
 * This enables clean transaction handling without passing executor to every method:
 *
 * @example
 * Basic usage with transaction
 * ```typescript
 * class UserRepository extends ContextAwareRepository<Database, 'users'> {
 *   async create(data: CreateUserInput): Promise<User> {
 *     return this.db
 *       .insertInto(this.tableName)
 *       .values(data)
 *       .returningAll()
 *       .executeTakeFirstOrThrow();
 *   }
 * }
 *
 * const baseUserRepo = new UserRepository(db, 'users');
 *
 * // Use in transaction
 * await db.transaction().execute(async (trx) => {
 *   const userRepo = baseUserRepo.withExecutor(trx);
 *   const postRepo = basePostRepo.withExecutor(trx);
 *
 *   await userRepo.create(userData);
 *   await postRepo.create(postData);
 * });
 * ```
 *
 * @example
 * Multiple repositories in transaction
 * ```typescript
 * await db.transaction().execute(async (trx) => {
 *   const accountRepo = baseAccountRepo.withExecutor(trx);
 *   const walletRepo = baseWalletRepo.withExecutor(trx);
 *   const auditRepo = baseAuditRepo.withExecutor(trx);
 *
 *   const account = await accountRepo.create({ userId });
 *   const wallet = await walletRepo.create({ accountId: account.id });
 *   await auditRepo.log({ action: 'account_created', accountId: account.id });
 * });
 * ```
 *
 * @typeParam DB - The database schema type
 * @typeParam Table - The table name as a string literal
 */
export abstract class ContextAwareRepository<DB, Table extends string> {
  /**
   * Creates a new context-aware repository instance.
   *
   * @param executor - The database executor (Kysely instance or Transaction)
   * @param tableName - The name of the table this repository operates on
   */
  constructor(
    protected executor: Executor<DB>,
    public readonly tableName: Table
  ) {}

  /**
   * Creates a new repository instance with the given executor.
   * Useful for passing transactions to repositories without modifying method signatures.
   *
   * This method creates a shallow copy of the repository instance with only the executor replaced.
   * All other properties and methods remain the same.
   *
   * @param executor - The new executor to use (typically a Transaction)
   * @returns A new instance of the same repository class with the new executor
   *
   * @example
   * Without withExecutor (old pattern)
   * ```typescript
   * class UserRepository {
   *   async create(data: CreateInput, executor?: DbExecutor): Promise<User> {
   *     const db = executor ?? this.db;  // ← Repeated in EVERY method
   *     return db.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow();
   *   }
   * }
   *
   * // Usage in transaction
   * await db.transaction().execute(async (trx) => {
   *   await userRepo.create(userData, trx);  // Pass trx to every call
   *   await postRepo.create(postData, trx);  // Pass trx to every call
   * });
   * ```
   *
   * @example
   * With withExecutor (new pattern)
   * ```typescript
   * class UserRepository extends ContextAwareRepository<Database, 'users'> {
   *   async create(data: CreateInput): Promise<User> {
   *     return this.db  // ← No executor parameter needed!
   *       .insertInto(this.tableName)
   *       .values(data)
   *       .returningAll()
   *       .executeTakeFirstOrThrow();
   *   }
   * }
   *
   * // Usage in transaction
   * await db.transaction().execute(async (trx) => {
   *   const txUserRepo = baseUserRepo.withExecutor(trx);
   *   const txPostRepo = basePostRepo.withExecutor(trx);
   *
   *   await txUserRepo.create(userData);  // Clean API, no executor parameter
   *   await txPostRepo.create(postData);  // Clean API, no executor parameter
   * });
   * ```
   */
  withExecutor(executor: Executor<DB>): this {
    // Create a new instance with the same prototype chain
    const clone = Object.create(Object.getPrototypeOf(this));

    // Copy all properties from the current instance to the clone
    Object.assign(clone, this);

    // Replace only the executor
    clone.executor = executor;

    return clone;
  }

  /**
   * Protected accessor for the database executor.
   * Use this in subclass methods to access the current executor (db or transaction).
   *
   * @returns The current executor (Kysely instance or Transaction)
   *
   * @example
   * ```typescript
   * class UserRepository extends ContextAwareRepository<Database, 'users'> {
   *   async findByEmail(email: string): Promise<User | null> {
   *     return this.db
   *       .selectFrom(this.tableName)
   *       .selectAll()
   *       .where('email', '=', email)
   *       .executeTakeFirst() ?? null;
   *   }
   * }
   * ```
   */
  protected get db(): Executor<DB> {
    return this.executor;
  }

  /**
   * Find a single entity by a field value.
   *
   * This is a convenience method that eliminates boilerplate for common lookup patterns.
   *
   * @param field - The field/column to search by
   * @param value - The value to match
   * @returns The entity if found, null otherwise
   *
   * @example
   * Find user by email:
   * ```typescript
   * class UserRepository extends ContextAwareRepository<Database, 'users'> {
   *   async findByEmail(email: string) {
   *     return this.findOneBy('email', email);
   *   }
   * }
   *
   * const user = await userRepo.findByEmail('alice@example.com');
   * ```
   *
   * @example
   * Find by foreign key:
   * ```typescript
   * const wallet = await this.findOneBy('account_id', accountId);
   * ```
   */
  protected async findOneBy<K extends string>(
    field: K,
    value: unknown
  ): Promise<Selectable<DB[Table & keyof DB]> | null> {
    const result = await (this.db as any)
      .selectFrom(this.tableName)
      .selectAll()
      .where(field, '=', value)
      .executeTakeFirst();

    return result ?? null;
  }

  /**
   * Find multiple entities by a field value with optional pagination.
   *
   * This is a convenience method for common "find all by X" patterns with
   * built-in pagination support.
   *
   * @param field - The field/column to search by
   * @param value - The value to match
   * @param options - Optional pagination and ordering
   * @returns Array of matching entities
   *
   * @example
   * Find all orders by user:
   * ```typescript
   * class OrderRepository extends ContextAwareRepository<Database, 'orders'> {
   *   async findByUserId(userId: string, options?: { limit?: number; offset?: number }) {
   *     return this.findManyBy('user_id', userId, {
   *       ...options,
   *       orderBy: 'created_at',
   *       direction: 'desc'
   *     });
   *   }
   * }
   *
   * const orders = await orderRepo.findByUserId(userId, { limit: 10 });
   * ```
   *
   * @example
   * Find posts by category with pagination:
   * ```typescript
   * const posts = await this.findManyBy('category_id', categoryId, {
   *   limit: 20,
   *   offset: 40,
   *   orderBy: 'published_at',
   *   direction: 'desc'
   * });
   * ```
   */
  protected async findManyBy<K extends string>(
    field: K,
    value: unknown,
    options?: OffsetOptions & { orderBy?: string; direction?: 'asc' | 'desc' }
  ): Promise<Selectable<DB[Table & keyof DB]>[]> {
    let query = (this.db as any)
      .selectFrom(this.tableName)
      .selectAll()
      .where(field, '=', value);

    if (options?.orderBy) {
      query = query.orderBy(options.orderBy, options.direction ?? 'desc');
    }

    if (options?.limit !== undefined || options?.offset !== undefined) {
      query = applyOffset(query, options);
    }

    return query.execute();
  }
}
