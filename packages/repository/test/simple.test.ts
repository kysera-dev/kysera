import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createTestDatabase } from './setup/database.js';
import { createRepositoryFactory } from '../src/repository.js';

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string(),
});

describe('Simple Test', () => {
  it('should create database', async () => {
    const { db, cleanup } = createTestDatabase();
    expect(db).toBeDefined();
    await cleanup();
  });

  it('should create factory', async () => {
    const { db, cleanup } = createTestDatabase();
    const factory = createRepositoryFactory(db);
    expect(factory).toBeDefined();
    await cleanup();
  });

  it('should create repository', async () => {
    const { db, cleanup } = createTestDatabase();
    const factory = createRepositoryFactory(db);

    const userRepo = factory.create({
      tableName: 'users',
      mapRow: (row) => row,
      schemas: {
        create: CreateUserSchema,
      },
    });

    expect(userRepo).toBeDefined();
    await cleanup();
  });
});
