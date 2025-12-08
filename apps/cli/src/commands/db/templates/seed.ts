/**
 * Seed templates for kysera-cli
 *
 * These templates provide starting points for creating database seeds.
 */

import { ValidationError } from '../../../utils/errors.js';

export const SEED_TEMPLATES = {
  /**
   * Basic seed template - simple data insertion
   */
  basic: `import { Kysely } from 'kysely';
import type { SeedContext } from '@kysera/cli';

/**
 * Seed the database with initial data
 */
export async function seed(db: Kysely<any>, context?: SeedContext): Promise<void> {
  // Insert your seed data here
  // Example:
  // await db.insertInto('users').values([
  //   { name: 'John Doe', email: 'john@example.com' },
  //   { name: 'Jane Doe', email: 'jane@example.com' },
  // ]).execute();
}
`,

  /**
   * Factory-based seed template - uses factory helpers for generating data
   */
  factory: `import { Kysely } from 'kysely';
import type { SeedContext } from '@kysera/cli';

/**
 * Seed the database using factory pattern
 */
export async function seed(db: Kysely<any>, context?: SeedContext): Promise<void> {
  if (!context) {
    throw new ValidationError('SeedContext is required for factory-based seeding');
  }

  const { factory, logger, verbose } = context;

  // Generate users using factory
  const users = factory.createMany(10, (index) => ({
    name: \`User \${index + 1}\`,
    email: \`user\${index + 1}@example.com\`,
    created_at: new Date(),
  }));

  if (verbose) {
    logger.debug(\`Creating \${users.length} users\`);
  }

  await db.insertInto('users').values(users).execute();

  // Example with sequence
  const sequence = factory.sequence(1000);
  const products = factory.createMany(5, () => ({
    sku: \`PROD-\${sequence()}\`,
    name: \`Product \${factory.pick(['A', 'B', 'C', 'D', 'E'])}\`,
    price: Math.floor(Math.random() * 10000) / 100,
  }));

  await db.insertInto('products').values(products).execute();
}
`,

  /**
   * Faker-based seed template - uses faker.js for realistic data
   */
  faker: `import { Kysely } from 'kysely';
import { faker } from '@faker-js/faker';
import type { SeedContext } from '@kysera/cli';

/**
 * Seed the database with realistic fake data
 */
export async function seed(db: Kysely<any>, context?: SeedContext): Promise<void> {
  const count = 50; // Number of records to create

  // Generate users
  const users = Array.from({ length: count }, () => ({
    name: faker.person.fullName(),
    email: faker.internet.email().toLowerCase(),
    phone: faker.phone.number(),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    country: faker.location.country(),
    created_at: faker.date.past(),
    updated_at: new Date(),
  }));

  await db.insertInto('users').values(users).execute();

  if (context?.verbose) {
    context.logger.debug(\`Created \${users.length} users with realistic data\`);
  }
}
`,

  /**
   * Ordered seed template - with explicit ordering
   */
  ordered: `import { Kysely } from 'kysely';
import type { SeedContext } from '@kysera/cli';

/**
 * Execution order for this seed (lower numbers run first)
 */
export const order = 10;

/**
 * Dependencies that must run before this seed
 */
export const dependencies = ['01_users'];

/**
 * Seed the database with ordered data
 */
export async function seed(db: Kysely<any>, context?: SeedContext): Promise<void> {
  // This seed will run after 01_users due to the dependency
  // and will have order priority of 10

  // Fetch user IDs for relationships
  const users = await db.selectFrom('users').select('id').execute();
  const userIds = users.map((u) => u.id);

  if (userIds.length === 0) {
    throw new ValidationError('No users found - ensure 01_users seed has run');
  }

  // Create orders for users
  const orders = userIds.flatMap((userId) =>
    Array.from({ length: 3 }, () => ({
      user_id: userId,
      total: Math.floor(Math.random() * 10000) / 100,
      status: ['pending', 'processing', 'completed'][Math.floor(Math.random() * 3)],
      created_at: new Date(),
    }))
  );

  await db.insertInto('orders').values(orders).execute();
}
`,

  /**
   * Conditional seed template - with dry-run support
   */
  conditional: `import { Kysely } from 'kysely';
import type { SeedContext } from '@kysera/cli';

/**
 * Seed with dry-run support and conditional logic
 */
export async function seed(db: Kysely<any>, context?: SeedContext): Promise<void> {
  const { dryRun, verbose, logger } = context || {
    dryRun: false,
    verbose: false,
    logger: console,
  };

  // Check if table is empty before seeding
  const existingCount = await db
    .selectFrom('settings')
    .select(db.fn.count('id').as('count'))
    .executeTakeFirst();

  if (existingCount && Number(existingCount.count) > 0) {
    if (verbose) {
      logger.debug('Settings table already has data, skipping seed');
    }
    return;
  }

  const settings = [
    { key: 'site_name', value: 'My Application', type: 'string' },
    { key: 'maintenance_mode', value: 'false', type: 'boolean' },
    { key: 'max_upload_size', value: '10485760', type: 'number' },
    { key: 'allowed_extensions', value: JSON.stringify(['jpg', 'png', 'pdf']), type: 'json' },
  ];

  if (dryRun) {
    logger.debug('[DRY RUN] Would insert settings:', settings);
    return;
  }

  await db.insertInto('settings').values(settings).execute();

  if (verbose) {
    logger.debug(\`Inserted \${settings.length} default settings\`);
  }
}
`,

  /**
   * Relationship seed template - seeds multiple related tables
   */
  relationship: `import { Kysely } from 'kysely';
import type { SeedContext } from '@kysera/cli';

/**
 * Seed related tables maintaining referential integrity
 */
export async function seed(db: Kysely<any>, context?: SeedContext): Promise<void> {
  const { factory, verbose, logger } = context || {
    factory: null,
    verbose: false,
    logger: console,
  };

  // Create categories first
  const categories = [
    { name: 'Electronics', slug: 'electronics' },
    { name: 'Clothing', slug: 'clothing' },
    { name: 'Books', slug: 'books' },
  ];

  const insertedCategories = await db
    .insertInto('categories')
    .values(categories)
    .returning(['id', 'name'])
    .execute();

  if (verbose) {
    logger.debug(\`Created \${insertedCategories.length} categories\`);
  }

  // Create products for each category
  for (const category of insertedCategories) {
    const products = Array.from({ length: 5 }, (_, i) => ({
      category_id: category.id,
      name: \`\${category.name} Product \${i + 1}\`,
      price: Math.floor(Math.random() * 10000) / 100,
      stock: Math.floor(Math.random() * 100),
      created_at: new Date(),
    }));

    await db.insertInto('products').values(products).execute();
  }

  // Create tags
  const tags = [
    { name: 'Featured' },
    { name: 'Sale' },
    { name: 'New' },
    { name: 'Popular' },
  ];

  const insertedTags = await db
    .insertInto('tags')
    .values(tags)
    .returning(['id'])
    .execute();

  // Create product-tag relationships (many-to-many)
  const products = await db.selectFrom('products').select('id').execute();

  const productTags = products.flatMap((product) => {
    // Assign 1-3 random tags to each product
    const numTags = Math.floor(Math.random() * 3) + 1;
    const shuffledTags = [...insertedTags].sort(() => Math.random() - 0.5);
    return shuffledTags.slice(0, numTags).map((tag) => ({
      product_id: product.id,
      tag_id: tag.id,
    }));
  });

  await db.insertInto('product_tags').values(productTags).execute();

  if (verbose) {
    logger.debug(\`Created \${productTags.length} product-tag relationships\`);
  }
}
`,

  /**
   * Truncate and reseed template
   */
  fresh: `import { Kysely, sql } from 'kysely';
import type { SeedContext } from '@kysera/cli';

/**
 * Truncate tables and reseed with fresh data
 * Use with caution - this will delete all existing data!
 */
export async function seed(db: Kysely<any>, context?: SeedContext): Promise<void> {
  const { dryRun, verbose, logger } = context || {
    dryRun: false,
    verbose: false,
    logger: console,
  };

  const tables = ['order_items', 'orders', 'products', 'users'];

  if (dryRun) {
    logger.debug('[DRY RUN] Would truncate tables:', tables);
    return;
  }

  // Truncate in reverse order to respect foreign key constraints
  for (const table of tables) {
    if (verbose) {
      logger.debug(\`Truncating table: \${table}\`);
    }

    // Use raw SQL for TRUNCATE with CASCADE
    await sql\`TRUNCATE TABLE \${sql.id(table)} CASCADE\`.execute(db);
  }

  // Now seed fresh data
  const users = Array.from({ length: 10 }, (_, i) => ({
    name: \`User \${i + 1}\`,
    email: \`user\${i + 1}@example.com\`,
    created_at: new Date(),
  }));

  await db.insertInto('users').values(users).execute();

  const products = Array.from({ length: 20 }, (_, i) => ({
    name: \`Product \${i + 1}\`,
    price: Math.floor(Math.random() * 10000) / 100,
    created_at: new Date(),
  }));

  await db.insertInto('products').values(products).execute();

  if (verbose) {
    logger.debug('Fresh seed completed successfully');
  }
}
`,
};

/**
 * Get a seed template by name
 */
export function getSeedTemplate(name: keyof typeof SEED_TEMPLATES): string {
  return SEED_TEMPLATES[name] || SEED_TEMPLATES.basic;
}

/**
 * Get all available template names
 */
export function getAvailableTemplates(): string[] {
  return Object.keys(SEED_TEMPLATES);
}

/**
 * Generate a seed filename with timestamp
 */
export function generateSeedFilename(name: string, order?: number): string {
  const prefix = order !== undefined ? String(order).padStart(2, '0') : '';
  const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return prefix ? `${prefix}_${sanitizedName}.ts` : `${sanitizedName}.ts`;
}
