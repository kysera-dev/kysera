import { Command } from 'commander';
import { prism, spinner, table } from '@xec-sh/kit';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { loadConfig } from '../../config/loader.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';

export interface ListPluginsOptions {
  installed?: boolean;
  available?: boolean;
  enabled?: boolean;
  disabled?: boolean;
  category?: string;
  search?: string;
  showDetails?: boolean;
  json?: boolean;
  config?: string;
}

interface Plugin {
  name: string;
  version: string;
  description?: string;
  author?: string;
  category: 'database' | 'schema' | 'query' | 'audit' | 'cache' | 'validation' | 'other';
  status: 'installed' | 'available' | 'enabled' | 'disabled';
  homepage?: string;
  repository?: string;
  dependencies?: string[];
  kysera?: {
    minVersion?: string;
    maxVersion?: string;
    hooks?: string[];
    providers?: string[];
    commands?: string[];
  };
  config?: Record<string, any>;
  size?: string;
  lastUpdated?: Date;
}

export function listPluginsCommand(): Command {
  const cmd = new Command('list')
    .description('List available and installed plugins')
    .option('--installed', 'Show only installed plugins', false)
    .option('--available', 'Show available plugins from registry', false)
    .option('--enabled', 'Show only enabled plugins', false)
    .option('--disabled', 'Show only disabled plugins', false)
    .option('-c, --category <type>', 'Filter by category')
    .option('-s, --search <query>', 'Search plugins by name or description')
    .option('--show-details', 'Show detailed plugin information', false)
    .option('--json', 'Output as JSON', false)
    .option('--config <path>', 'Path to configuration file')
    .action(async (options: ListPluginsOptions) => {
      try {
        await listPlugins(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to list plugins: ${error instanceof Error ? error.message : String(error)}`,
          'PLUGIN_LIST_ERROR'
        );
      }
    });

  return cmd;
}

async function listPlugins(options: ListPluginsOptions): Promise<void> {
  const listSpinner = spinner();
  listSpinner.start('Discovering plugins...');

  try {
    // Load configuration
    const config = await loadConfig(options.config);

    // Get all plugins
    const plugins: Plugin[] = [];

    // 1. Discover installed plugins
    if (!options.available || options.installed) {
      const installedPlugins = await discoverInstalledPlugins(config);
      plugins.push(...installedPlugins);
    }

    // 2. Discover available plugins from registry
    if (options.available && !options.installed) {
      const availablePlugins = await discoverAvailablePlugins();
      plugins.push(...availablePlugins);
    }

    // 3. Filter plugins
    let filteredPlugins = plugins;

    // Filter by status
    if (options.enabled) {
      filteredPlugins = filteredPlugins.filter((p) => p.status === 'enabled');
    } else if (options.disabled) {
      filteredPlugins = filteredPlugins.filter((p) => p.status === 'disabled');
    }

    // Filter by category
    if (options.category) {
      filteredPlugins = filteredPlugins.filter((p) => p.category === options.category);
    }

    // Search filter
    if (options.search) {
      const searchLower = options.search.toLowerCase();
      filteredPlugins = filteredPlugins.filter(
        (p) =>
          p.name.toLowerCase().includes(searchLower) ||
          (p.description && p.description.toLowerCase().includes(searchLower))
      );
    }

    listSpinner.stop();
    console.log(prism.green(`✓ Found ${filteredPlugins.length} plugin${filteredPlugins.length !== 1 ? 's' : ''}`));

    // Display results
    if (filteredPlugins.length === 0) {
      console.log('');
      console.log(prism.yellow('No plugins found matching your criteria'));

      if (!options.installed && !options.available) {
        console.log('');
        console.log(prism.gray('Tips:'));
        console.log('  • Use --available to see plugins from the registry');
        console.log('  • Use --installed to see only installed plugins');
        console.log('  • Install plugins with: kysera plugin install <name>');
      }
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(filteredPlugins, null, 2));
    } else if (options.showDetails) {
      displayDetailedPluginList(filteredPlugins);
    } else {
      displayPluginTable(filteredPlugins);
    }
  } catch (error) {
    listSpinner.stop();
    logger.error('Failed to list plugins');
    throw error;
  }
}

async function discoverInstalledPlugins(config: any): Promise<Plugin[]> {
  const plugins: Plugin[] = [];

  // Check node_modules for @kysera/* packages
  const nodeModulesPath = path.join(process.cwd(), 'node_modules');

  try {
    // Check @kysera scope
    const kyseraPath = path.join(nodeModulesPath, '@kysera');
    const packages = await fs.readdir(kyseraPath);

    // Known core packages to exclude
    const corePackages = ['core', 'repository', 'migrations'];

    for (const pkgName of packages) {
      if (corePackages.includes(pkgName)) {
        continue;
      }

      const pkgPath = path.join(kyseraPath, pkgName);
      const packageJsonPath = path.join(pkgPath, 'package.json');

      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

        const plugin: Plugin = {
          name: `@kysera/${pkgName}`,
          version: packageJson.version,
          description: packageJson.description,
          author: typeof packageJson.author === 'string' ? packageJson.author : packageJson.author?.name,
          category: categorizePlugin(pkgName, packageJson),
          status: await getPluginStatus(packageJson.name, config),
          homepage: packageJson.homepage,
          repository: typeof packageJson.repository === 'string' ? packageJson.repository : packageJson.repository?.url,
          dependencies: Object.keys(packageJson.dependencies || {}),
          kysera: packageJson.kysera || extractKyseraMetadata(packageJson),
        };

        plugins.push(plugin);
      } catch (error) {
        logger.debug(`Failed to read package ${pkgName}: ${error}`);
      }
    }

    // Check for custom plugins in plugins directory
    const pluginsDir = path.join(process.cwd(), 'plugins');
    try {
      const customPlugins = await fs.readdir(pluginsDir);

      for (const pluginName of customPlugins) {
        const pluginPath = path.join(pluginsDir, pluginName);
        const stat = await fs.stat(pluginPath);

        if (stat.isDirectory()) {
          const packageJsonPath = path.join(pluginPath, 'package.json');

          try {
            const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

            plugins.push({
              name: packageJson.name || pluginName,
              version: packageJson.version || '0.0.0',
              description: packageJson.description,
              author: typeof packageJson.author === 'string' ? packageJson.author : packageJson.author?.name,
              category: 'other',
              status: await getPluginStatus(pluginName, config),
              kysera: packageJson.kysera,
            });
          } catch (error) {
            logger.debug(`Failed to read package.json for plugin ${pluginName}:`, error);
            // Plugin without package.json
            plugins.push({
              name: pluginName,
              version: 'custom',
              category: 'other',
              status: 'installed',
            });
          }
        }
      }
    } catch (error) {
      logger.debug('No plugins directory found:', error);
    }
  } catch (error) {
    logger.debug(`Failed to discover installed plugins: ${error}`);
  }

  return plugins;
}

async function discoverAvailablePlugins(): Promise<Plugin[]> {
  // In a real implementation, this would fetch from npm registry or a custom registry
  // For now, return a curated list of known Kysera plugins

  return [
    {
      name: '@kysera/soft-delete',
      version: '1.0.0',
      description: 'Soft delete support with automatic filtering',
      author: 'Kysera Team',
      category: 'schema',
      status: 'available',
      homepage: 'https://github.com/kysera/kysera',
      kysera: {
        hooks: ['beforeDelete', 'afterRestore'],
        providers: ['SoftDeletePlugin'],
      },
    },
    {
      name: '@kysera/timestamps',
      version: '1.0.0',
      description: 'Automatic created_at and updated_at timestamps',
      author: 'Kysera Team',
      category: 'schema',
      status: 'available',
      homepage: 'https://github.com/kysera/kysera',
      kysera: {
        hooks: ['beforeInsert', 'beforeUpdate'],
        providers: ['TimestampsPlugin'],
      },
    },
    {
      name: '@kysera/audit',
      version: '1.0.0',
      description: 'Comprehensive audit logging for all database operations',
      author: 'Kysera Team',
      category: 'audit',
      status: 'available',
      homepage: 'https://github.com/kysera/kysera',
      kysera: {
        hooks: ['afterInsert', 'afterUpdate', 'afterDelete'],
        providers: ['AuditPlugin'],
      },
    },
    {
      name: '@kysera/cache',
      version: '1.0.0',
      description: 'Query result caching with Redis/memory backends',
      author: 'Kysera Team',
      category: 'cache',
      status: 'available',
      homepage: 'https://github.com/kysera/kysera',
      kysera: {
        hooks: ['beforeQuery', 'afterQuery'],
        providers: ['CachePlugin'],
      },
    },
    {
      name: '@kysera/validation',
      version: '1.0.0',
      description: 'Advanced validation with Zod/Joi/Yup integration',
      author: 'Kysera Team',
      category: 'validation',
      status: 'available',
      homepage: 'https://github.com/kysera/kysera',
      kysera: {
        hooks: ['beforeInsert', 'beforeUpdate'],
        providers: ['ValidationPlugin'],
      },
    },
    {
      name: '@kysera/seeder',
      version: '1.0.0',
      description: 'Database seeding utilities with Faker.js integration',
      author: 'Kysera Team',
      category: 'database',
      status: 'available',
      homepage: 'https://github.com/kysera/kysera',
      kysera: {
        commands: ['seed:run', 'seed:create', 'seed:rollback'],
      },
    },
    {
      name: '@kysera/graphql',
      version: '1.0.0',
      description: 'GraphQL schema generation from database models',
      author: 'Kysera Team',
      category: 'query',
      status: 'available',
      homepage: 'https://github.com/kysera/kysera',
      kysera: {
        providers: ['GraphQLPlugin'],
        commands: ['graphql:schema', 'graphql:types'],
      },
    },
    {
      name: '@kysera/rest',
      version: '1.0.0',
      description: 'REST API generation with Express/Fastify integration',
      author: 'Kysera Team',
      category: 'query',
      status: 'available',
      homepage: 'https://github.com/kysera/kysera',
      kysera: {
        providers: ['RestPlugin'],
        commands: ['rest:generate', 'rest:docs'],
      },
    },
  ];
}

function categorizePlugin(name: string, packageJson: any): Plugin['category'] {
  // Check package.json keywords
  const keywords = packageJson.keywords || [];

  if (keywords.includes('audit') || name.includes('audit')) return 'audit';
  if (keywords.includes('cache') || name.includes('cache')) return 'cache';
  if (keywords.includes('validation') || name.includes('valid')) return 'validation';
  if (keywords.includes('schema') || name.includes('schema')) return 'schema';
  if (keywords.includes('query') || name.includes('query')) return 'query';
  if (keywords.includes('database') || name.includes('db')) return 'database';

  // Check by name patterns
  if (name.includes('soft-delete') || name.includes('timestamp')) return 'schema';
  if (name.includes('graphql') || name.includes('rest')) return 'query';

  return 'other';
}

async function getPluginStatus(pluginName: string, config: any): Promise<Plugin['status']> {
  // Check if plugin is in config
  if (config?.plugins) {
    const pluginConfig = config.plugins[pluginName];
    if (pluginConfig) {
      if (pluginConfig.enabled === false) {
        return 'disabled';
      }
      return 'enabled';
    }
  }

  // Check if plugin is imported in the project
  try {
    const require = createRequire(import.meta.url);
    require.resolve(pluginName);
    return 'installed';
  } catch {
    return 'available';
  }
}

function extractKyseraMetadata(packageJson: any): Plugin['kysera'] {
  const metadata: Plugin['kysera'] = {};

  // Extract from exports or main file
  if (packageJson.exports) {
    const exports = Object.keys(packageJson.exports);

    if (exports.some((e) => e.includes('hook'))) {
      metadata.hooks = exports.filter((e) => e.includes('hook'));
    }

    if (exports.some((e) => e.includes('provider'))) {
      metadata.providers = exports.filter((e) => e.includes('provider'));
    }

    if (exports.some((e) => e.includes('command'))) {
      metadata.commands = exports.filter((e) => e.includes('command'));
    }
  }

  // Check engines for version compatibility
  if (packageJson.engines?.kysera) {
    const versionRange = packageJson.engines.kysera;
    if (versionRange.includes('-')) {
      const [min, max] = versionRange.split('-');
      metadata.minVersion = min.trim();
      metadata.maxVersion = max.trim();
    } else if (versionRange.startsWith('>')) {
      metadata.minVersion = versionRange.replace(/[>= ]/g, '');
    } else if (versionRange.startsWith('<')) {
      metadata.maxVersion = versionRange.replace(/[<= ]/g, '');
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function displayPluginTable(plugins: Plugin[]): void {
  console.log('');
  console.log(prism.bold('🔌 Kysera Plugins'));
  console.log(prism.gray('─'.repeat(80)));

  // Group by status
  const installed = plugins.filter(
    (p) => p.status === 'installed' || p.status === 'enabled' || p.status === 'disabled'
  );
  const available = plugins.filter((p) => p.status === 'available');

  if (installed.length > 0) {
    console.log('');
    console.log(prism.cyan('Installed Plugins:'));

    // Display installed plugins in a simple format
    for (const p of installed) {
      const desc = p.description
        ? p.description.length > 40
          ? p.description.substring(0, 37) + '...'
          : p.description
        : 'No description';

      console.log(`  ${prism.bold(p.name)} ${prism.gray(`v${p.version}`)}`);
      console.log(`    Status: ${formatStatus(p.status)}`);
      console.log(`    Category: ${p.category}`);
      console.log(`    ${desc}`);
      console.log();
    }
  }

  if (available.length > 0) {
    console.log('');
    console.log(prism.cyan('Available Plugins:'));

    // Display available plugins in a simple format
    for (const p of available) {
      const desc = p.description
        ? p.description.length > 40
          ? p.description.substring(0, 37) + '...'
          : p.description
        : 'No description';

      console.log(`  ${prism.bold(p.name)} ${prism.gray(`v${p.version}`)}`);
      console.log(`    Category: ${p.category}`);
      console.log(`    ${desc}`);
      console.log();
    }
  }

  // Summary
  console.log('');
  console.log(prism.gray('─'.repeat(80)));
  console.log(prism.cyan('Summary:'));
  console.log(`  Installed: ${installed.length}`);
  console.log(`  Enabled: ${installed.filter((p) => p.status === 'enabled').length}`);
  console.log(`  Disabled: ${installed.filter((p) => p.status === 'disabled').length}`);
  console.log(`  Available: ${available.length}`);

  // Tips
  console.log('');
  console.log(prism.cyan('Usage:'));
  console.log('  kysera plugin install <name>    Install a plugin');
  console.log('  kysera plugin enable <name>     Enable a plugin');
  console.log('  kysera plugin config <name>     Configure a plugin');
  console.log('  kysera plugin list --details    Show detailed information');
}

function displayDetailedPluginList(plugins: Plugin[]): void {
  console.log('');
  console.log(prism.bold('🔌 Kysera Plugins - Detailed View'));
  console.log(prism.gray('═'.repeat(80)));

  for (const plugin of plugins) {
    console.log('');
    console.log(prism.cyan(prism.bold(plugin.name)) + ' ' + prism.gray(`v${plugin.version}`));
    console.log(`  Status: ${formatStatus(plugin.status)}`);
    console.log(`  Category: ${plugin.category}`);

    if (plugin.description) {
      console.log(`  Description: ${plugin.description}`);
    }

    if (plugin.author) {
      console.log(`  Author: ${plugin.author}`);
    }

    if (plugin.homepage) {
      console.log(`  Homepage: ${prism.blue(prism.underline(plugin.homepage))}`);
    }

    // Kysera-specific metadata
    if (plugin.kysera) {
      console.log('');
      console.log('  Kysera Integration:');

      if (plugin.kysera.hooks && plugin.kysera.hooks.length > 0) {
        console.log(`    Hooks: ${plugin.kysera.hooks.join(', ')}`);
      }

      if (plugin.kysera.providers && plugin.kysera.providers.length > 0) {
        console.log(`    Providers: ${plugin.kysera.providers.join(', ')}`);
      }

      if (plugin.kysera.commands && plugin.kysera.commands.length > 0) {
        console.log(`    Commands: ${plugin.kysera.commands.join(', ')}`);
      }

      if (plugin.kysera.minVersion || plugin.kysera.maxVersion) {
        const versionRange = [
          plugin.kysera.minVersion ? `>=${plugin.kysera.minVersion}` : '',
          plugin.kysera.maxVersion ? `<=${plugin.kysera.maxVersion}` : '',
        ]
          .filter(Boolean)
          .join(' ');
        console.log(`    Kysera Version: ${versionRange}`);
      }
    }

    if (plugin.dependencies && plugin.dependencies.length > 0) {
      console.log('');
      console.log(
        `  Dependencies: ${plugin.dependencies.slice(0, 5).join(', ')}${plugin.dependencies.length > 5 ? `, +${plugin.dependencies.length - 5} more` : ''}`
      );
    }
  }

  console.log('');
  console.log(prism.gray('═'.repeat(80)));
}

function formatStatus(status: Plugin['status']): string {
  switch (status) {
    case 'enabled':
      return prism.green('● Enabled');
    case 'disabled':
      return prism.yellow('● Disabled');
    case 'installed':
      return prism.gray('● Installed');
    case 'available':
      return prism.blue('◯ Available');
    default:
      return status;
  }
}
