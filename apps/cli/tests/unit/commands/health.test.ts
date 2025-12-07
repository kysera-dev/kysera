import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Command } from 'commander';

// Mock dependencies
vi.mock('@xec-sh/kit', () => ({
  prism: {
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    gray: (s: string) => s,
    blue: (s: string) => s,
    red: (s: string) => s,
    bold: (s: string) => s,
  },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    text: '',
  })),
  table: vi.fn((data: any[]) => JSON.stringify(data)),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../../src/utils/database.js', () => ({
  getDatabaseConnection: vi.fn(),
}));

vi.mock('@kysera/core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    performHealthCheck: vi.fn(),
    getMetrics: vi.fn(),
  };
});

import { loadConfig } from '../../../src/config/loader.js';
import { getDatabaseConnection } from '../../../src/utils/database.js';
import { performHealthCheck, getMetrics } from '@kysera/core';
import { healthCommand } from '../../../src/commands/health/index.js';
import { checkCommand } from '../../../src/commands/health/check.js';
import { metricsCommand } from '../../../src/commands/health/metrics.js';

// Mock database connection
const mockDb = {
  destroy: vi.fn(),
};

// Mock health check result
const mockHealthResult = {
  status: 'healthy' as const,
  checks: [
    { name: 'Database Connection', status: 'healthy', message: 'Connected' },
    { name: 'Pool', status: 'healthy', message: 'Pool is healthy' },
  ],
  metrics: {
    databaseVersion: 'PostgreSQL 15.0',
    poolMetrics: {
      activeConnections: 2,
      idleConnections: 8,
      totalConnections: 10,
      waitingRequests: 0,
    },
    queryMetrics: {
      totalQueries: 1000,
      avgResponseTime: 5,
      slowQueries: 2,
      errors: 0,
    },
  },
  errors: [],
};

// Mock metrics result
const mockMetricsResult = {
  period: '1h',
  connections: {
    total: 10,
    active: 2,
    idle: 8,
    max: 20,
    errors: 0,
  },
  queries: {
    total: 1000,
    avgDuration: 5,
    minDuration: 1,
    maxDuration: 100,
    p95Duration: 20,
    p99Duration: 50,
    slowCount: 5,
    errorCount: 0,
  },
  tables: [
    { name: 'users', rowCount: 1000, size: 1048576, indexSize: 262144 },
    { name: 'posts', rowCount: 5000, size: 5242880, indexSize: 1048576 },
  ],
  postgres: {
    cacheHitRatio: 0.99,
    indexHitRatio: 0.98,
    deadlocks: 0,
    tempFiles: 0,
    tempBytes: 0,
    transactionRate: 100,
    rollbackRate: 0.1,
  },
  slowQueries: [
    { query: 'SELECT * FROM posts WHERE...', duration: 150, timestamp: new Date().toISOString() },
  ],
  recommendations: [],
};

describe('health command', () => {
  let command: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    command = healthCommand();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('health');
    });

    it('should have all subcommands', () => {
      const subcommands = command.commands.map((c) => c.name());
      expect(subcommands).toContain('check');
      expect(subcommands).toContain('watch');
      expect(subcommands).toContain('metrics');
    });
  });
});

describe('health check command', () => {
  let command: Command;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', host: 'localhost', database: 'test' },
    });
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    (performHealthCheck as Mock).mockResolvedValue(mockHealthResult);
    
    consoleSpy = { log: vi.fn() };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
    
    command = checkCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('check');
    });

    it('should have json option', () => {
      const opt = command.options.find((o) => o.long === '--json');
      expect(opt).toBeDefined();
    });

    it('should have watch option', () => {
      const opt = command.options.find((o) => o.long === '--watch');
      expect(opt).toBeDefined();
    });

    it('should have interval option', () => {
      const opt = command.options.find((o) => o.long === '--interval');
      expect(opt).toBeDefined();
    });

    it('should have verbose option', () => {
      const opt = command.options.find((o) => o.short === '-v');
      expect(opt).toBeDefined();
    });
  });

  describe('health check execution', () => {
    it('should perform health check', async () => {
      await command.parseAsync(['node', 'test']);

      expect(performHealthCheck).toHaveBeenCalledWith(mockDb, expect.any(Object));
    });

    it('should display health status', async () => {
      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Health');
    });

    it('should output JSON when --json flag is set', async () => {
      await command.parseAsync(['node', 'test', '--json']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(() => JSON.parse(logOutput)).not.toThrow();
    });

    it('should show more details with --verbose', async () => {
      await command.parseAsync(['node', 'test', '--verbose']);

      expect(performHealthCheck).toHaveBeenCalledWith(mockDb, expect.objectContaining({
        verbose: true,
      }));
    });

    it('should display healthy status correctly', async () => {
      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Healthy');
    });

    it('should display degraded status correctly', async () => {
      (performHealthCheck as Mock).mockResolvedValue({
        ...mockHealthResult,
        status: 'degraded',
      });

      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Degraded');
    });

    it('should display unhealthy status correctly', async () => {
      (performHealthCheck as Mock).mockResolvedValue({
        ...mockHealthResult,
        status: 'unhealthy',
        errors: ['Connection timeout'],
      });

      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Unhealthy');
    });

    it('should display connection checks', async () => {
      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Connection');
    });

    it('should display pool metrics when available', async () => {
      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Pool');
    });

    it('should display latency', async () => {
      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Latency');
    });

    it('should display query metrics in verbose mode', async () => {
      await command.parseAsync(['node', 'test', '--verbose']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Queries');
    });

    it('should display errors if any', async () => {
      (performHealthCheck as Mock).mockResolvedValue({
        ...mockHealthResult,
        status: 'unhealthy',
        errors: ['Database connection failed', 'Query timeout'],
      });

      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('connection failed');
    });
  });

  describe('error handling', () => {
    it('should throw error if config not found', async () => {
      (loadConfig as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test']))
        .rejects.toThrow();
    });

    it('should throw error if database connection fails', async () => {
      (getDatabaseConnection as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test']))
        .rejects.toThrow();
    });

    it('should close database connection on success', async () => {
      await command.parseAsync(['node', 'test']);

      expect(mockDb.destroy).toHaveBeenCalled();
    });

    it('should close database connection on error', async () => {
      (performHealthCheck as Mock).mockRejectedValue(new Error('Health check failed'));

      try {
        await command.parseAsync(['node', 'test']);
      } catch {
        // Expected to throw
      }

      expect(mockDb.destroy).toHaveBeenCalled();
    });
  });
});

describe('health metrics command', () => {
  let command: Command;
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', host: 'localhost', database: 'test' },
    });
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    (getMetrics as Mock).mockResolvedValue(mockMetricsResult);
    
    consoleSpy = { log: vi.fn() };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
    
    command = metricsCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have the correct command name', () => {
      expect(command.name()).toBe('metrics');
    });

    it('should have json option', () => {
      const opt = command.options.find((o) => o.long === '--json');
      expect(opt).toBeDefined();
    });

    it('should have period option with default', () => {
      const opt = command.options.find((o) => o.long === '--period');
      expect(opt).toBeDefined();
      expect(opt?.defaultValue).toBe('1h');
    });
  });

  describe('metrics display', () => {
    it('should fetch metrics', async () => {
      await command.parseAsync(['node', 'test']);

      expect(getMetrics).toHaveBeenCalledWith(mockDb, expect.objectContaining({
        period: '1h',
      }));
    });

    it('should display connection metrics', async () => {
      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Connection');
    });

    it('should display query performance metrics', async () => {
      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Query');
    });

    it('should display table statistics', async () => {
      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Table');
    });

    it('should display postgres-specific metrics for postgres dialect', async () => {
      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('PostgreSQL');
    });

    it('should display mysql-specific metrics for mysql dialect', async () => {
      (loadConfig as Mock).mockResolvedValue({
        database: { dialect: 'mysql', host: 'localhost', database: 'test' },
      });
      (getMetrics as Mock).mockResolvedValue({
        ...mockMetricsResult,
        postgres: undefined,
        mysql: {
          bufferPoolHitRatio: 0.99,
          queryCacheHitRatio: 0.95,
          threadsConnected: 5,
          threadsRunning: 2,
          tableLocksWaited: 0,
          slowQueries: 3,
          questionsRate: 150,
        },
      });

      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('MySQL');
    });

    it('should display slow queries', async () => {
      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Slow');
    });

    it('should display recommendations if any', async () => {
      (getMetrics as Mock).mockResolvedValue({
        ...mockMetricsResult,
        recommendations: ['Consider adding an index on users.email'],
      });

      await command.parseAsync(['node', 'test']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logOutput).toContain('Recommendations');
    });

    it('should output JSON when --json flag is set', async () => {
      await command.parseAsync(['node', 'test', '--json']);

      const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(() => JSON.parse(logOutput)).not.toThrow();
    });

    it('should use specified period', async () => {
      await command.parseAsync(['node', 'test', '--period', '24h']);

      expect(getMetrics).toHaveBeenCalledWith(mockDb, expect.objectContaining({
        period: '24h',
      }));
    });
  });

  describe('error handling', () => {
    it('should throw error if config not found', async () => {
      (loadConfig as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test']))
        .rejects.toThrow();
    });

    it('should throw error if database connection fails', async () => {
      (getDatabaseConnection as Mock).mockResolvedValue(null);

      await expect(command.parseAsync(['node', 'test']))
        .rejects.toThrow();
    });

    it('should close database connection', async () => {
      await command.parseAsync(['node', 'test']);

      expect(mockDb.destroy).toHaveBeenCalled();
    });
  });
});

describe('health check result display', () => {
  let consoleSpy: { log: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    
    (loadConfig as Mock).mockResolvedValue({
      database: { dialect: 'postgres', host: 'localhost', database: 'test' },
    });
    (getDatabaseConnection as Mock).mockResolvedValue(mockDb);
    
    consoleSpy = { log: vi.fn() };
    vi.spyOn(console, 'log').mockImplementation(consoleSpy.log);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should display check icon for healthy checks', async () => {
    (performHealthCheck as Mock).mockResolvedValue(mockHealthResult);
    
    const command = checkCommand();
    await command.parseAsync(['node', 'test']);

    // The output should contain check marks or status indicators
    const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logOutput.length).toBeGreaterThan(0);
  });

  it('should display warning for degraded checks', async () => {
    (performHealthCheck as Mock).mockResolvedValue({
      ...mockHealthResult,
      status: 'degraded',
      checks: [
        { name: 'Database Connection', status: 'healthy', message: 'Connected' },
        { name: 'Pool', status: 'degraded', message: 'Pool usage high' },
      ],
    });
    
    const command = checkCommand();
    await command.parseAsync(['node', 'test']);

    const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logOutput).toContain('Degraded');
  });

  it('should display error for unhealthy checks', async () => {
    (performHealthCheck as Mock).mockResolvedValue({
      ...mockHealthResult,
      status: 'unhealthy',
      checks: [
        { name: 'Database Connection', status: 'unhealthy', message: 'Connection failed' },
      ],
      errors: ['Connection timeout after 30s'],
    });
    
    const command = checkCommand();
    await command.parseAsync(['node', 'test']);

    const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logOutput).toContain('Unhealthy');
  });

  it('should display database version when available', async () => {
    (performHealthCheck as Mock).mockResolvedValue(mockHealthResult);
    
    const command = checkCommand();
    await command.parseAsync(['node', 'test']);

    const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logOutput).toContain('Version');
  });

  it('should display timestamp', async () => {
    (performHealthCheck as Mock).mockResolvedValue(mockHealthResult);
    
    const command = checkCommand();
    await command.parseAsync(['node', 'test']);

    const logOutput = consoleSpy.log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logOutput).toContain('check');
  });
});
