import type { KyseraConfig } from './schema.js';

export const defaultConfig: KyseraConfig = {
  database: undefined, // Must be provided by user

  migrations: {
    directory: './migrations',
    pattern: '{timestamp}_{name}.ts',
    tableName: 'migrations',
    lockTable: true,
    lockTimeout: 10000,
  },

  plugins: {
    audit: {
      enabled: false,
      captureOldValues: true,
      captureNewValues: true,
      auditTable: 'audit_logs',
    },
    softDelete: {
      enabled: false,
      deletedAtColumn: 'deleted_at',
      includeDeleted: false,
    },
    timestamps: {
      enabled: false,
      tables: ['*'],
      createdAtColumn: 'created_at',
      updatedAtColumn: 'updated_at',
      dateFormat: 'iso',
      setUpdatedAtOnInsert: false,
    },
  },

  generate: {
    repositories: './src/repositories',
    models: './src/models',
    schemas: './src/schemas',
    migrations: './migrations',
    style: {
      quotes: 'single',
      semi: false,
      indent: 2,
      trailingComma: 'es5',
    },
  },

  health: {
    enabled: true,
    interval: 60000,
    slowQueryThreshold: 100,
    collectMetrics: true,
    metricsRetention: 3600000,
  },

  testing: {
    seeds: './tests/seeds',
    fixtures: './tests/fixtures',
    isolation: {
      useTransactions: true,
      resetSequences: true,
    },
  },

  logging: {
    level: 'info',
    format: 'pretty',
    destinations: [{ type: 'console' }],
    queries: {
      enabled: false,
      slowQueryThreshold: 100,
      includeParams: false,
    },
  },
};

export function mergeConfig(userConfig: Partial<KyseraConfig>, defaults: KyseraConfig = defaultConfig): KyseraConfig {
  return {
    ...defaults,
    ...userConfig,
    migrations: {
      ...defaults.migrations,
      ...userConfig.migrations,
    },
    plugins: {
      ...defaults.plugins,
      ...userConfig.plugins,
      audit: {
        ...defaults.plugins?.audit,
        ...userConfig.plugins?.audit,
      },
      softDelete: {
        ...defaults.plugins?.softDelete,
        ...userConfig.plugins?.softDelete,
      },
      timestamps: {
        ...defaults.plugins?.timestamps,
        ...userConfig.plugins?.timestamps,
      },
    },
    generate: {
      ...defaults.generate,
      ...userConfig.generate,
      style: {
        ...defaults.generate?.style,
        ...userConfig.generate?.style,
      },
    },
    health: {
      ...defaults.health,
      ...userConfig.health,
      alerts: {
        ...defaults.health?.alerts,
        ...userConfig.health?.alerts,
      },
    },
    testing: {
      ...defaults.testing,
      ...userConfig.testing,
      isolation: {
        ...defaults.testing?.isolation,
        ...userConfig.testing?.isolation,
      },
    },
    logging: {
      ...defaults.logging,
      ...userConfig.logging,
      queries: {
        ...defaults.logging?.queries,
        ...userConfig.logging?.queries,
      },
    },
  };
}
