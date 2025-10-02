import { Command } from 'commander'

// Import plugin commands
import { listPluginsCommand } from './list.js'
import { enablePluginCommand } from './enable.js'
import { disablePluginCommand } from './disable.js'
import { configPluginCommand } from './config.js'

export function pluginCommand(): Command {
  const cmd = new Command('plugin')
    .description('Plugin management and configuration')
    .addHelpText('after', `

Examples:
  kysera plugin list                      List all available plugins
  kysera plugin list --installed          List installed plugins
  kysera plugin enable @kysera/audit      Enable audit plugin
  kysera plugin disable --all             Disable all plugins
  kysera plugin config @kysera/cache      Configure cache plugin

Subcommands:
  list        List available and installed plugins
  enable      Enable a plugin
  disable     Disable a plugin
  config      Configure plugin settings

Plugin Categories:
  • database    Database-level plugins
  • schema      Schema modification plugins
  • query       Query enhancement plugins
  • audit       Audit and logging plugins
  • cache       Caching plugins
  • validation  Validation plugins

Popular Plugins:
  @kysera/soft-delete    Soft delete support with filtering
  @kysera/timestamps     Automatic created_at/updated_at
  @kysera/audit          Comprehensive audit logging
  @kysera/cache          Query result caching
  @kysera/validation     Advanced validation support

For more information on a subcommand, run:
  kysera plugin <subcommand> --help
`)

  // Add subcommands
  cmd.addCommand(listPluginsCommand())
  cmd.addCommand(enablePluginCommand())
  cmd.addCommand(disablePluginCommand())
  cmd.addCommand(configPluginCommand())

  return cmd
}