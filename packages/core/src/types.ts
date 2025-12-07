import type { Kysely, Transaction } from 'kysely';

/**
 * Executor type for both db and transactions
 */
export type Executor<DB> = Kysely<DB> | Transaction<DB>;

/**
 * Common database column types
 */
export interface Timestamps {
  created_at: Date;
  updated_at?: Date;
}

export interface SoftDelete {
  deleted_at: Date | null;
}

export interface AuditFields {
  created_by?: number;
  updated_by?: number;
}

/**
 * Utility type to extract selectable type from table
 */
export type Selectable<T> = {
  [K in keyof T]: T[K] extends { __select__: infer S } ? S : T[K];
};

/**
 * Utility type to extract insertable type from table
 */
export type Insertable<T> = {
  [K in keyof T]: T[K] extends { __insert__: infer I } ? I : T[K];
};

/**
 * Utility type to extract updateable type from table
 */
export type Updateable<T> = {
  [K in keyof T]: T[K] extends { __update__: infer U } ? U : T[K];
};
