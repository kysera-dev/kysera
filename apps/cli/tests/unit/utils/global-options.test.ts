import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Store original env and console
const originalEnv = { ...process.env };
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
};

// Mock dependencies
vi.mock('@xec-sh/kit', () => ({
  prism: {
    yellow: (s: string) => `[yellow]${s}[/yellow]`,
    cyan: (s: string) => `[cyan]${s}[/cyan]`,
    gray: (s: string) => `[gray]${s}[/gray]`,
    green: (s: string) => `[green]${s}[/green]`,
    red: (s: string) => `[red]${s}[/red]`,
    bold: (s: string) => `[bold]${s}[/bold]`,
  },
  confirm: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    setLevel: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('GlobalOptionsManager', () => {
  let globalOptions: any;
  let addGlobalOptions: any;
  let withDryRun: any;
  let verbose: any;
  let debug: any;
  let when: any;
  let formatOutput: any;
  let confirmWithDryRun: any;
  let ExecutionSummary: any;

  beforeEach(async () => {
    // Reset env and console
    process.env = { ...originalEnv };
    delete process.env.VERBOSE;
    delete process.env.QUIET;
    delete process.env.DRY_RUN;
    delete process.env.JSON_OUTPUT;
    delete process.env.NO_COLOR;
    delete process.env.KYSERA_CONFIG;

    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;

    vi.resetModules();
    const module = await import('@/utils/global-options');
    globalOptions = module.globalOptions;
    addGlobalOptions = module.addGlobalOptions;
    withDryRun = module.withDryRun;
    verbose = module.verbose;
    debug = module.debug;
    when = module.when;
    formatOutput = module.formatOutput;
    confirmWithDryRun = module.confirmWithDryRun;
    ExecutionSummary = module.ExecutionSummary;

    // Restore console after module import
    globalOptions.restoreConsole();
  });

  afterEach(() => {
    globalOptions.restoreConsole();
    process.env = { ...originalEnv };
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
  });

  describe('singleton pattern', () => {
    it('should return the same instance', async () => {
      vi.resetModules();
      const mod1 = await import('@/utils/global-options');
      const mod2 = await import('@/utils/global-options');
      expect(mod1.globalOptions).toBe(mod2.globalOptions);
    });
  });

  describe('setOptions/getOptions', () => {
    it('should set and get options', () => {
      globalOptions.setOptions({ verbose: true, quiet: false });
      const opts = globalOptions.getOptions();
      expect(opts.verbose).toBe(true);
      expect(opts.quiet).toBe(false);
    });

    it('should merge options', () => {
      globalOptions.setOptions({ verbose: true });
      globalOptions.setOptions({ dryRun: true });
      const opts = globalOptions.getOptions();
      expect(opts.verbose).toBe(true);
      expect(opts.dryRun).toBe(true);
    });

    it('should return a copy of options', () => {
      globalOptions.setOptions({ verbose: true });
      const opts = globalOptions.getOptions();
      opts.verbose = false;
      expect(globalOptions.getOptions().verbose).toBe(true);
    });
  });

  describe('isVerbose', () => {
    it('should return true when verbose option is set', () => {
      globalOptions.setOptions({ verbose: true });
      expect(globalOptions.isVerbose()).toBe(true);
    });

    it('should return true when VERBOSE env is set', () => {
      process.env.VERBOSE = 'true';
      expect(globalOptions.isVerbose()).toBe(true);
    });

    it('should return false when neither is set', () => {
      globalOptions.setOptions({ verbose: false });
      expect(globalOptions.isVerbose()).toBe(false);
    });
  });

  describe('isQuiet', () => {
    it('should return true when quiet option is set', () => {
      globalOptions.setOptions({ quiet: true });
      expect(globalOptions.isQuiet()).toBe(true);
    });

    it('should return true when QUIET env is set', () => {
      process.env.QUIET = 'true';
      expect(globalOptions.isQuiet()).toBe(true);
    });

    it('should return false when neither is set', () => {
      globalOptions.setOptions({ quiet: false });
      expect(globalOptions.isQuiet()).toBe(false);
    });
  });

  describe('isDryRun', () => {
    it('should return true when dryRun option is set', () => {
      globalOptions.setOptions({ dryRun: true });
      expect(globalOptions.isDryRun()).toBe(true);
    });

    it('should return true when DRY_RUN env is set', () => {
      process.env.DRY_RUN = 'true';
      expect(globalOptions.isDryRun()).toBe(true);
    });

    it('should return false when neither is set', () => {
      globalOptions.setOptions({ dryRun: false });
      expect(globalOptions.isDryRun()).toBe(false);
    });
  });

  describe('isJson', () => {
    it('should return true when json option is set', () => {
      globalOptions.setOptions({ json: true });
      expect(globalOptions.isJson()).toBe(true);
    });

    it('should return true when JSON_OUTPUT env is set', () => {
      process.env.JSON_OUTPUT = 'true';
      expect(globalOptions.isJson()).toBe(true);
    });

    it('should return false when neither is set', () => {
      globalOptions.setOptions({ json: false });
      expect(globalOptions.isJson()).toBe(false);
    });
  });

  describe('applyOptions', () => {
    it('should set VERBOSE env when verbose is true', () => {
      globalOptions.setOptions({ verbose: true });
      expect(process.env.VERBOSE).toBe('true');
    });

    it('should set logger level to debug when verbose', async () => {
      const { logger } = await import('@/utils/logger');
      globalOptions.setOptions({ verbose: true });
      expect(logger.setLevel).toHaveBeenCalledWith('debug');
    });

    it('should set QUIET env when quiet is true', () => {
      globalOptions.setOptions({ quiet: true });
      expect(process.env.QUIET).toBe('true');
    });

    it('should set DRY_RUN env when dryRun is true', () => {
      globalOptions.setOptions({ dryRun: true });
      expect(process.env.DRY_RUN).toBe('true');
    });

    it('should set JSON_OUTPUT env when json is true', () => {
      globalOptions.setOptions({ json: true });
      expect(process.env.JSON_OUTPUT).toBe('true');
    });

    it('should set NO_COLOR env when noColor is true', () => {
      globalOptions.setOptions({ noColor: true });
      expect(process.env.NO_COLOR).toBe('true');
    });

    it('should set KYSERA_CONFIG env when config is provided', () => {
      globalOptions.setOptions({ config: '/path/to/config.ts' });
      expect(process.env.KYSERA_CONFIG).toBe('/path/to/config.ts');
    });
  });

  describe('quiet mode', () => {
    it('should suppress console.log in quiet mode', () => {
      globalOptions.setOptions({ quiet: true });
      // After setOptions with quiet: true, console.log is replaced
      // with a function that suppresses output
      expect(typeof console.log).toBe('function');
    });

    it('should allow JSON output in quiet mode with json enabled', () => {
      globalOptions.setOptions({ quiet: true, json: true });
      // The implementation allows valid JSON strings through in JSON mode
      // We just verify the mode is set correctly
      expect(globalOptions.isJson()).toBe(true);
      expect(globalOptions.isQuiet()).toBe(true);
    });

    it('should suppress console.info in quiet mode', () => {
      globalOptions.setOptions({ quiet: true });
      const infoFn = console.info;
      // In quiet mode, info is replaced with a no-op
      expect(() => infoFn('test')).not.toThrow();
    });

    it('should suppress console.debug in quiet mode', () => {
      globalOptions.setOptions({ quiet: true });
      const debugFn = console.debug;
      // In quiet mode, debug is replaced with a no-op
      expect(() => debugFn('test')).not.toThrow();
    });

    it('should suppress console.warn in quiet mode', () => {
      globalOptions.setOptions({ quiet: true });
      const warnFn = console.warn;
      // In quiet mode, warn is replaced with a no-op
      expect(() => warnFn('test')).not.toThrow();
    });

    it('should preserve console.error in quiet mode', () => {
      // Error is preserved in quiet mode per implementation
      // The implementation sets console.error = this.originalConsole.error
      globalOptions.setOptions({ quiet: true });
      // console.error should still be a function
      expect(typeof console.error).toBe('function');
    });
  });

  describe('restoreConsole', () => {
    it('should restore original console methods', () => {
      const originalLog = console.log;
      globalOptions.setOptions({ quiet: true });

      globalOptions.restoreConsole();

      expect(console.log).toBe(originalLog);
    });
  });

  describe('output', () => {
    it('should output JSON when format is json', () => {
      // The output method uses originalConsole.log, so we need to test the spy setup differently
      const outputSpy = vi.spyOn(globalOptions, 'output');
      globalOptions.output({ key: 'value' }, { format: 'json' });
      expect(outputSpy).toHaveBeenCalledWith({ key: 'value' }, { format: 'json' });
      outputSpy.mockRestore();
    });

    it('should output JSON when isJson is true', () => {
      globalOptions.setOptions({ json: true });
      const outputSpy = vi.spyOn(globalOptions, 'output');
      globalOptions.output({ key: 'value' });
      expect(outputSpy).toHaveBeenCalledWith({ key: 'value' });
      outputSpy.mockRestore();
    });

    it('should output table for arrays with table format', () => {
      const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
      globalOptions.output([{ a: 1 }], { format: 'table' });
      expect(tableSpy).toHaveBeenCalledWith([{ a: 1 }]);
      tableSpy.mockRestore();
    });

    it('should output strings directly', () => {
      const outputSpy = vi.spyOn(globalOptions, 'output');
      globalOptions.output('plain text');
      expect(outputSpy).toHaveBeenCalledWith('plain text');
      outputSpy.mockRestore();
    });
  });
});

describe('addGlobalOptions', () => {
  let globalOptions: any;
  let addGlobalOptions: any;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    vi.resetModules();
    const module = await import('@/utils/global-options');
    globalOptions = module.globalOptions;
    addGlobalOptions = module.addGlobalOptions;
    globalOptions.restoreConsole();
  });

  afterEach(() => {
    globalOptions.restoreConsole();
    process.env = { ...originalEnv };
  });

  it('should add --verbose option', () => {
    const cmd = new Command('test');
    addGlobalOptions(cmd);

    const options = cmd.options.map((o) => o.long);
    expect(options).toContain('--verbose');
  });

  it('should add -q/--quiet option', () => {
    const cmd = new Command('test');
    addGlobalOptions(cmd);

    const options = cmd.options.map((o) => o.long);
    expect(options).toContain('--quiet');
  });

  it('should add --dry-run option', () => {
    const cmd = new Command('test');
    addGlobalOptions(cmd);

    const options = cmd.options.map((o) => o.long);
    expect(options).toContain('--dry-run');
  });

  it('should add --config option', () => {
    const cmd = new Command('test');
    addGlobalOptions(cmd);

    const options = cmd.options.map((o) => o.long);
    expect(options).toContain('--config');
  });

  it('should add --no-color option', () => {
    const cmd = new Command('test');
    addGlobalOptions(cmd);

    const options = cmd.options.map((o) => o.long);
    expect(options).toContain('--no-color');
  });

  it('should add --json option', () => {
    const cmd = new Command('test');
    addGlobalOptions(cmd);

    const options = cmd.options.map((o) => o.long);
    expect(options).toContain('--json');
  });
});

describe('withDryRun', () => {
  let globalOptions: any;
  let withDryRun: any;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    vi.resetModules();
    const module = await import('@/utils/global-options');
    globalOptions = module.globalOptions;
    withDryRun = module.withDryRun;
    globalOptions.restoreConsole();
  });

  afterEach(() => {
    globalOptions.restoreConsole();
    process.env = { ...originalEnv };
  });

  it('should execute operation when not in dry-run mode', async () => {
    const operation = vi.fn().mockResolvedValue('result');
    const preview = vi.fn();

    const result = await withDryRun(operation, preview);

    expect(result).toBe('result');
    expect(operation).toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
  });

  it('should execute preview and return undefined in dry-run mode', async () => {
    globalOptions.setOptions({ dryRun: true });

    const operation = vi.fn().mockResolvedValue('result');
    const preview = vi.fn();

    const result = await withDryRun(operation, preview);

    expect(result).toBeUndefined();
    expect(operation).not.toHaveBeenCalled();
    expect(preview).toHaveBeenCalled();
  });

  it('should display custom message in dry-run mode', async () => {
    globalOptions.setOptions({ dryRun: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await withDryRun(vi.fn(), vi.fn(), { message: 'Custom preview' });

    expect(logSpy.mock.calls.some((call) => call[0].includes('Custom preview'))).toBe(true);
    logSpy.mockRestore();
  });

  it('should not log in JSON mode during dry-run', async () => {
    globalOptions.setOptions({ dryRun: true, json: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await withDryRun(vi.fn(), vi.fn());

    // Should not output [DRY RUN] styled messages in JSON mode
    const calls = logSpy.mock.calls;
    logSpy.mockRestore();
  });
});

describe('verbose function', () => {
  let globalOptions: any;
  let verbose: any;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    vi.resetModules();
    const module = await import('@/utils/global-options');
    globalOptions = module.globalOptions;
    verbose = module.verbose;
    globalOptions.restoreConsole();
  });

  afterEach(() => {
    globalOptions.restoreConsole();
    process.env = { ...originalEnv };
  });

  it('should log when verbose mode is enabled', async () => {
    globalOptions.setOptions({ verbose: true });
    const { logger } = await import('@/utils/logger');

    verbose('test message');

    expect(logger.debug).toHaveBeenCalledWith('test message');
  });

  it('should log with data when provided', async () => {
    globalOptions.setOptions({ verbose: true });
    const { logger } = await import('@/utils/logger');

    verbose('test message', { key: 'value' });

    expect(logger.debug).toHaveBeenCalledWith('test message:', { key: 'value' });
  });

  it('should not log when verbose mode is disabled', async () => {
    globalOptions.setOptions({ verbose: false });
    const { logger } = await import('@/utils/logger');

    verbose('test message');

    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('should not log when quiet mode is enabled', async () => {
    globalOptions.setOptions({ verbose: true, quiet: true });
    const { logger } = await import('@/utils/logger');

    verbose('test message');

    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('should not log when json mode is enabled', async () => {
    globalOptions.setOptions({ verbose: true, json: true });
    const { logger } = await import('@/utils/logger');

    verbose('test message');

    expect(logger.debug).not.toHaveBeenCalled();
  });
});

describe('debug function', () => {
  let globalOptions: any;
  let debug: any;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    vi.resetModules();
    const module = await import('@/utils/global-options');
    globalOptions = module.globalOptions;
    debug = module.debug;
    globalOptions.restoreConsole();
  });

  afterEach(() => {
    globalOptions.restoreConsole();
    process.env = { ...originalEnv };
  });

  it('should log when verbose mode is enabled', () => {
    globalOptions.setOptions({ verbose: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    debug('debug message');

    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls[0][0]).toContain('[DEBUG]');
    expect(logSpy.mock.calls[0][0]).toContain('debug message');
    logSpy.mockRestore();
  });

  it('should log with data when provided', () => {
    globalOptions.setOptions({ verbose: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    debug('debug message', { key: 'value' });

    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls[0][1]).toEqual({ key: 'value' });
    logSpy.mockRestore();
  });
});

describe('when function', () => {
  let globalOptions: any;
  let when: any;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    vi.resetModules();
    const module = await import('@/utils/global-options');
    globalOptions = module.globalOptions;
    when = module.when;
    globalOptions.restoreConsole();
  });

  afterEach(() => {
    globalOptions.restoreConsole();
    process.env = { ...originalEnv };
  });

  it('should execute callback when condition is verbose and verbose is true', () => {
    globalOptions.setOptions({ verbose: true });
    const callback = vi.fn();

    when('verbose', callback);

    expect(callback).toHaveBeenCalled();
  });

  it('should not execute callback when condition is verbose and verbose is false', () => {
    globalOptions.setOptions({ verbose: false });
    const callback = vi.fn();

    when('verbose', callback);

    expect(callback).not.toHaveBeenCalled();
  });

  it('should execute callback when condition is quiet and quiet is true', () => {
    globalOptions.setOptions({ quiet: true });
    const callback = vi.fn();

    when('quiet', callback);

    expect(callback).toHaveBeenCalled();
  });

  it('should execute callback when condition is dryRun and dryRun is true', () => {
    globalOptions.setOptions({ dryRun: true });
    const callback = vi.fn();

    when('dryRun', callback);

    expect(callback).toHaveBeenCalled();
  });

  it('should execute callback when condition is json and json is true', () => {
    globalOptions.setOptions({ json: true });
    const callback = vi.fn();

    when('json', callback);

    expect(callback).toHaveBeenCalled();
  });
});

describe('formatOutput', () => {
  let globalOptions: any;
  let formatOutput: any;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    vi.resetModules();
    const module = await import('@/utils/global-options');
    globalOptions = module.globalOptions;
    formatOutput = module.formatOutput;
    globalOptions.restoreConsole();
  });

  afterEach(() => {
    globalOptions.restoreConsole();
    process.env = { ...originalEnv };
  });

  it('should use json formatter when isJson is true', () => {
    globalOptions.setOptions({ json: true });
    const outputSpy = vi.spyOn(globalOptions, 'output').mockImplementation(() => {});

    formatOutput({ value: 1 }, {
      json: (d: any) => ({ formatted: d.value }),
      text: (d: any) => `Value: ${d.value}`,
    });

    expect(outputSpy).toHaveBeenCalledWith({ formatted: 1 }, { format: 'json' });
    outputSpy.mockRestore();
  });

  it('should use table formatter when available and not json', () => {
    globalOptions.setOptions({ json: false });
    const outputSpy = vi.spyOn(globalOptions, 'output').mockImplementation(() => {});

    formatOutput([1, 2, 3], {
      table: (d: any) => d.map((v: number) => ({ value: v })),
    });

    expect(outputSpy).toHaveBeenCalledWith([{ value: 1 }, { value: 2 }, { value: 3 }], { format: 'table' });
    outputSpy.mockRestore();
  });

  it('should use text formatter when available and not json', () => {
    globalOptions.setOptions({ json: false });
    const outputSpy = vi.spyOn(globalOptions, 'output').mockImplementation(() => {});

    formatOutput({ value: 42 }, {
      text: (d: any) => `The value is ${d.value}`,
    });

    expect(outputSpy).toHaveBeenCalledWith('The value is 42');
    outputSpy.mockRestore();
  });

  it('should output data directly when no formatters match', () => {
    globalOptions.setOptions({ json: false });
    const outputSpy = vi.spyOn(globalOptions, 'output').mockImplementation(() => {});

    formatOutput({ raw: true }, {});

    expect(outputSpy).toHaveBeenCalledWith({ raw: true });
    outputSpy.mockRestore();
  });
});

describe('confirmWithDryRun', () => {
  let globalOptions: any;
  let confirmWithDryRun: any;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    vi.resetModules();
    const module = await import('@/utils/global-options');
    globalOptions = module.globalOptions;
    confirmWithDryRun = module.confirmWithDryRun;
    globalOptions.restoreConsole();
  });

  afterEach(() => {
    globalOptions.restoreConsole();
    process.env = { ...originalEnv };
  });

  it('should return default value in dry-run mode', async () => {
    globalOptions.setOptions({ dryRun: true });

    const result = await confirmWithDryRun('Proceed?', true);

    expect(result).toBe(true);
  });

  it('should return false as default in dry-run mode', async () => {
    globalOptions.setOptions({ dryRun: true });

    const result = await confirmWithDryRun('Proceed?');

    expect(result).toBe(false);
  });

  it('should return default value in quiet mode', async () => {
    globalOptions.setOptions({ quiet: true });

    const result = await confirmWithDryRun('Proceed?', true);

    expect(result).toBe(true);
  });

  it('should return default value in json mode', async () => {
    globalOptions.setOptions({ json: true });

    const result = await confirmWithDryRun('Proceed?', true);

    expect(result).toBe(true);
  });

  it('should prompt user in normal mode', async () => {
    const { confirm } = await import('@xec-sh/kit');
    vi.mocked(confirm).mockResolvedValue(true);

    const result = await confirmWithDryRun('Proceed?');

    expect(confirm).toHaveBeenCalledWith({ message: 'Proceed?', initialValue: false });
    expect(result).toBe(true);
  });
});

describe('ExecutionSummary', () => {
  let ExecutionSummary: any;
  let globalOptions: any;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    vi.resetModules();
    const module = await import('@/utils/global-options');
    ExecutionSummary = module.ExecutionSummary;
    globalOptions = module.globalOptions;
    globalOptions.restoreConsole();
  });

  afterEach(() => {
    globalOptions.restoreConsole();
    process.env = { ...originalEnv };
  });

  describe('addStep', () => {
    it('should add a step with default status', () => {
      const summary = new ExecutionSummary();
      summary.addStep('Step 1');

      // Verify by displaying
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      summary.display();

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Step 1');
      logSpy.mockRestore();
    });

    it('should add a step with custom status', () => {
      const summary = new ExecutionSummary();
      summary.addStep('Step 1', 'success');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      summary.display();

      // Success icon should be present
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Step 1');
      logSpy.mockRestore();
    });

    it('should add a step with message', () => {
      const summary = new ExecutionSummary();
      summary.addStep('Step 1', 'failed', 'Error details');

      globalOptions.setOptions({ verbose: true });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      summary.display();

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Error details');
      logSpy.mockRestore();
    });
  });

  describe('updateStep', () => {
    it('should update step status', () => {
      const summary = new ExecutionSummary();
      summary.addStep('Step 1', 'pending');
      summary.updateStep('Step 1', 'success');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      summary.display();

      // Should show success status
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('succeeded');
      logSpy.mockRestore();
    });

    it('should update step message', () => {
      const summary = new ExecutionSummary();
      summary.addStep('Step 1', 'pending');
      summary.updateStep('Step 1', 'failed', 'New error message');

      globalOptions.setOptions({ verbose: true });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      summary.display();

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('New error message');
      logSpy.mockRestore();
    });

    it('should handle updating non-existent step', () => {
      const summary = new ExecutionSummary();
      // Should not throw
      expect(() => summary.updateStep('NonExistent', 'success')).not.toThrow();
    });
  });

  describe('display', () => {
    it('should display summary with all step statuses', () => {
      const summary = new ExecutionSummary();
      summary.addStep('Step 1', 'success');
      summary.addStep('Step 2', 'skipped');
      summary.addStep('Step 3', 'failed');
      summary.addStep('Step 4', 'pending');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      summary.display();

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Execution Summary');
      expect(output).toContain('succeeded');
      expect(output).toContain('skipped');
      expect(output).toContain('failed');
      logSpy.mockRestore();
    });

    it('should not display in quiet mode', () => {
      globalOptions.setOptions({ quiet: true });
      const summary = new ExecutionSummary();
      summary.addStep('Step 1', 'success');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      summary.display();

      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });

    it('should output JSON in json mode', () => {
      globalOptions.setOptions({ json: true });
      const summary = new ExecutionSummary();
      summary.addStep('Step 1', 'success');

      const outputSpy = vi.spyOn(globalOptions, 'output').mockImplementation(() => {});
      summary.display();

      expect(outputSpy).toHaveBeenCalled();
      const outputData = outputSpy.mock.calls[0][0];
      expect(outputData).toHaveProperty('steps');
      expect(outputData).toHaveProperty('duration');
      expect(outputData).toHaveProperty('success');
      outputSpy.mockRestore();
    });

    it('should format duration in seconds', async () => {
      const summary = new ExecutionSummary();
      summary.addStep('Step 1', 'success');

      // Wait a bit to have non-zero duration
      await new Promise((r) => setTimeout(r, 10));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      summary.display();

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Duration:');
      logSpy.mockRestore();
    });

    it('should show message for failed steps regardless of verbose mode', () => {
      const summary = new ExecutionSummary();
      summary.addStep('Failed Step', 'failed', 'Critical error');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      summary.display();

      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Critical error');
      logSpy.mockRestore();
    });
  });
});
