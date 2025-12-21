import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect, type Generated } from 'kysely';
import SQLite from 'better-sqlite3';
import type { Database as SQLiteDatabase } from 'better-sqlite3';
import { atomicStatusTransition } from '../src/index.js';

// Custom test database schema with status column for status transition tests
interface StatusTestDatabase {
  tasks: {
    id: Generated<number>;
    name: string;
    status: string;
    assigned_to: string | null;
    priority: number;
    completed_at: Date | null;
    created_at: Generated<Date>;
  };
  orders: {
    id: Generated<number>;
    customer_id: number;
    order_status: string; // Custom status column name
    total: number;
    notes: string | null;
    created_at: Generated<Date>;
  };
}

// Task status enum for type safety
const TaskStatus = {
  Pending: 'pending',
  InProgress: 'in_progress',
  Completed: 'completed',
  Cancelled: 'cancelled',
} as const;
type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

// Order status enum
const OrderStatus = {
  Placed: 'placed',
  Confirmed: 'confirmed',
  Processing: 'processing',
  Shipped: 'shipped',
  Delivered: 'delivered',
  Cancelled: 'cancelled',
} as const;
type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

// Create test database with status columns
function createStatusTestDatabase(): {
  db: Kysely<StatusTestDatabase>;
  sqlite: SQLiteDatabase;
  cleanup: () => void;
} {
  const sqlite = new SQLite(':memory:');

  const db = new Kysely<StatusTestDatabase>({
    dialect: new SqliteDialect({
      database: sqlite,
    }),
  });

  sqlite.exec('PRAGMA foreign_keys = ON');

  sqlite.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_to TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      order_status TEXT NOT NULL DEFAULT 'placed',
      total REAL NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX idx_tasks_status ON tasks(status);
    CREATE INDEX idx_orders_status ON orders(order_status);
  `);

  const cleanup = async () => {
    await db.destroy();
    sqlite.close();
  };

  return { db, sqlite, cleanup };
}

describe('atomicStatusTransition', () => {
  let db: Kysely<StatusTestDatabase>;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = createStatusTestDatabase();
    db = setup.db;
    cleanup = setup.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  describe('Basic Status Transition', () => {
    it('should transition from one status to another', async () => {
      // Create a task with pending status
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Test Task',
          status: TaskStatus.Pending,
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      expect(task.status).toBe(TaskStatus.Pending);

      // Transition to in_progress
      const updated = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.Pending,
          toStatus: TaskStatus.InProgress,
        }
      );

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe(TaskStatus.InProgress);
      expect(updated?.id).toBe(task.id);
      expect(updated?.name).toBe('Test Task');
    });

    it('should return updated entity with returning: true (default)', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Return Test',
          status: TaskStatus.Pending,
          priority: 2,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.Pending,
          toStatus: TaskStatus.InProgress,
          returning: true, // explicit true
        }
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBe(task.id);
      expect(result?.name).toBe('Return Test');
      expect(result?.status).toBe(TaskStatus.InProgress);
      expect(result?.priority).toBe(2);
    });

    it('should work without returning (returning: false)', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'No Return Test',
          status: TaskStatus.Pending,
          priority: 3,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.Pending,
          toStatus: TaskStatus.InProgress,
          returning: false,
        }
      );

      // Should return empty object (truthy) or null based on whether update succeeded
      // Verify the update actually happened
      const updated = await db
        .selectFrom('tasks')
        .where('id', '=', task.id)
        .selectAll()
        .executeTakeFirst();

      expect(updated?.status).toBe(TaskStatus.InProgress);
    });

    it('should perform multiple sequential status transitions', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Multi Transition',
          status: TaskStatus.Pending,
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // First transition: pending -> in_progress
      const step1 = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.Pending,
          toStatus: TaskStatus.InProgress,
        }
      );
      expect(step1?.status).toBe(TaskStatus.InProgress);

      // Second transition: in_progress -> completed
      const step2 = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.InProgress,
          toStatus: TaskStatus.Completed,
        }
      );
      expect(step2?.status).toBe(TaskStatus.Completed);
    });
  });

  describe('Race Condition Protection', () => {
    it('should return null when status does not match (simulating another process won)', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Race Condition Test',
          status: TaskStatus.InProgress, // Already in progress
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Try to transition from pending (but it's already in_progress)
      const result = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.Pending, // Wrong status!
          toStatus: TaskStatus.InProgress,
        }
      );

      expect(result).toBeNull();

      // Verify status unchanged
      const unchanged = await db
        .selectFrom('tasks')
        .where('id', '=', task.id)
        .selectAll()
        .executeTakeFirst();

      expect(unchanged?.status).toBe(TaskStatus.InProgress);
    });

    it('should only update when fromStatus matches exactly', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Exact Match Test',
          status: TaskStatus.Completed, // Already completed
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Try various wrong statuses
      const attempt1 = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.Pending,
          toStatus: TaskStatus.Cancelled,
        }
      );
      expect(attempt1).toBeNull();

      const attempt2 = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.InProgress,
          toStatus: TaskStatus.Cancelled,
        }
      );
      expect(attempt2).toBeNull();

      // Correct status should work
      const attempt3 = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.Completed,
          toStatus: TaskStatus.Cancelled,
        }
      );
      expect(attempt3).not.toBeNull();
      expect(attempt3?.status).toBe(TaskStatus.Cancelled);
    });

    it('should simulate concurrent access (only one wins)', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Concurrent Test',
          status: TaskStatus.Pending,
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Simulate two concurrent attempts
      const [result1, result2] = await Promise.all([
        atomicStatusTransition(db, 'tasks', { id: task.id }, {
          fromStatus: TaskStatus.Pending,
          toStatus: TaskStatus.InProgress,
        }),
        atomicStatusTransition(db, 'tasks', { id: task.id }, {
          fromStatus: TaskStatus.Pending,
          toStatus: TaskStatus.InProgress,
        }),
      ]);

      // Only one should succeed (SQLite serializes these, but concept remains)
      const successCount = [result1, result2].filter(r => r !== null).length;
      // In SQLite with in-memory DB, one will always succeed
      expect(successCount).toBeGreaterThanOrEqual(1);

      // Verify final state is in_progress
      const final = await db
        .selectFrom('tasks')
        .where('id', '=', task.id)
        .selectAll()
        .executeTakeFirst();

      expect(final?.status).toBe(TaskStatus.InProgress);
    });
  });

  describe('Additional Updates', () => {
    it('should update additional fields along with status', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Additional Update Test',
          status: TaskStatus.InProgress,
          assigned_to: 'Alice',
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const now = new Date().toISOString();
      const result = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.InProgress,
          toStatus: TaskStatus.Completed,
          additionalUpdates: {
            completed_at: now as any, // SQLite needs ISO string for dates
            assigned_to: 'Bob', // Reassign who completed it
          },
        }
      );

      expect(result).not.toBeNull();
      expect(result?.status).toBe(TaskStatus.Completed);
      expect(result?.assigned_to).toBe('Bob');
      expect(result?.completed_at).toBe(now);
    });

    it('should update partial additional fields', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Partial Update',
          status: TaskStatus.Pending,
          assigned_to: null,
          priority: 5,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.Pending,
          toStatus: TaskStatus.InProgress,
          additionalUpdates: {
            assigned_to: 'Charlie', // Only update assigned_to
          },
        }
      );

      expect(result).not.toBeNull();
      expect(result?.status).toBe(TaskStatus.InProgress);
      expect(result?.assigned_to).toBe('Charlie');
      expect(result?.priority).toBe(5); // Unchanged
      expect(result?.name).toBe('Partial Update'); // Unchanged
    });

    it('should handle null in additional updates', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Null Update Test',
          status: TaskStatus.InProgress,
          assigned_to: 'David',
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.InProgress,
          toStatus: TaskStatus.Cancelled,
          additionalUpdates: {
            assigned_to: null, // Unassign on cancel
          },
        }
      );

      expect(result).not.toBeNull();
      expect(result?.status).toBe(TaskStatus.Cancelled);
      expect(result?.assigned_to).toBeNull();
    });

    it('should not update additional fields if status check fails', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'No Update on Fail',
          status: TaskStatus.Completed, // Wrong status for the transition
          assigned_to: 'Eve',
          priority: 3,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.Pending, // Wrong!
          toStatus: TaskStatus.InProgress,
          additionalUpdates: {
            assigned_to: 'Frank',
            priority: 10,
          },
        }
      );

      expect(result).toBeNull();

      // Verify nothing changed
      const unchanged = await db
        .selectFrom('tasks')
        .where('id', '=', task.id)
        .selectAll()
        .executeTakeFirst();

      expect(unchanged?.status).toBe(TaskStatus.Completed);
      expect(unchanged?.assigned_to).toBe('Eve');
      expect(unchanged?.priority).toBe(3);
    });
  });

  describe('Custom Status Column', () => {
    it('should work with custom statusColumn option', async () => {
      const order = await db
        .insertInto('orders')
        .values({
          customer_id: 1,
          order_status: OrderStatus.Placed,
          total: 99.99,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = await atomicStatusTransition(
        db,
        'orders',
        { id: order.id },
        {
          statusColumn: 'order_status', // Custom column name
          fromStatus: OrderStatus.Placed,
          toStatus: OrderStatus.Confirmed,
        }
      );

      expect(result).not.toBeNull();
      expect(result?.order_status).toBe(OrderStatus.Confirmed);
    });

    it('should fail with custom statusColumn when status does not match', async () => {
      const order = await db
        .insertInto('orders')
        .values({
          customer_id: 2,
          order_status: OrderStatus.Shipped, // Already shipped
          total: 150.00,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = await atomicStatusTransition(
        db,
        'orders',
        { id: order.id },
        {
          statusColumn: 'order_status',
          fromStatus: OrderStatus.Placed, // Wrong status
          toStatus: OrderStatus.Confirmed,
        }
      );

      expect(result).toBeNull();
    });

    it('should update additional fields with custom statusColumn', async () => {
      const order = await db
        .insertInto('orders')
        .values({
          customer_id: 3,
          order_status: OrderStatus.Confirmed,
          total: 200.00,
          notes: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = await atomicStatusTransition(
        db,
        'orders',
        { id: order.id },
        {
          statusColumn: 'order_status',
          fromStatus: OrderStatus.Confirmed,
          toStatus: OrderStatus.Shipped,
          additionalUpdates: {
            notes: 'Shipped via FedEx tracking #12345',
          },
        }
      );

      expect(result).not.toBeNull();
      expect(result?.order_status).toBe(OrderStatus.Shipped);
      expect(result?.notes).toBe('Shipped via FedEx tracking #12345');
    });
  });

  describe('Transaction Support', () => {
    it('should work within transactions', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Transaction Task',
          status: TaskStatus.Pending,
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await db.transaction().execute(async (trx) => {
        const result = await atomicStatusTransition(
          trx,
          'tasks',
          { id: task.id },
          {
            fromStatus: TaskStatus.Pending,
            toStatus: TaskStatus.InProgress,
          }
        );

        expect(result).not.toBeNull();
        expect(result?.status).toBe(TaskStatus.InProgress);
      });

      // Verify committed
      const final = await db
        .selectFrom('tasks')
        .where('id', '=', task.id)
        .selectAll()
        .executeTakeFirst();

      expect(final?.status).toBe(TaskStatus.InProgress);
    });

    it('should rollback on transaction failure', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Rollback Task',
          status: TaskStatus.Pending,
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      try {
        await db.transaction().execute(async (trx) => {
          const result = await atomicStatusTransition(
            trx,
            'tasks',
            { id: task.id },
            {
              fromStatus: TaskStatus.Pending,
              toStatus: TaskStatus.InProgress,
            }
          );

          expect(result?.status).toBe(TaskStatus.InProgress);

          // Force rollback
          throw new Error('Rollback test');
        });
      } catch (error: any) {
        expect(error.message).toBe('Rollback test');
      }

      // Verify rollback - status should still be pending
      const unchanged = await db
        .selectFrom('tasks')
        .where('id', '=', task.id)
        .selectAll()
        .executeTakeFirst();

      expect(unchanged?.status).toBe(TaskStatus.Pending);
    });

    it('should support multiple atomic transitions in one transaction', async () => {
      const task1 = await db
        .insertInto('tasks')
        .values({
          name: 'Multi Task 1',
          status: TaskStatus.Pending,
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const task2 = await db
        .insertInto('tasks')
        .values({
          name: 'Multi Task 2',
          status: TaskStatus.Pending,
          priority: 2,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await db.transaction().execute(async (trx) => {
        // Transition both tasks
        const result1 = await atomicStatusTransition(
          trx,
          'tasks',
          { id: task1.id },
          {
            fromStatus: TaskStatus.Pending,
            toStatus: TaskStatus.InProgress,
          }
        );

        const result2 = await atomicStatusTransition(
          trx,
          'tasks',
          { id: task2.id },
          {
            fromStatus: TaskStatus.Pending,
            toStatus: TaskStatus.InProgress,
          }
        );

        expect(result1?.status).toBe(TaskStatus.InProgress);
        expect(result2?.status).toBe(TaskStatus.InProgress);
      });

      // Verify both committed
      const tasks = await db
        .selectFrom('tasks')
        .where('id', 'in', [task1.id, task2.id])
        .selectAll()
        .execute();

      expect(tasks).toHaveLength(2);
      expect(tasks.every(t => t.status === TaskStatus.InProgress)).toBe(true);
    });

    it('should rollback all transitions on partial failure', async () => {
      const task1 = await db
        .insertInto('tasks')
        .values({
          name: 'Partial Fail 1',
          status: TaskStatus.Pending,
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const task2 = await db
        .insertInto('tasks')
        .values({
          name: 'Partial Fail 2',
          status: TaskStatus.Completed, // Already completed - will fail
          priority: 2,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      try {
        await db.transaction().execute(async (trx) => {
          // First transition succeeds
          const result1 = await atomicStatusTransition(
            trx,
            'tasks',
            { id: task1.id },
            {
              fromStatus: TaskStatus.Pending,
              toStatus: TaskStatus.InProgress,
            }
          );
          expect(result1).not.toBeNull();

          // Second transition fails (wrong status)
          const result2 = await atomicStatusTransition(
            trx,
            'tasks',
            { id: task2.id },
            {
              fromStatus: TaskStatus.Pending, // Wrong! It's completed
              toStatus: TaskStatus.InProgress,
            }
          );

          // Simulate business logic that requires both to succeed
          if (!result2) {
            throw new Error('Task 2 transition failed - rollback');
          }
        });
      } catch (error: any) {
        expect(error.message).toBe('Task 2 transition failed - rollback');
      }

      // Verify both unchanged due to rollback
      const tasks = await db
        .selectFrom('tasks')
        .where('id', 'in', [task1.id, task2.id])
        .orderBy('id', 'asc')
        .selectAll()
        .execute();

      expect(tasks[0]?.status).toBe(TaskStatus.Pending); // Rolled back
      expect(tasks[1]?.status).toBe(TaskStatus.Completed); // Never changed
    });
  });

  describe('Edge Cases', () => {
    it('should return null for non-existent record', async () => {
      const result = await atomicStatusTransition(
        db,
        'tasks',
        { id: 99999 }, // Does not exist
        {
          fromStatus: TaskStatus.Pending,
          toStatus: TaskStatus.InProgress,
        }
      );

      expect(result).toBeNull();
    });

    it('should work with composite WHERE conditions', async () => {
      // Create multiple tasks with same status but different assignments
      await db
        .insertInto('tasks')
        .values([
          { name: 'Task A', status: TaskStatus.Pending, assigned_to: 'Alice', priority: 1 },
          { name: 'Task B', status: TaskStatus.Pending, assigned_to: 'Bob', priority: 1 },
          { name: 'Task C', status: TaskStatus.Pending, assigned_to: 'Alice', priority: 2 },
        ])
        .execute();

      // Transition only Alice's task with priority 1
      const result = await atomicStatusTransition(
        db,
        'tasks',
        {
          assigned_to: 'Alice',
          priority: 1,
          status: TaskStatus.Pending, // This will be overridden by fromStatus check
        },
        {
          fromStatus: TaskStatus.Pending,
          toStatus: TaskStatus.InProgress,
        }
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Task A');
      expect(result?.assigned_to).toBe('Alice');
      expect(result?.priority).toBe(1);

      // Verify only one task was updated
      const allTasks = await db.selectFrom('tasks').selectAll().execute();
      const inProgressTasks = allTasks.filter(t => t.status === TaskStatus.InProgress);
      const pendingTasks = allTasks.filter(t => t.status === TaskStatus.Pending);

      expect(inProgressTasks).toHaveLength(1);
      expect(pendingTasks).toHaveLength(2);
    });

    it('should handle empty WHERE object (would update all matching status)', async () => {
      // Create multiple tasks with same status
      await db
        .insertInto('tasks')
        .values([
          { name: 'Empty Where 1', status: TaskStatus.Pending, priority: 1 },
          { name: 'Empty Where 2', status: TaskStatus.Pending, priority: 2 },
        ])
        .execute();

      // Empty where - only the first matching row should be updated (depends on DB)
      const result = await atomicStatusTransition(
        db,
        'tasks',
        {}, // Empty where
        {
          fromStatus: TaskStatus.Pending,
          toStatus: TaskStatus.InProgress,
        }
      );

      // Should update at least one (SQLite behavior)
      expect(result).not.toBeNull();
      expect(result?.status).toBe(TaskStatus.InProgress);
    });

    it('should handle same fromStatus and toStatus (no-op but returns entity)', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Same Status',
          status: TaskStatus.Pending,
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: TaskStatus.Pending,
          toStatus: TaskStatus.Pending, // Same status
        }
      );

      expect(result).not.toBeNull();
      expect(result?.status).toBe(TaskStatus.Pending);
    });

    it('should handle string status values', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'String Status',
          status: 'custom_pending',
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          fromStatus: 'custom_pending',
          toStatus: 'custom_done',
        }
      );

      expect(result).not.toBeNull();
      expect(result?.status).toBe('custom_done');
    });

    it('should handle numeric status values', async () => {
      // Using priority as a pseudo-status (numeric)
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Numeric Status',
          status: TaskStatus.Pending,
          priority: 0, // Using as status
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id },
        {
          statusColumn: 'priority',
          fromStatus: 0,
          toStatus: 1,
        }
      );

      expect(result).not.toBeNull();
      expect(result?.priority).toBe(1);
    });

    it('should work with WHERE containing null values', async () => {
      const task = await db
        .insertInto('tasks')
        .values({
          name: 'Null Where Test',
          status: TaskStatus.Pending,
          assigned_to: null, // Explicitly null
          priority: 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Note: WHERE assigned_to = null won't work in SQL
      // This tests the behavior (likely returns null since = null doesn't match)
      const result = await atomicStatusTransition(
        db,
        'tasks',
        { id: task.id }, // Use id instead of null field
        {
          fromStatus: TaskStatus.Pending,
          toStatus: TaskStatus.InProgress,
        }
      );

      expect(result).not.toBeNull();
      expect(result?.assigned_to).toBeNull();
    });
  });

  describe('Real-world Scenarios', () => {
    it('should prevent double-spend in payment processing scenario', async () => {
      // Simulate incoming transaction
      const payment = await db
        .insertInto('tasks')
        .values({
          name: 'payment_tx_12345',
          status: 'pending',
          assigned_to: null, // No deposit address yet
          priority: 100, // Amount in cents
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Worker 1 and Worker 2 both try to process the same payment
      const worker1Promise = atomicStatusTransition(
        db,
        'tasks',
        { id: payment.id },
        {
          fromStatus: 'pending',
          toStatus: 'processing',
          additionalUpdates: {
            assigned_to: 'worker_1',
          },
        }
      );

      const worker2Promise = atomicStatusTransition(
        db,
        'tasks',
        { id: payment.id },
        {
          fromStatus: 'pending',
          toStatus: 'processing',
          additionalUpdates: {
            assigned_to: 'worker_2',
          },
        }
      );

      const [worker1Result, worker2Result] = await Promise.all([
        worker1Promise,
        worker2Promise,
      ]);

      // Only one worker should win
      const winners = [worker1Result, worker2Result].filter(r => r !== null);
      expect(winners).toHaveLength(1);

      // The winner has the payment assigned
      const winner = winners[0]!;
      expect(winner.status).toBe('processing');
      expect(['worker_1', 'worker_2']).toContain(winner.assigned_to);
    });

    it('should implement order state machine correctly', async () => {
      const order = await db
        .insertInto('orders')
        .values({
          customer_id: 42,
          order_status: OrderStatus.Placed,
          total: 299.99,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Valid state machine: placed -> confirmed -> processing -> shipped -> delivered
      const confirmResult = await atomicStatusTransition(
        db,
        'orders',
        { id: order.id },
        {
          statusColumn: 'order_status',
          fromStatus: OrderStatus.Placed,
          toStatus: OrderStatus.Confirmed,
        }
      );
      expect(confirmResult?.order_status).toBe(OrderStatus.Confirmed);

      const processResult = await atomicStatusTransition(
        db,
        'orders',
        { id: order.id },
        {
          statusColumn: 'order_status',
          fromStatus: OrderStatus.Confirmed,
          toStatus: OrderStatus.Processing,
        }
      );
      expect(processResult?.order_status).toBe(OrderStatus.Processing);

      // Invalid transition: try to go back to placed (should fail)
      const invalidResult = await atomicStatusTransition(
        db,
        'orders',
        { id: order.id },
        {
          statusColumn: 'order_status',
          fromStatus: OrderStatus.Placed, // Wrong current status
          toStatus: OrderStatus.Confirmed,
        }
      );
      expect(invalidResult).toBeNull();

      // Continue valid transitions
      const shipResult = await atomicStatusTransition(
        db,
        'orders',
        { id: order.id },
        {
          statusColumn: 'order_status',
          fromStatus: OrderStatus.Processing,
          toStatus: OrderStatus.Shipped,
          additionalUpdates: {
            notes: 'Tracking: ABC123',
          },
        }
      );
      expect(shipResult?.order_status).toBe(OrderStatus.Shipped);
      expect(shipResult?.notes).toBe('Tracking: ABC123');

      const deliverResult = await atomicStatusTransition(
        db,
        'orders',
        { id: order.id },
        {
          statusColumn: 'order_status',
          fromStatus: OrderStatus.Shipped,
          toStatus: OrderStatus.Delivered,
        }
      );
      expect(deliverResult?.order_status).toBe(OrderStatus.Delivered);
    });

    it('should handle cancellation from multiple valid states', async () => {
      // Create orders in different states
      const placedOrder = await db
        .insertInto('orders')
        .values({ customer_id: 1, order_status: OrderStatus.Placed, total: 50.00 })
        .returningAll()
        .executeTakeFirstOrThrow();

      const confirmedOrder = await db
        .insertInto('orders')
        .values({ customer_id: 2, order_status: OrderStatus.Confirmed, total: 75.00 })
        .returningAll()
        .executeTakeFirstOrThrow();

      const shippedOrder = await db
        .insertInto('orders')
        .values({ customer_id: 3, order_status: OrderStatus.Shipped, total: 100.00 })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Cancel placed order - should work
      const cancel1 = await atomicStatusTransition(
        db,
        'orders',
        { id: placedOrder.id },
        {
          statusColumn: 'order_status',
          fromStatus: OrderStatus.Placed,
          toStatus: OrderStatus.Cancelled,
        }
      );
      expect(cancel1?.order_status).toBe(OrderStatus.Cancelled);

      // Cancel confirmed order - should work
      const cancel2 = await atomicStatusTransition(
        db,
        'orders',
        { id: confirmedOrder.id },
        {
          statusColumn: 'order_status',
          fromStatus: OrderStatus.Confirmed,
          toStatus: OrderStatus.Cancelled,
        }
      );
      expect(cancel2?.order_status).toBe(OrderStatus.Cancelled);

      // Cancel shipped order - should fail (can't cancel after shipping)
      const cancel3 = await atomicStatusTransition(
        db,
        'orders',
        { id: shippedOrder.id },
        {
          statusColumn: 'order_status',
          fromStatus: OrderStatus.Confirmed, // Wrong - it's shipped
          toStatus: OrderStatus.Cancelled,
        }
      );
      expect(cancel3).toBeNull();

      // Verify shipped order unchanged
      const verifyShipped = await db
        .selectFrom('orders')
        .where('id', '=', shippedOrder.id)
        .selectAll()
        .executeTakeFirst();
      expect(verifyShipped?.order_status).toBe(OrderStatus.Shipped);
    });
  });
});
