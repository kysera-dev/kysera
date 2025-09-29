import type { Generated, Selectable as KyselySelectable } from 'kysely'

/**
 * Repository-specific type utilities
 */

/**
 * Remove Generated<> wrapper from types
 */
export type Unwrap<T> = T extends Generated<infer U> ? U : T

/**
 * Convert table type to domain type (removes Generated<>)
 */
export type DomainType<Table> = {
  [K in keyof Table]: Unwrap<Table[K]>
}

/**
 * Extract selectable fields from table
 */
export type EntityType<Table> = KyselySelectable<Table>

/**
 * Create input type (omit generated fields)
 */
export type CreateInput<Table> = {
  [K in keyof Table as Table[K] extends Generated<any> ? never : K]: Table[K]
}

/**
 * Update input type (all fields optional)
 */
export type UpdateInput<Table> = Partial<CreateInput<Table>>

/**
 * Repository config
 */
export interface RepositoryConfig<Table, Entity> {
  tableName: string
  mapRow: (row: EntityType<Table>) => Entity
  validateDbResults?: boolean
}