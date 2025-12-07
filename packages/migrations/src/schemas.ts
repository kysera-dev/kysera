import { z } from 'zod';

// ============================================================================
// Migration Runner Options Schema
// ============================================================================

/**
 * Schema for MigrationRunnerOptions
 * Validates configuration options for the migration runner
 */
export const MigrationRunnerOptionsSchema = z.object({
  /** Enable dry run mode (preview only, no changes) */
  dryRun: z.boolean().default(false),
  /** Logger function - validated as any since function schemas are complex in Zod v4 */
  logger: z.any().optional(),
  /** Wrap each migration in a transaction */
  useTransactions: z.boolean().default(false),
  /** Stop on first error */
  stopOnError: z.boolean().default(true),
  /** Show detailed metadata in logs */
  verbose: z.boolean().default(true),
});

// ============================================================================
// Migration Definition Schema
// ============================================================================

/**
 * Schema for MigrationDefinition
 * Validates migration definition objects used with defineMigrations()
 */
export const MigrationDefinitionSchema = z.object({
  /** Migration name - must be non-empty */
  name: z.string().min(1, 'Migration name is required'),
  /** Human-readable description shown during migration */
  description: z.string().optional(),
  /** Whether this is a breaking change - shows warning before execution */
  breaking: z.boolean().default(false),
  /** Tags for categorization (e.g., ['schema', 'data', 'index']) */
  tags: z.array(z.string()).default([]),
  /** Estimated duration as human-readable string (e.g., '30s', '2m') */
  estimatedDuration: z.string().optional(),
});

// ============================================================================
// Migration Plugin Options Schema
// ============================================================================

/**
 * Schema for MigrationPluginOptions
 * Validates options passed to migration plugins
 */
export const MigrationPluginOptionsSchema = z.object({
  /** Optional logger for the plugin */
  logger: z.any().optional(),
});

// ============================================================================
// Migration Plugin Schema
// ============================================================================

/**
 * Schema for MigrationPlugin
 * Validates migration plugin structure
 */
export const MigrationPluginSchema = z.object({
  /** Plugin name */
  name: z.string().min(1, 'Plugin name is required'),
  /** Plugin version */
  version: z.string().min(1, 'Plugin version is required'),
  /** Called once when the runner is initialized */
  onInit: z.any().optional(),
  /** Called before migration execution */
  beforeMigration: z.any().optional(),
  /** Called after successful migration execution */
  afterMigration: z.any().optional(),
  /** Called on migration error */
  onMigrationError: z.any().optional(),
});

// ============================================================================
// Migration Status Schema
// ============================================================================

/**
 * Schema for MigrationStatus
 * Validates migration status results
 */
export const MigrationStatusSchema = z.object({
  /** List of executed migration names */
  executed: z.array(z.string()),
  /** List of pending migration names */
  pending: z.array(z.string()),
  /** Total migration count */
  total: z.number().int().nonnegative(),
});

// ============================================================================
// Migration Result Schema
// ============================================================================

/**
 * Schema for MigrationResult
 * Validates results from migration runs
 */
export const MigrationResultSchema = z.object({
  /** Successfully executed migrations */
  executed: z.array(z.string()),
  /** Migrations that were skipped (already executed) */
  skipped: z.array(z.string()),
  /** Migrations that failed */
  failed: z.array(z.string()),
  /** Total duration in milliseconds */
  duration: z.number().nonnegative(),
  /** Whether the run was in dry-run mode */
  dryRun: z.boolean(),
});

// ============================================================================
// Extended Runner Options Schema (with plugins)
// ============================================================================

/**
 * Schema for MigrationRunnerWithPluginsOptions
 * Extends MigrationRunnerOptionsSchema with plugin support
 */
export const MigrationRunnerWithPluginsOptionsSchema = MigrationRunnerOptionsSchema.extend({
  /** Plugins to apply */
  plugins: z.array(MigrationPluginSchema).optional(),
});

// ============================================================================
// Type Exports
// ============================================================================

/** Input type for MigrationRunnerOptions - before defaults are applied */
export type MigrationRunnerOptionsInput = z.input<typeof MigrationRunnerOptionsSchema>;

/** Output type for MigrationRunnerOptions - after defaults are applied */
export type MigrationRunnerOptionsOutput = z.output<typeof MigrationRunnerOptionsSchema>;

/** Input type for MigrationDefinition - before defaults are applied */
export type MigrationDefinitionInput = z.input<typeof MigrationDefinitionSchema>;

/** Output type for MigrationDefinition - after defaults are applied */
export type MigrationDefinitionOutput = z.output<typeof MigrationDefinitionSchema>;

/** Input type for MigrationPluginOptions */
export type MigrationPluginOptionsInput = z.input<typeof MigrationPluginOptionsSchema>;

/** Output type for MigrationPluginOptions */
export type MigrationPluginOptionsOutput = z.output<typeof MigrationPluginOptionsSchema>;

/** Input type for MigrationPlugin */
export type MigrationPluginInput = z.input<typeof MigrationPluginSchema>;

/** Output type for MigrationPlugin */
export type MigrationPluginOutput = z.output<typeof MigrationPluginSchema>;

/** Type for MigrationStatus */
export type MigrationStatusType = z.infer<typeof MigrationStatusSchema>;

/** Type for MigrationResult */
export type MigrationResultType = z.infer<typeof MigrationResultSchema>;

/** Input type for MigrationRunnerWithPluginsOptions */
export type MigrationRunnerWithPluginsOptionsInput = z.input<typeof MigrationRunnerWithPluginsOptionsSchema>;

/** Output type for MigrationRunnerWithPluginsOptions */
export type MigrationRunnerWithPluginsOptionsOutput = z.output<typeof MigrationRunnerWithPluginsOptionsSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate and parse MigrationRunnerOptions with defaults
 */
export function parseMigrationRunnerOptions(
  options: unknown
): MigrationRunnerOptionsOutput {
  return MigrationRunnerOptionsSchema.parse(options);
}

/**
 * Safely validate MigrationRunnerOptions without throwing
 * Returns result with success boolean and either data or error
 */
export function safeParseMigrationRunnerOptions(options: unknown) {
  return MigrationRunnerOptionsSchema.safeParse(options);
}

/**
 * Validate and parse MigrationDefinition with defaults
 */
export function parseMigrationDefinition(
  definition: unknown
): MigrationDefinitionOutput {
  return MigrationDefinitionSchema.parse(definition);
}

/**
 * Safely validate MigrationDefinition without throwing
 * Returns result with success boolean and either data or error
 */
export function safeParseMigrationDefinition(definition: unknown) {
  return MigrationDefinitionSchema.safeParse(definition);
}
