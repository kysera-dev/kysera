import { z } from 'zod';
import { AuditOptionsSchema } from '@kysera/audit';
import { SoftDeleteOptionsSchema } from '@kysera/soft-delete';
import { TimestampsOptionsSchema } from '@kysera/timestamps';

// Database connection schema
const DatabaseConnectionObjectSchema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  user: z.string(),
  password: z.string(),
  ssl: z.boolean().optional(),
});

const DatabaseConnectionSchema = z.union([
  z.string(), // Connection string
  DatabaseConnectionObjectSchema,
]);

const DatabaseDialectSchema = z.enum(['postgres', 'mysql', 'sqlite']);

const DatabasePoolSchema = z
  .object({
    min: z.number().min(0).default(2),
    max: z.number().min(1).default(10),
    idleTimeoutMillis: z.number().min(0).default(30000),
    acquireTimeoutMillis: z.number().min(0).default(60000),
  })
  .partial();

const DatabaseConfigSchema = z
  .object({
    connection: DatabaseConnectionSchema.optional(),
    database: z.string().optional(), // For SQLite or connection alternatives
    dialect: DatabaseDialectSchema,
    pool: DatabasePoolSchema.optional(),
    debug: z.boolean().optional().default(false),
    // Additional database-specific options
    host: z.string().optional(),
    port: z.number().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
  })
  .refine(
    (data) => {
      // Either connection or database field must be present
      return data.connection || data.database || (data.host && data.database);
    },
    {
      message:
        'Database configuration must include either connection string, database path (for SQLite), or host/database fields',
    }
  );

// Migration configuration schema
const MigrationConfigSchema = z.object({
  directory: z.string().default('./migrations'),
  pattern: z.string().default('{timestamp}_{name}.ts'),
  tableName: z.string().default('migrations'),
  lockTable: z.boolean().default(true),
  lockTimeout: z.number().default(10000),
  templates: z
    .object({
      create: z.string().optional(),
      table: z.string().optional(),
    })
    .optional(),
});

// Plugin configuration schemas
// These schemas are imported from the respective plugin packages to avoid duplication
// and ensure consistency between the CLI config and the plugin interfaces.

/**
 * Audit plugin schema - imported from @kysera/audit
 * Extends the base AuditOptionsSchema with CLI-specific 'enabled' flag
 */
const AuditPluginSchema = AuditOptionsSchema.extend({
  enabled: z.boolean().default(false),
});

/**
 * Soft delete plugin schema - imported from @kysera/soft-delete
 * Extends the base SoftDeleteOptionsSchema with CLI-specific 'enabled' flag
 */
const SoftDeletePluginSchema = SoftDeleteOptionsSchema.extend({
  enabled: z.boolean().default(false),
});

/**
 * Timestamps plugin schema - imported from @kysera/timestamps
 * Extends the base TimestampsOptionsSchema with CLI-specific 'enabled' flag and defaults
 */
const TimestampsPluginSchema = TimestampsOptionsSchema.extend({
  enabled: z.boolean().default(false),
  tables: z.array(z.string()).default(['*']).optional(),
});

const PluginsConfigSchema = z.object({
  audit: AuditPluginSchema.optional(),
  softDelete: SoftDeletePluginSchema.optional(),
  timestamps: TimestampsPluginSchema.optional(),
});

// Code generation configuration schema
const CodeStyleSchema = z.object({
  quotes: z.enum(['single', 'double']).default('single'),
  semi: z.boolean().default(false),
  indent: z.number().default(2),
  trailingComma: z.enum(['none', 'es5', 'all']).default('es5'),
});

const GenerateConfigSchema = z.object({
  repositories: z.string().default('./src/repositories'),
  models: z.string().default('./src/models'),
  schemas: z.string().default('./src/schemas'),
  migrations: z.string().default('./migrations'),
  style: CodeStyleSchema.optional(),
  templates: z
    .object({
      repository: z.string().optional(),
      model: z.string().optional(),
      schema: z.string().optional(),
    })
    .optional(),
});

// Health check configuration schema
const HealthAlertsSchema = z.object({
  enabled: z.boolean().default(false),
  slack: z
    .object({
      webhook: z.string().optional(),
      channel: z.string().optional(),
    })
    .optional(),
  email: z
    .object({
      to: z.array(z.string()).optional(),
      from: z.string().optional(),
    })
    .optional(),
});

const HealthConfigSchema = z.object({
  enabled: z.boolean().default(true),
  interval: z.number().default(60000),
  slowQueryThreshold: z.number().default(100),
  collectMetrics: z.boolean().default(true),
  metricsRetention: z.number().default(3600000),
  alerts: HealthAlertsSchema.optional(),
});

// Testing configuration schema
const TestingIsolationSchema = z.object({
  useTransactions: z.boolean().default(true),
  truncateTables: z.array(z.string()).optional(),
  resetSequences: z.boolean().default(true),
});

const TestingConfigSchema = z.object({
  database: z.union([z.string(), DatabaseConnectionObjectSchema]).optional(),
  seeds: z.string().default('./tests/seeds'),
  fixtures: z.string().default('./tests/fixtures'),
  isolation: TestingIsolationSchema.optional(),
});

// Logging configuration schema
const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

const LogDestinationSchema = z.union([
  z.object({ type: z.literal('console') }),
  z.object({ type: z.literal('file'), path: z.string() }),
]);

const LoggingConfigSchema = z.object({
  level: LogLevelSchema.default('info'),
  format: z.enum(['json', 'pretty']).default('pretty'),
  destinations: z.array(LogDestinationSchema).default([{ type: 'console' }]),
  queries: z
    .object({
      enabled: z.boolean().default(false),
      slowQueryThreshold: z.number().default(100),
      includeParams: z.boolean().default(false),
    })
    .optional(),
});

// Main configuration schema
export const KyseraConfigSchema = z.object({
  database: DatabaseConfigSchema.optional(),
  migrations: MigrationConfigSchema.optional(),
  plugins: PluginsConfigSchema.optional(),
  generate: GenerateConfigSchema.optional(),
  health: HealthConfigSchema.optional(),
  testing: TestingConfigSchema.optional(),
  logging: LoggingConfigSchema.optional(),
});

// Export individual schemas for reuse
export {
  DatabaseConfigSchema,
  DatabaseDialectSchema,
  MigrationConfigSchema,
  PluginsConfigSchema,
  GenerateConfigSchema,
  HealthConfigSchema,
  TestingConfigSchema,
  LoggingConfigSchema,
  CodeStyleSchema,
};

// Types
export type KyseraConfig = z.infer<typeof KyseraConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type MigrationConfig = z.infer<typeof MigrationConfigSchema>;
export type PluginsConfig = z.infer<typeof PluginsConfigSchema>;
export type GenerateConfig = z.infer<typeof GenerateConfigSchema>;
export type HealthConfig = z.infer<typeof HealthConfigSchema>;
export type TestingConfig = z.infer<typeof TestingConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
