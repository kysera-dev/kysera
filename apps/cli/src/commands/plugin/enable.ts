import { Command } from 'commander'
import { prism, spinner, confirm, select } from '@xec-sh/kit'
import { logger } from '../../utils/logger.js'
import { CLIError } from '../../utils/errors.js'
import { loadConfig, saveConfig } from '../../config/loader.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createRequire } from 'node:module'

export interface EnablePluginOptions {
  all?: boolean
  force?: boolean
  configure?: boolean
  restart?: boolean
  json?: boolean
  config?: string
}

interface EnableResult {
  plugin: string
  status: 'enabled' | 'failed' | 'already_enabled'
  message?: string
  configuration?: Record<string, any>
  hooks?: string[]
  providers?: string[]
}

export function enablePluginCommand(): Command {
  const cmd = new Command('enable')
    .description('Enable a plugin')
    .argument('[name]', 'Plugin name to enable')
    .option('--all', 'Enable all installed plugins', false)
    .option('-f, --force', 'Force enable without checks', false)
    .option('--configure', 'Configure plugin after enabling', false)
    .option('--restart', 'Restart application after enabling', false)
    .option('--json', 'Output as JSON', false)
    .option('--config <path>', 'Path to configuration file')
    .action(async (name: string | undefined, options: EnablePluginOptions) => {
      try {
        await enablePlugin(name, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to enable plugin: ${error instanceof Error ? error.message : String(error)}`,
          'PLUGIN_ENABLE_ERROR'
        )
      }
    })

  return cmd
}

async function enablePlugin(name: string | undefined, options: EnablePluginOptions): Promise<void> {
  const enableSpinner = spinner()

  try {
    // Load configuration
    const config = await loadConfig(options.config) || {}

    // Initialize plugins config if not exists
    if (!config.plugins) {
      config.plugins = {}
    }

    const results: EnableResult[] = []

    if (options.all) {
      // Enable all installed plugins
      enableSpinner.start('Discovering installed plugins...')
      const installedPlugins = await discoverInstalledPlugins()

      if (installedPlugins.length === 0) {
        enableSpinner.stop()
        console.log(prism.yellow('No installed plugins found'))
        return
      }

      enableSpinner.stop()
      console.log(prism.green(`✓ Found ${installedPlugins.length} installed plugin${installedPlugins.length !== 1 ? 's' : ''}`))

      // Confirm action
      if (!options.force && !options.json) {
        const shouldEnable = await confirm(
          `Enable ${installedPlugins.length} plugin${installedPlugins.length !== 1 ? 's' : ''}?`
        )

        if (!shouldEnable) {
          console.log(prism.gray('Operation cancelled'))
          return
        }
      }

      // Enable each plugin
      for (const plugin of installedPlugins) {
        const result = await enableSinglePlugin(plugin, config, options)
        results.push(result)
      }

    } else if (name) {
      // Enable specific plugin
      enableSpinner.start(`Enabling plugin: ${name}...`)

      const result = await enableSinglePlugin(name, config, options)
      results.push(result)

      if (result.status === 'enabled') {
        enableSpinner.stop()
        console.log(prism.green(`✓ Plugin enabled: ${name}`))
      } else if (result.status === 'already_enabled') {
        enableSpinner.stop()
        console.log(prism.yellow(`Plugin already enabled: ${name}`))
      } else {
        enableSpinner.stop()
        console.log(prism.red(`Failed to enable plugin: ${name}`))
      }

    } else {
      // Interactive selection
      enableSpinner.start('Discovering installed plugins...')
      const installedPlugins = await discoverInstalledPlugins()
      enableSpinner.stop()

      if (installedPlugins.length === 0) {
        console.log(prism.yellow('No installed plugins found'))
        console.log(prism.gray('Install plugins with: kysera plugin install <name>'))
        return
      }

      // Filter out already enabled plugins
      const disabledPlugins = installedPlugins.filter(p => {
        const pluginConfig = config.plugins[p]
        return !pluginConfig || pluginConfig.enabled !== true
      })

      if (disabledPlugins.length === 0) {
        console.log(prism.yellow('All installed plugins are already enabled'))
        return
      }

      const selected = await select(
        'Select plugin to enable:',
        disabledPlugins.map(p => ({
          label: p,
          value: p,
          description: getPluginDescription(p)
        }))
      )

      enableSpinner.start(`Enabling plugin: ${selected}...`)
      const result = await enableSinglePlugin(selected, config, options)
      results.push(result)

      if (result.status === 'enabled') {
        enableSpinner.stop()
        console.log(prism.green(`✓ Plugin enabled: ${selected}`))
      } else {
        enableSpinner.stop()
        console.log(prism.red(`Failed to enable plugin: ${selected}`))
      }
    }

    // Save configuration
    if (results.some(r => r.status === 'enabled')) {
      await saveConfig(config, options.config)
    }

    // Display results
    if (options.json) {
      console.log(JSON.stringify(results, null, 2))
    } else {
      displayEnableResults(results, options)
    }

    // Configure plugins if requested
    if (options.configure && results.some(r => r.status === 'enabled')) {
      console.log('')
      console.log(prism.cyan('Configuring enabled plugins...'))

      for (const result of results.filter(r => r.status === 'enabled')) {
        await configurePlugin(result.plugin, config, options)
      }

      await saveConfig(config, options.config)
    }

    // Restart if requested
    if (options.restart && results.some(r => r.status === 'enabled')) {
      console.log('')
      console.log(prism.yellow('⚠️  Application restart required'))
      console.log('Please restart your application for changes to take effect')
    }

  } catch (error) {
    enableSpinner.stop()
    logger.error('Failed to enable plugin')
    throw error
  }
}

async function discoverInstalledPlugins(): Promise<string[]> {
  const plugins: string[] = []

  try {
    // Check node_modules for @kysera/* packages
    const nodeModulesPath = path.join(process.cwd(), 'node_modules')
    const kyseraPath = path.join(nodeModulesPath, '@kysera')

    const packages = await fs.readdir(kyseraPath)

    // Known core packages to exclude
    const corePackages = ['core', 'repository', 'migrations']

    for (const pkgName of packages) {
      if (!corePackages.includes(pkgName)) {
        plugins.push(`@kysera/${pkgName}`)
      }
    }

    // Check for custom plugins
    const pluginsDir = path.join(process.cwd(), 'plugins')
    try {
      const customPlugins = await fs.readdir(pluginsDir)

      for (const plugin of customPlugins) {
        const pluginPath = path.join(pluginsDir, plugin)
        const stat = await fs.stat(pluginPath)

        if (stat.isDirectory()) {
          plugins.push(plugin)
        }
      }
    } catch {
      // No plugins directory
    }

  } catch (error) {
    logger.debug(`Failed to discover installed plugins: ${error}`)
  }

  return plugins
}

async function enableSinglePlugin(
  pluginName: string,
  config: any,
  options: EnablePluginOptions
): Promise<EnableResult> {
  const result: EnableResult = {
    plugin: pluginName,
    status: 'failed'
  }

  try {
    // Check if already enabled
    if (config.plugins[pluginName]?.enabled === true) {
      result.status = 'already_enabled'
      result.message = 'Plugin is already enabled'
      return result
    }

    // Validate plugin exists
    const pluginInfo = await validatePlugin(pluginName, options.force || false)

    if (!pluginInfo.valid) {
      result.message = pluginInfo.error
      return result
    }

    // Check dependencies
    if (pluginInfo.dependencies && !options.force) {
      const missingDeps = await checkDependencies(pluginInfo.dependencies)

      if (missingDeps.length > 0) {
        result.message = `Missing dependencies: ${missingDeps.join(', ')}`
        return result
      }
    }

    // Enable the plugin
    if (!config.plugins[pluginName]) {
      config.plugins[pluginName] = {}
    }

    config.plugins[pluginName].enabled = true

    // Set default configuration
    if (pluginInfo.defaultConfig) {
      config.plugins[pluginName] = {
        ...pluginInfo.defaultConfig,
        ...config.plugins[pluginName],
        enabled: true
      }
      result.configuration = pluginInfo.defaultConfig
    }

    // Track hooks and providers
    result.hooks = pluginInfo.hooks
    result.providers = pluginInfo.providers

    result.status = 'enabled'
    result.message = 'Plugin enabled successfully'

    // Register plugin commands if any
    if (pluginInfo.commands && pluginInfo.commands.length > 0) {
      logger.debug(`Plugin adds commands: ${pluginInfo.commands.join(', ')}`)
    }

  } catch (error) {
    result.message = error instanceof Error ? error.message : String(error)
  }

  return result
}

async function validatePlugin(pluginName: string, force: boolean): Promise<{
  valid: boolean
  error?: string
  dependencies?: string[]
  hooks?: string[]
  providers?: string[]
  commands?: string[]
  defaultConfig?: Record<string, any>
}> {
  const result: any = {
    valid: false
  }

  try {
    // Check if plugin is installed
    const require = createRequire(import.meta.url)

    let pluginPath: string
    let packageJson: any

    if (pluginName.startsWith('@') || pluginName.includes('/')) {
      // npm package
      try {
        pluginPath = require.resolve(pluginName)
        const packageJsonPath = path.join(
          pluginPath.substring(0, pluginPath.lastIndexOf('node_modules') + 12),
          pluginName,
          'package.json'
        )
        packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'))
      } catch {
        result.error = `Plugin not installed: ${pluginName}`
        return result
      }
    } else {
      // Custom plugin
      const pluginDir = path.join(process.cwd(), 'plugins', pluginName)

      try {
        const packageJsonPath = path.join(pluginDir, 'package.json')
        packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'))
      } catch {
        // Plugin without package.json
        result.valid = true
        return result
      }
    }

    // Extract plugin metadata
    if (packageJson) {
      result.valid = true

      // Dependencies
      result.dependencies = Object.keys(packageJson.dependencies || {})

      // Kysera-specific metadata
      if (packageJson.kysera) {
        result.hooks = packageJson.kysera.hooks
        result.providers = packageJson.kysera.providers
        result.commands = packageJson.kysera.commands
        result.defaultConfig = packageJson.kysera.defaultConfig
      }

      // Check version compatibility
      if (packageJson.engines?.kysera && !force) {
        const kyseraVersion = process.env['KYSERA_VERSION'] || '1.0.0'
        const requiredVersion = packageJson.engines.kysera

        if (!isVersionCompatible(kyseraVersion, requiredVersion)) {
          result.valid = false
          result.error = `Incompatible Kysera version. Required: ${requiredVersion}, Current: ${kyseraVersion}`
        }
      }
    }

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }

  return result
}

async function checkDependencies(dependencies: string[]): Promise<string[]> {
  const missing: string[] = []
  const require = createRequire(import.meta.url)

  for (const dep of dependencies) {
    try {
      require.resolve(dep)
    } catch {
      missing.push(dep)
    }
  }

  return missing
}

function isVersionCompatible(current: string, required: string): boolean {
  // Simple version comparison - in production use semver
  if (required.includes('*')) return true

  if (required.startsWith('^')) {
    const major = current.split('.')[0]
    const requiredMajor = required.substring(1).split('.')[0]
    return major === requiredMajor
  }

  if (required.startsWith('~')) {
    const [major, minor] = current.split('.')
    const [reqMajor, reqMinor] = required.substring(1).split('.')
    return major === reqMajor && minor === reqMinor
  }

  if (required.startsWith('>=')) {
    return current >= required.substring(2).trim()
  }

  return current === required
}

async function configurePlugin(pluginName: string, config: any, options: EnablePluginOptions): Promise<void> {
  console.log(`Configuring ${pluginName}...`)

  // Get plugin configuration schema
  const pluginConfig = config.plugins[pluginName] || {}

  // Basic configuration options
  const configOptions = {
    autoLoad: true,
    priority: 100,
    ...pluginConfig
  }

  // Plugin-specific configuration
  if (pluginName.includes('cache')) {
    configOptions.ttl = 3600
    configOptions.backend = 'memory'
  } else if (pluginName.includes('audit')) {
    configOptions.logLevel = 'info'
    configOptions.includeMetadata = true
  } else if (pluginName.includes('validation')) {
    configOptions.strict = true
    configOptions.abortEarly = false
  }

  config.plugins[pluginName] = configOptions

  console.log(prism.gray(`  Configuration applied for ${pluginName}`))
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
    '@kysera/rest': 'REST API generation'
  }

  return descriptions[pluginName] || ''
}

function displayEnableResults(results: EnableResult[], options: EnablePluginOptions): void {
  console.log('')
  console.log(prism.bold('🔌 Plugin Enable Results'))
  console.log(prism.gray('─'.repeat(50)))

  const enabled = results.filter(r => r.status === 'enabled')
  const alreadyEnabled = results.filter(r => r.status === 'already_enabled')
  const failed = results.filter(r => r.status === 'failed')

  if (enabled.length > 0) {
    console.log('')
    console.log(prism.green(`✅ Enabled: ${enabled.length}`))
    for (const result of enabled) {
      console.log(`  • ${result.plugin}`)

      if (result.hooks && result.hooks.length > 0) {
        console.log(prism.gray(`    Hooks: ${result.hooks.join(', ')}`))
      }

      if (result.providers && result.providers.length > 0) {
        console.log(prism.gray(`    Providers: ${result.providers.join(', ')}`))
      }
    }
  }

  if (alreadyEnabled.length > 0) {
    console.log('')
    console.log(prism.yellow(`⚠️  Already enabled: ${alreadyEnabled.length}`))
    for (const result of alreadyEnabled) {
      console.log(`  • ${result.plugin}`)
    }
  }

  if (failed.length > 0) {
    console.log('')
    console.log(prism.red(`❌ Failed: ${failed.length}`))
    for (const result of failed) {
      console.log(`  • ${result.plugin}`)
      if (result.message) {
        console.log(prism.gray(`    ${result.message}`))
      }
    }
  }

  // Next steps
  if (enabled.length > 0) {
    console.log('')
    console.log(prism.cyan('Next Steps:'))

    if (!options.configure) {
      console.log('  • Configure plugins with: kysera plugin config <name>')
    }

    console.log('  • Restart your application for changes to take effect')
    console.log('  • Check plugin status with: kysera plugin list')
  }
}