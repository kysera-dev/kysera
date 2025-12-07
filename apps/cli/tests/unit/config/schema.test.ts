import { describe, it, expect } from 'vitest';
import {
  KyseraConfigSchema,
  DatabaseConfigSchema,
  DatabaseDialectSchema,
  MigrationConfigSchema,
  PluginsConfigSchema,
  GenerateConfigSchema,
  HealthConfigSchema,
  TestingConfigSchema,
  LoggingConfigSchema,
  CodeStyleSchema,
} from '@/config/schema.js';

describe('KyseraConfigSchema', () => {
  describe('valid configurations', () => {
    it('should accept empty configuration', () => {
      const result = KyseraConfigSchema.safeParse({});

      expect(result.success).toBe(true);
    });

    it('should accept minimal database configuration with connection string', () => {
      const config = {
        database: {
          dialect: 'postgres',
          connection: 'postgres://localhost:5432/testdb',
        },
      };

      const result = KyseraConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept minimal database configuration with database path (SQLite)', () => {
      const config = {
        database: {
          dialect: 'sqlite',
          database: './test.db',
        },
      };

      const result = KyseraConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept full database configuration with connection object', () => {
      const config = {
        database: {
          dialect: 'postgres',
          connection: {
            host: 'localhost',
            port: 5432,
            database: 'testdb',
            user: 'admin',
            password: 'secret',
            ssl: true,
          },
        },
      };

      const result = KyseraConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept database configuration with host/database fields', () => {
      const config = {
        database: {
          dialect: 'mysql',
          host: 'localhost',
          port: 3306,
          database: 'testdb',
          user: 'admin',
          password: 'secret',
        },
      };

      const result = KyseraConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept complete configuration with all sections', () => {
      const config = {
        database: {
          dialect: 'postgres',
          connection: 'postgres://localhost/testdb',
          pool: {
            min: 2,
            max: 10,
            idleTimeoutMillis: 30000,
            acquireTimeoutMillis: 60000,
          },
          debug: false,
        },
        migrations: {
          directory: './migrations',
          pattern: '{timestamp}_{name}.ts',
          tableName: 'migrations',
          lockTable: true,
          lockTimeout: 10000,
          templates: {
            create: './templates/migration.ts',
            table: './templates/table.ts',
          },
        },
        plugins: {
          audit: {
            enabled: true,
            tables: ['users', 'orders'],
            excludeTables: ['logs'],
            captureOldValues: true,
            captureNewValues: true,
            auditTable: 'audit_logs',
          },
          softDelete: {
            enabled: true,
            tables: ['users'],
            deletedAtColumn: 'deleted_at',
            includeDeleted: false,
          },
          timestamps: {
            enabled: true,
            tables: ['*'],
            excludeTables: ['audit_logs'],
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
          templates: {
            repository: './templates/repository.ts',
            model: './templates/model.ts',
            schema: './templates/schema.ts',
          },
        },
        health: {
          enabled: true,
          interval: 60000,
          slowQueryThreshold: 100,
          collectMetrics: true,
          metricsRetention: 3600000,
          alerts: {
            enabled: true,
            slack: {
              webhook: 'https://hooks.slack.com/services/xxx',
              channel: '#alerts',
            },
            email: {
              to: ['admin@example.com'],
              from: 'noreply@example.com',
            },
          },
        },
        testing: {
          database: 'postgres://localhost/testdb_test',
          seeds: './tests/seeds',
          fixtures: './tests/fixtures',
          isolation: {
            useTransactions: true,
            truncateTables: ['users', 'orders'],
            resetSequences: true,
          },
        },
        logging: {
          level: 'info',
          format: 'json',
          destinations: [
            { type: 'console' },
            { type: 'file', path: './logs/app.log' },
          ],
          queries: {
            enabled: true,
            slowQueryThreshold: 100,
            includeParams: false,
          },
        },
      };

      const result = KyseraConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });
  });

  describe('invalid configurations', () => {
    it('should reject invalid dialect', () => {
      const config = {
        database: {
          dialect: 'mongodb', // Invalid
          connection: 'mongodb://localhost/testdb',
        },
      };

      const result = KyseraConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    it('should reject database config without connection or database', () => {
      const config = {
        database: {
          dialect: 'postgres',
          // No connection, database, or host/database
        },
      };

      const result = KyseraConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });
  });
});

describe('DatabaseConfigSchema', () => {
  describe('dialect validation', () => {
    it('should accept postgres dialect', () => {
      const config = {
        dialect: 'postgres',
        connection: 'postgres://localhost/testdb',
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept mysql dialect', () => {
      const config = {
        dialect: 'mysql',
        connection: 'mysql://localhost/testdb',
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept sqlite dialect', () => {
      const config = {
        dialect: 'sqlite',
        database: './test.db',
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should reject invalid dialect', () => {
      const config = {
        dialect: 'oracle',
        connection: 'oracle://localhost/testdb',
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });
  });

  describe('connection validation', () => {
    it('should accept connection string', () => {
      const config = {
        dialect: 'postgres',
        connection: 'postgres://user:pass@localhost:5432/db',
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept connection object', () => {
      const config = {
        dialect: 'postgres',
        connection: {
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          user: 'admin',
          password: 'secret',
        },
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept connection object with ssl', () => {
      const config = {
        dialect: 'postgres',
        connection: {
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          user: 'admin',
          password: 'secret',
          ssl: true,
        },
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should reject incomplete connection object', () => {
      const config = {
        dialect: 'postgres',
        connection: {
          host: 'localhost',
          // Missing required fields: port, database, user, password
        },
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });
  });

  describe('pool configuration', () => {
    it('should accept valid pool configuration', () => {
      const config = {
        dialect: 'postgres',
        connection: 'postgres://localhost/testdb',
        pool: {
          min: 2,
          max: 10,
          idleTimeoutMillis: 30000,
          acquireTimeoutMillis: 60000,
        },
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept partial pool configuration', () => {
      const config = {
        dialect: 'postgres',
        connection: 'postgres://localhost/testdb',
        pool: {
          max: 20,
        },
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should reject negative pool min', () => {
      const config = {
        dialect: 'postgres',
        connection: 'postgres://localhost/testdb',
        pool: {
          min: -1,
        },
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    it('should reject zero pool max', () => {
      const config = {
        dialect: 'postgres',
        connection: 'postgres://localhost/testdb',
        pool: {
          max: 0,
        },
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    it('should reject negative timeout values', () => {
      const config = {
        dialect: 'postgres',
        connection: 'postgres://localhost/testdb',
        pool: {
          idleTimeoutMillis: -1000,
        },
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });
  });

  describe('debug option', () => {
    it('should accept debug: true', () => {
      const config = {
        dialect: 'postgres',
        connection: 'postgres://localhost/testdb',
        debug: true,
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept debug: false', () => {
      const config = {
        dialect: 'postgres',
        connection: 'postgres://localhost/testdb',
        debug: false,
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should default debug to false', () => {
      const config = {
        dialect: 'postgres',
        connection: 'postgres://localhost/testdb',
      };

      const result = DatabaseConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.debug).toBe(false);
      }
    });
  });
});

describe('DatabaseDialectSchema', () => {
  it('should accept postgres', () => {
    const result = DatabaseDialectSchema.safeParse('postgres');
    expect(result.success).toBe(true);
  });

  it('should accept mysql', () => {
    const result = DatabaseDialectSchema.safeParse('mysql');
    expect(result.success).toBe(true);
  });

  it('should accept sqlite', () => {
    const result = DatabaseDialectSchema.safeParse('sqlite');
    expect(result.success).toBe(true);
  });

  it('should reject mssql', () => {
    const result = DatabaseDialectSchema.safeParse('mssql');
    expect(result.success).toBe(false);
  });

  it('should reject empty string', () => {
    const result = DatabaseDialectSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

describe('MigrationConfigSchema', () => {
  it('should accept valid migration configuration', () => {
    const config = {
      directory: './migrations',
      pattern: '{timestamp}_{name}.ts',
      tableName: 'migrations',
      lockTable: true,
      lockTimeout: 10000,
    };

    const result = MigrationConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should use default values', () => {
    const config = {};

    const result = MigrationConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.directory).toBe('./migrations');
      expect(result.data.pattern).toBe('{timestamp}_{name}.ts');
      expect(result.data.tableName).toBe('migrations');
      expect(result.data.lockTable).toBe(true);
      expect(result.data.lockTimeout).toBe(10000);
    }
  });

  it('should accept custom templates', () => {
    const config = {
      templates: {
        create: './templates/migration.ts',
        table: './templates/table.ts',
      },
    };

    const result = MigrationConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.templates?.create).toBe('./templates/migration.ts');
      expect(result.data.templates?.table).toBe('./templates/table.ts');
    }
  });

  it('should accept partial templates', () => {
    const config = {
      templates: {
        create: './templates/migration.ts',
      },
    };

    const result = MigrationConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });
});

describe('PluginsConfigSchema', () => {
  describe('audit plugin', () => {
    it('should accept valid audit configuration', () => {
      const config = {
        audit: {
          enabled: true,
          tables: ['users', 'orders'],
          excludeTables: ['logs'],
          captureOldValues: true,
          captureNewValues: true,
          auditTable: 'audit_logs',
        },
      };

      const result = PluginsConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept enabled false and parse correctly', () => {
      const config = {
        audit: {
          enabled: false,
        },
      };

      const result = PluginsConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.audit?.enabled).toBe(false);
        // The audit object is present in the result
        expect(result.data.audit).toBeDefined();
      }
    });
  });

  describe('softDelete plugin', () => {
    it('should accept valid softDelete configuration', () => {
      const config = {
        softDelete: {
          enabled: true,
          tables: ['users', 'orders'],
          deletedAtColumn: 'deleted_at',
          includeDeleted: false,
        },
      };

      const result = PluginsConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept enabled false and parse correctly', () => {
      const config = {
        softDelete: {
          enabled: false,
        },
      };

      const result = PluginsConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.softDelete?.enabled).toBe(false);
        // The softDelete object is present in the result
        expect(result.data.softDelete).toBeDefined();
      }
    });
  });

  describe('timestamps plugin', () => {
    it('should accept valid timestamps configuration', () => {
      const config = {
        timestamps: {
          enabled: true,
          tables: ['*'],
          excludeTables: ['audit_logs'],
          createdAtColumn: 'created_at',
          updatedAtColumn: 'updated_at',
          dateFormat: 'iso',
          setUpdatedAtOnInsert: false,
        },
      };

      const result = PluginsConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
    });

    it('should accept different date formats', () => {
      const formats = ['iso', 'unix', 'date'] as const;

      for (const dateFormat of formats) {
        const config = {
          timestamps: {
            enabled: true,
            dateFormat,
          },
        };

        const result = PluginsConfigSchema.safeParse(config);

        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid date format', () => {
      const config = {
        timestamps: {
          enabled: true,
          dateFormat: 'invalid',
        },
      };

      const result = PluginsConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    it('should accept enabled false and parse correctly', () => {
      const config = {
        timestamps: {
          enabled: false,
        },
      };

      const result = PluginsConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timestamps?.enabled).toBe(false);
        // The timestamps object is present in the result
        expect(result.data.timestamps).toBeDefined();
      }
    });
  });

  it('should accept multiple plugins', () => {
    const config = {
      audit: { enabled: true },
      softDelete: { enabled: true },
      timestamps: { enabled: true },
    };

    const result = PluginsConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should accept empty plugins configuration', () => {
    const config = {};

    const result = PluginsConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });
});

describe('GenerateConfigSchema', () => {
  it('should accept valid generate configuration', () => {
    const config = {
      repositories: './src/repositories',
      models: './src/models',
      schemas: './src/schemas',
      migrations: './migrations',
    };

    const result = GenerateConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should use default values', () => {
    const config = {};

    const result = GenerateConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repositories).toBe('./src/repositories');
      expect(result.data.models).toBe('./src/models');
      expect(result.data.schemas).toBe('./src/schemas');
      expect(result.data.migrations).toBe('./migrations');
    }
  });

  it('should accept custom templates', () => {
    const config = {
      templates: {
        repository: './templates/repository.ts',
        model: './templates/model.ts',
        schema: './templates/schema.ts',
      },
    };

    const result = GenerateConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });
});

describe('CodeStyleSchema', () => {
  it('should accept valid code style configuration', () => {
    const config = {
      quotes: 'single',
      semi: false,
      indent: 2,
      trailingComma: 'es5',
    };

    const result = CodeStyleSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should accept double quotes', () => {
    const config = {
      quotes: 'double',
    };

    const result = CodeStyleSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should accept all trailing comma options', () => {
    const options = ['none', 'es5', 'all'] as const;

    for (const trailingComma of options) {
      const config = { trailingComma };
      const result = CodeStyleSchema.safeParse(config);
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid quotes value', () => {
    const config = {
      quotes: 'backtick',
    };

    const result = CodeStyleSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('should use default values', () => {
    const config = {};

    const result = CodeStyleSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quotes).toBe('single');
      expect(result.data.semi).toBe(false);
      expect(result.data.indent).toBe(2);
      expect(result.data.trailingComma).toBe('es5');
    }
  });
});

describe('HealthConfigSchema', () => {
  it('should accept valid health configuration', () => {
    const config = {
      enabled: true,
      interval: 60000,
      slowQueryThreshold: 100,
      collectMetrics: true,
      metricsRetention: 3600000,
    };

    const result = HealthConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should accept alerts configuration', () => {
    const config = {
      enabled: true,
      alerts: {
        enabled: true,
        slack: {
          webhook: 'https://hooks.slack.com/services/xxx',
          channel: '#alerts',
        },
        email: {
          to: ['admin@example.com'],
          from: 'noreply@example.com',
        },
      },
    };

    const result = HealthConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should use default values', () => {
    const config = {};

    const result = HealthConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.interval).toBe(60000);
      expect(result.data.slowQueryThreshold).toBe(100);
      expect(result.data.collectMetrics).toBe(true);
      expect(result.data.metricsRetention).toBe(3600000);
    }
  });
});

describe('TestingConfigSchema', () => {
  it('should accept valid testing configuration', () => {
    const config = {
      database: 'postgres://localhost/testdb_test',
      seeds: './tests/seeds',
      fixtures: './tests/fixtures',
    };

    const result = TestingConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should accept database connection object', () => {
    const config = {
      database: {
        host: 'localhost',
        port: 5432,
        database: 'testdb_test',
        user: 'test',
        password: 'test',
      },
    };

    const result = TestingConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should accept isolation configuration', () => {
    const config = {
      isolation: {
        useTransactions: true,
        truncateTables: ['users', 'orders'],
        resetSequences: true,
      },
    };

    const result = TestingConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should use default values', () => {
    const config = {};

    const result = TestingConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.seeds).toBe('./tests/seeds');
      expect(result.data.fixtures).toBe('./tests/fixtures');
    }
  });
});

describe('LoggingConfigSchema', () => {
  it('should accept valid logging configuration', () => {
    const config = {
      level: 'info',
      format: 'json',
      destinations: [{ type: 'console' }],
    };

    const result = LoggingConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should accept all log levels', () => {
    const levels = ['debug', 'info', 'warn', 'error'] as const;

    for (const level of levels) {
      const config = { level };
      const result = LoggingConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    }
  });

  it('should accept file destination', () => {
    const config = {
      destinations: [
        { type: 'console' },
        { type: 'file', path: './logs/app.log' },
      ],
    };

    const result = LoggingConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should accept queries configuration', () => {
    const config = {
      queries: {
        enabled: true,
        slowQueryThreshold: 100,
        includeParams: false,
      },
    };

    const result = LoggingConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should reject invalid log level', () => {
    const config = {
      level: 'verbose',
    };

    const result = LoggingConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('should reject invalid format', () => {
    const config = {
      format: 'xml',
    };

    const result = LoggingConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('should use default values', () => {
    const config = {};

    const result = LoggingConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.level).toBe('info');
      expect(result.data.format).toBe('pretty');
      expect(result.data.destinations).toEqual([{ type: 'console' }]);
    }
  });

  it('should accept pretty format', () => {
    const config = {
      format: 'pretty',
    };

    const result = LoggingConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should accept json format', () => {
    const config = {
      format: 'json',
    };

    const result = LoggingConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });
});
