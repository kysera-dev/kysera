/**
 * Test data factory utilities.
 *
 * @module @kysera/testing
 */

/**
 * Factory function type.
 */
export type FactoryFunction<T> = (overrides?: Partial<T>) => T;

/**
 * Factory definition - values or functions that return values.
 */
export type FactoryDefaults<T extends Record<string, unknown>> = {
  [K in keyof T]: T[K] | (() => T[K]);
};

/**
 * Create a generic test data factory.
 *
 * Factories allow you to create test data with sensible defaults
 * while still being able to override specific fields.
 *
 * @param defaults - Default values (can be values or functions)
 * @returns Factory function that creates test data
 *
 * @example Basic factory
 * ```typescript
 * import { createFactory } from '@kysera/testing';
 *
 * const createUser = createFactory({
 *   email: () => `user-${Date.now()}@example.com`,
 *   name: 'Test User',
 *   role: 'user',
 * });
 *
 * // Create with defaults
 * const user1 = createUser();
 * // { email: 'user-1234567890@example.com', name: 'Test User', role: 'user' }
 *
 * // Create with overrides
 * const admin = createUser({ role: 'admin', name: 'Admin User' });
 * // { email: 'user-1234567891@example.com', name: 'Admin User', role: 'admin' }
 * ```
 *
 * @example With sequential IDs
 * ```typescript
 * let userId = 0;
 * const createUser = createFactory({
 *   id: () => ++userId,
 *   email: () => `user-${userId}@example.com`,
 *   name: 'Test User',
 * });
 *
 * const user1 = createUser(); // { id: 1, email: 'user-1@example.com', name: 'Test User' }
 * const user2 = createUser(); // { id: 2, email: 'user-2@example.com', name: 'Test User' }
 * ```
 */
export function createFactory<T extends Record<string, unknown>>(
  defaults: FactoryDefaults<T>
): FactoryFunction<T> {
  return (overrides = {}) => {
    const result = {} as T;

    // Apply defaults
    for (const [key, value] of Object.entries(defaults)) {
      // Value can be either a function or a direct value - function invocation requires any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- Factory function invocation
      result[key as keyof T] = typeof value === 'function' ? (value as () => any)() : value;
    }

    // Apply overrides
    for (const [key, value] of Object.entries(overrides)) {
      result[key as keyof T] = value as T[keyof T];
    }

    return result;
  };
}

/**
 * Create multiple instances using a factory.
 *
 * @param factory - Factory function
 * @param count - Number of instances to create
 * @param overridesFn - Optional function to generate overrides for each instance
 * @returns Array of created instances
 *
 * @example
 * ```typescript
 * import { createFactory, createMany } from '@kysera/testing';
 *
 * const createUser = createFactory({
 *   email: () => `user-${Date.now()}@example.com`,
 *   name: 'Test User',
 * });
 *
 * // Create 5 users with defaults
 * const users = createMany(createUser, 5);
 *
 * // Create 3 users with custom overrides
 * const admins = createMany(createUser, 3, (i) => ({
 *   name: `Admin ${i + 1}`,
 *   role: 'admin',
 * }));
 * ```
 */
export function createMany<T>(
  factory: FactoryFunction<T>,
  count: number,
  overridesFn?: (index: number) => Partial<T>
): T[] {
  return Array.from({ length: count }, (_, index) =>
    factory(overridesFn?.(index))
  );
}

/**
 * Create a factory with a sequence counter.
 *
 * Provides a built-in sequence number that increments with each call.
 *
 * @param defaults - Function that receives sequence number and returns defaults
 * @returns Factory function with sequence support
 *
 * @example
 * ```typescript
 * import { createSequenceFactory } from '@kysera/testing';
 *
 * const createUser = createSequenceFactory((seq) => ({
 *   id: seq,
 *   email: `user-${seq}@example.com`,
 *   name: `User ${seq}`,
 * }));
 *
 * const user1 = createUser(); // { id: 1, email: 'user-1@example.com', name: 'User 1' }
 * const user2 = createUser(); // { id: 2, email: 'user-2@example.com', name: 'User 2' }
 * ```
 */
export function createSequenceFactory<T extends Record<string, unknown>>(
  defaults: (sequence: number) => FactoryDefaults<T>
): FactoryFunction<T> {
  let sequence = 0;

  return (overrides = {}) => {
    sequence++;
    const currentDefaults = defaults(sequence);
    const result = {} as T;

    // Apply defaults
    for (const [key, value] of Object.entries(currentDefaults)) {
      // Value can be either a function or a direct value - function invocation requires any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- Factory function invocation
      result[key as keyof T] = typeof value === 'function' ? (value as () => any)() : value;
    }

    // Apply overrides
    for (const [key, value] of Object.entries(overrides)) {
      result[key as keyof T] = value as T[keyof T];
    }

    return result;
  };
}
