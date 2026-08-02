import { Command } from 'commander'

export interface DoctorCommandOptions {
  config?: string
  json?: boolean
}

/**
 * `kysera doctor` - one-shot environment sanity check. Probes the runtime,
 * configuration discovery/validation, database driver, database
 * connectivity, migration state and installed @kysera/* versions.
 */
export function doctorCommand(): Command {
  const cmd = new Command('doctor')
    .description('Diagnose environment, configuration, driver and database health')
    .option('--json', 'Output as JSON')
    .option('-c, --config <path>', 'Path to configuration file')
    .addHelpText(
      'after',
      `
Sections: runtime, config, drivers, database, versions. Each check is
pass/warn/fail; probe failures become fail checks instead of aborting.
Exit code is 0 when no check fails (warnings allowed), 1 otherwise.

With --json the output is { checks: [{ id, status, detail }, ...], summary }.
`
    )
    .action(async (options: DoctorCommandOptions) => {
      const { runDoctor } = await import('./run.js')
      await runDoctor(options)
    })

  return cmd
}
