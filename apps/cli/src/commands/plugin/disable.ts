import { Command } from 'commander';
import { prism, spinner, confirm, select } from '@xec-sh/kit';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { loadConfig, saveConfig } from '../../config/loader.js';

export interface DisablePluginOptions {
  all?: boolean;
  force?: boolean;
  keepConfig?: boolean;
  restart?: boolean;
  json?: boolean;
  config?: string;
}

interface DisableResult {
  plugin: string;
  status: 'disabled' | 'failed' | 'not_enabled';
  message?: string;
  dependencies?: string[];
}

export function disablePluginCommand(): Command {
  const cmd = new Command('disable')
    .description('Disable a plugin')
    .argument('[name]', 'Plugin name to disable')
    .option('--all', 'Disable all enabled plugins', false)
    .option('-f, --force', 'Force disable without dependency checks', false)
    .option('--keep-config', 'Keep plugin configuration', false)
    .option('--restart', 'Restart application after disabling', false)
    .option('--json', 'Output as JSON', false)
    .option('--config <path>', 'Path to configuration file')
    .action(async (name: string | undefined, options: DisablePluginOptions) => {
      try {
        await disablePlugin(name, options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to disable plugin: ${error instanceof Error ? error.message : String(error)}`,
          'PLUGIN_DISABLE_ERROR'
        );
      }
    });

  return cmd;
}

async function disablePlugin(name: string | undefined, options: DisablePluginOptions): Promise<void> {
  const disableSpinner = spinner();

  try {
    // Load configuration
    const config = await loadConfig(options.config);

    if (!config?.plugins) {
      console.log(prism.yellow('No plugins configured'));
      return;
    }

    const results: DisableResult[] = [];

    if (options.all) {
      // Disable all enabled plugins
      disableSpinner.start('Finding enabled plugins...');

      const enabledPlugins = Object.entries(config.plugins)
        .filter(([_, conf]: [string, any]) => conf.enabled === true)
        .map(([name]) => name);

      if (enabledPlugins.length === 0) {
        disableSpinner.stop();
        console.log(prism.yellow('No enabled plugins found'));
        return;
      }

      disableSpinner.stop();
      console.log(
        prism.green(`✓ Found ${enabledPlugins.length} enabled plugin${enabledPlugins.length !== 1 ? 's' : ''}`)
      );

      // Confirm action
      if (!options.force && !options.json) {
        console.log('');
        console.log(prism.yellow('⚠️  This will disable the following plugins:'));
        for (const plugin of enabledPlugins) {
          console.log(`  • ${plugin}`);
        }

        const shouldDisable = await confirm(
          `Disable ${enabledPlugins.length} plugin${enabledPlugins.length !== 1 ? 's' : ''}?`
        );

        if (!shouldDisable) {
          console.log(prism.gray('Operation cancelled'));
          return;
        }
      }

      // Disable each plugin
      for (const plugin of enabledPlugins) {
        const result = await disableSinglePlugin(plugin, config, options);
        results.push(result);
      }
    } else if (name) {
      // Disable specific plugin
      disableSpinner.start(`Disabling plugin: ${name}...`);

      const result = await disableSinglePlugin(name, config, options);
      results.push(result);

      if (result.status === 'disabled') {
        disableSpinner.stop();
        console.log(prism.green(`✓ Plugin disabled: ${name}`));
      } else if (result.status === 'not_enabled') {
        disableSpinner.stop();
        console.log(prism.yellow(`Plugin not enabled: ${name}`));
      } else {
        disableSpinner.stop();
        console.log(prism.red(`Failed to disable plugin: ${name}`));
      }
    } else {
      // Interactive selection
      disableSpinner.start('Finding enabled plugins...');

      const enabledPlugins = Object.entries(config.plugins)
        .filter(([_, conf]: [string, any]) => conf.enabled === true)
        .map(([name]) => name);

      disableSpinner.stop();

      if (enabledPlugins.length === 0) {
        console.log(prism.yellow('No enabled plugins found'));
        return;
      }

      const selected = await select(
        'Select plugin to disable:',
        enabledPlugins.map((p) => ({
          label: p,
          value: p,
          description: getPluginDescription(p),
        }))
      );

      disableSpinner.start(`Disabling plugin: ${selected}...`);
      const result = await disableSinglePlugin(selected, config, options);
      results.push(result);

      if (result.status === 'disabled') {
        disableSpinner.stop();
        console.log(prism.green(`✓ Plugin disabled: ${selected}`));
      } else {
        disableSpinner.stop();
        console.log(prism.red(`Failed to disable plugin: ${selected}`));
      }
    }

    // Save configuration
    if (results.some((r) => r.status === 'disabled')) {
      await saveConfig(config, options.config);
    }

    // Display results
    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      displayDisableResults(results, options);
    }

    // Restart if requested
    if (options.restart && results.some((r) => r.status === 'disabled')) {
      console.log('');
      console.log(prism.yellow('⚠️  Application restart required'));
      console.log('Please restart your application for changes to take effect');
    }
  } catch (error) {
    disableSpinner.stop();
    logger.error('Failed to disable plugin');
    throw error;
  }
}

async function disableSinglePlugin(
  pluginName: string,
  config: any,
  options: DisablePluginOptions
): Promise<DisableResult> {
  const result: DisableResult = {
    plugin: pluginName,
    status: 'failed',
  };

  try {
    // Check if plugin is configured
    if (!config.plugins[pluginName]) {
      result.status = 'not_enabled';
      result.message = 'Plugin is not configured';
      return result;
    }

    // Check if already disabled
    if (config.plugins[pluginName].enabled === false) {
      result.status = 'not_enabled';
      result.message = 'Plugin is already disabled';
      return result;
    }

    // Check for dependent plugins
    if (!options.force) {
      const dependents = await findDependentPlugins(pluginName, config);

      if (dependents.length > 0) {
        result.status = 'failed';
        result.message = `Other plugins depend on this: ${dependents.join(', ')}`;
        result.dependencies = dependents;

        if (!options.json) {
          console.log('');
          console.log(prism.yellow('⚠️  Warning: The following plugins depend on ' + pluginName + ':'));
          for (const dep of dependents) {
            console.log(`  • ${dep}`);
          }

          const shouldContinue = await confirm('Disable anyway?');
          if (!shouldContinue) {
            return result;
          }
        } else {
          return result;
        }
      }
    }

    // Check for critical plugins
    const criticalPlugins = ['@kysera/core', '@kysera/repository'];
    if (criticalPlugins.includes(pluginName) && !options.force) {
      result.status = 'failed';
      result.message = 'This is a critical plugin and cannot be disabled without --force';
      return result;
    }

    // Disable the plugin
    config.plugins[pluginName].enabled = false;

    // Remove configuration if requested
    if (!options.keepConfig) {
      // Keep only the enabled flag
      const { enabled, ...rest } = config.plugins[pluginName];
      if (Object.keys(rest).length === 0) {
        delete config.plugins[pluginName];
      } else {
        config.plugins[pluginName] = { enabled: false };
      }
    }

    result.status = 'disabled';
    result.message = 'Plugin disabled successfully';

    // Log hooks and providers that will be removed
    logRemovedFeatures(pluginName);
  } catch (error) {
    result.message = error instanceof Error ? error.message : String(error);
  }

  return result;
}

async function findDependentPlugins(pluginName: string, config: any): Promise<string[]> {
  const dependents: string[] = [];

  // Check each enabled plugin for dependencies
  for (const [name, conf] of Object.entries(config.plugins)) {
    if (name === pluginName || (conf as any).enabled !== true) {
      continue;
    }

    // Check if this plugin depends on the one being disabled
    const pluginConfig = conf as any;

    if (pluginConfig.dependencies) {
      if (Array.isArray(pluginConfig.dependencies)) {
        if (pluginConfig.dependencies.includes(pluginName)) {
          dependents.push(name);
        }
      }
    }

    // Check for implicit dependencies
    if (pluginName.includes('core') && !name.includes('core')) {
      // Most plugins depend on core
      dependents.push(name);
    }

    if (pluginName.includes('repository') && name.includes('audit')) {
      // Audit depends on repository
      dependents.push(name);
    }
  }

  return dependents;
}

function logRemovedFeatures(pluginName: string): void {
  const features: Record<string, { hooks?: string[]; providers?: string[]; commands?: string[] }> = {
    '@kysera/soft-delete': {
      hooks: ['beforeDelete', 'afterRestore'],
      providers: ['SoftDeletePlugin'],
    },
    '@kysera/timestamps': {
      hooks: ['beforeInsert', 'beforeUpdate'],
      providers: ['TimestampsPlugin'],
    },
    '@kysera/audit': {
      hooks: ['afterInsert', 'afterUpdate', 'afterDelete'],
      providers: ['AuditPlugin'],
    },
    '@kysera/cache': {
      hooks: ['beforeQuery', 'afterQuery'],
      providers: ['CachePlugin'],
    },
    '@kysera/validation': {
      hooks: ['beforeInsert', 'beforeUpdate'],
      providers: ['ValidationPlugin'],
    },
  };

  const pluginFeatures = features[pluginName];

  if (pluginFeatures) {
    logger.debug(`Removing plugin features from ${pluginName}:`);

    if (pluginFeatures.hooks) {
      logger.debug(`  Hooks: ${pluginFeatures.hooks.join(', ')}`);
    }

    if (pluginFeatures.providers) {
      logger.debug(`  Providers: ${pluginFeatures.providers.join(', ')}`);
    }

    if (pluginFeatures.commands) {
      logger.debug(`  Commands: ${pluginFeatures.commands.join(', ')}`);
    }
  }
}

function getPluginDescription(pluginName: string): string {
  const descriptions: Record<string, string> = {
    '@kysera/soft-delete': 'Soft delete support with automatic filtering',
    '@kysera/timestamps': 'Automatic created_at and updated_at timestamps',
    '@kysera/audit': 'Comprehensive audit logging',
    '@kysera/cache': 'Query result caching',
    '@kysera/validation': 'Advanced validation with Zod/Joi/Yup',
    '@kysera/seeder': 'Database seeding utilities',
    '@kysera/graphql': 'GraphQL schema generation',
    '@kysera/rest': 'REST API generation',
  };

  return descriptions[pluginName] || '';
}

function displayDisableResults(results: DisableResult[], options: DisablePluginOptions): void {
  console.log('');
  console.log(prism.bold('🔌 Plugin Disable Results'));
  console.log(prism.gray('─'.repeat(50)));

  const disabled = results.filter((r) => r.status === 'disabled');
  const notEnabled = results.filter((r) => r.status === 'not_enabled');
  const failed = results.filter((r) => r.status === 'failed');

  if (disabled.length > 0) {
    console.log('');
    console.log(prism.green(`✅ Disabled: ${disabled.length}`));
    for (const result of disabled) {
      console.log(`  • ${result.plugin}`);
    }
  }

  if (notEnabled.length > 0) {
    console.log('');
    console.log(prism.yellow(`⚠️  Not enabled: ${notEnabled.length}`));
    for (const result of notEnabled) {
      console.log(`  • ${result.plugin}`);
    }
  }

  if (failed.length > 0) {
    console.log('');
    console.log(prism.red(`❌ Failed: ${failed.length}`));
    for (const result of failed) {
      console.log(`  • ${result.plugin}`);
      if (result.message) {
        console.log(prism.gray(`    ${result.message}`));
      }
      if (result.dependencies && result.dependencies.length > 0) {
        console.log(prism.gray(`    Dependencies: ${result.dependencies.join(', ')}`));
      }
    }
  }

  // Configuration info
  if (disabled.length > 0) {
    console.log('');
    console.log(prism.cyan('Info:'));

    if (options.keepConfig) {
      console.log('  • Plugin configurations were preserved');
      console.log('  • Use --no-keep-config to remove configurations');
    } else {
      console.log('  • Plugin configurations were removed');
      console.log('  • Use --keep-config to preserve configurations');
    }
  }

  // Next steps
  if (disabled.length > 0) {
    console.log('');
    console.log(prism.cyan('Next Steps:'));
    console.log('  • Restart your application for changes to take effect');
    console.log('  • Re-enable plugins with: kysera plugin enable <name>');
    console.log('  • Check plugin status with: kysera plugin list');
  }

  // Warnings
  if (failed.length > 0 && failed.some((r) => r.dependencies && r.dependencies.length > 0)) {
    console.log('');
    console.log(prism.yellow('💡 Tip:'));
    console.log('  Use --force to disable plugins with dependencies');
    console.log('  This may cause other plugins to malfunction');
  }
}
