import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { CLIError } from '../../utils/errors.js'
import { diag, isJsonMode, output } from '../../utils/output.js'
import { withDatabase } from '../../utils/with-database.js'
import type { VerifyIssue } from './runner.js'
import { createRunner, migrateSettings } from './settings.js'

export interface VerifyCommandOptions {
  update?: boolean
  verbose?: boolean
  config?: string
  json?: boolean
  schema?: string
}

export function verifyCommand(): Command {
  const cmd = new Command('verify')
    .description('Verify executed migrations match the files on disk (checksum drift check)')
    .option('--update', 'Store current file checksums for executed records that have none')
    .option('-v, --verbose', 'Show detailed output')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--json', 'Output results as JSON')
    .option('-s, --schema <name>', 'PostgreSQL schema name (default: public)')
    .action(async (options: VerifyCommandOptions) => {
      try {
        await verifyMigrations(options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to verify migrations: ${error instanceof Error ? error.message : String(error)}`,
          'MIGRATION_VERIFY_ERROR'
        )
      }
    })

  return cmd
}

async function verifyMigrations(options: VerifyCommandOptions): Promise<void> {
  await withDatabase(
    { config: options.config, verbose: options.verbose, schema: options.schema },
    async (db, config, resolvedSchema) => {
      const settings = migrateSettings(config, resolvedSchema, options.schema)
      const runner = createRunner(db, settings)
      const json = options.json === true || isJsonMode()

      let adopted: string[] = []
      if (options.update === true) {
        adopted = await runner.adoptChecksums()
      }

      const report = await runner.verify()

      if (json) {
        output(
          {
            ok: report.ok,
            checked: report.checked,
            pending: report.pending,
            adopted,
            issues: report.issues,
            table: settings.tableName,
            dialect: settings.dialect
          },
          { format: 'json' }
        )
      } else {
        renderVerifyText(report.ok, report.checked, report.pending, report.issues, adopted)
      }

      if (!report.ok) {
        const failing = report.issues.filter(i => i.kind !== 'unknown_checksum')
        throw new CLIError(
          `Migration drift detected: ${failing.length} issue${failing.length === 1 ? '' : 's'}`,
          'MIGRATION_DRIFT',
          { issues: failing },
          [
            'A migration file was modified or deleted after it was executed',
            'Restore the original file, or create a new migration for the change',
            'If the current files are correct, re-baseline the affected migrations'
          ]
        )
      }
    }
  )
}

function renderVerifyText(
  ok: boolean,
  checked: number,
  pending: number,
  issues: VerifyIssue[],
  adopted: string[]
): void {
  for (const name of adopted) {
    diag(`${prism.green('✓')} ${name} ${prism.gray('(checksum stored)')}`)
  }

  for (const issue of issues) {
    if (issue.kind === 'modified') {
      diag(`${prism.red('✗')} ${issue.name} ${prism.red('(modified after execution)')}`)
      diag(prism.gray(`    expected ${issue.expected ?? ''}`))
      diag(prism.gray(`    actual   ${issue.actual ?? ''}`))
    } else if (issue.kind === 'missing_file') {
      diag(`${prism.red('✗')} ${issue.name} ${prism.red('(migration file missing)')}`)
    } else {
      diag(`${prism.yellow('?')} ${issue.name} ${prism.yellow('(no stored checksum)')}`)
    }
  }

  const summary = ok
    ? `Verified ${checked} executed migration${checked === 1 ? '' : 's'}: no drift (${pending} pending)`
    : `Verified ${checked} executed migration${checked === 1 ? '' : 's'}: drift detected`
  output(summary)
}
