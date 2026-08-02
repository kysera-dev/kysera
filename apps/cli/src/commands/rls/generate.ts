import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { Command } from 'commander'
import { loadConfig } from '../../config/loader.js'
import { CLIError } from '../../utils/errors.js'
import { isDryRun } from '../../utils/global-options.js'
import { diag, isJsonMode, output } from '../../utils/output.js'
import { loadRLSSchemaModule, requirePostgresDialect } from './schema-loader.js'

export interface RlsGenerateOptions {
  output?: string
  drop?: boolean
  functions?: boolean
  schema?: string
  policyPrefix?: string
  force?: boolean
  config?: string
  json?: boolean
}

export function generateCommand(): Command {
  const cmd = new Command('generate')
    .description('Generate native PostgreSQL RLS statements from an RLS schema module')
    .argument('<schema-module>', 'Path to a module exporting a defineRLSSchema(...) result')
    .option('-o, --output <file>', 'Write SQL to a file instead of stdout')
    .option('--drop', 'Generate DROP/DISABLE statements instead of CREATE/ENABLE')
    .option('--functions', 'Prepend the RLS context helper functions (rls_current_user_id, ...)')
    .option('-s, --schema <name>', 'PostgreSQL schema name', 'public')
    .option('--policy-prefix <prefix>', 'Prefix for generated policy names', 'rls')
    .option('--no-force', 'Skip FORCE ROW LEVEL SECURITY (table owners bypass RLS)')
    .option('--json', 'Output as JSON')
    .option('-c, --config <path>', 'Path to configuration file')
    .addHelpText(
      'after',
      `
The schema module must default-export the result of defineRLSSchema(...)
from @kysera/rls (named exports 'rlsSchema' or 'schema' also work):

  import { defineRLSSchema } from '@kysera/rls'

  export default defineRLSSchema({
    posts: {
      policies: [
        {
          type: 'allow',
          operation: 'read',
          role: 'app_user',
          using: "tenant_id = current_setting('app.tenant_id')::uuid"
        }
      ]
    }
  })

Only policies with SQL 'using'/'withCheck' expressions become native
CREATE POLICY statements; ORM-only policies (filter/validate) are skipped.
Compiled .js/.mjs modules always load; .ts requires a runtime that can
import TypeScript (Node >= 22.18 or Bun).
`
    )
    .action(async (schemaModule: string, options: RlsGenerateOptions) => {
      try {
        await generateRlsSql(schemaModule, options)
      } catch (error) {
        if (error instanceof CLIError) throw error
        throw new CLIError(
          `RLS generation failed: ${error instanceof Error ? error.message : String(error)}`,
          'RLS_GENERATE_ERROR'
        )
      }
    })

  return cmd
}

export async function generateRlsSql(
  schemaModule: string,
  options: RlsGenerateOptions
): Promise<void> {
  const config = await loadConfig(options.config)
  requirePostgresDialect(config)

  if (options.drop === true && options.functions === true) {
    throw new CLIError(
      '--functions cannot be combined with --drop',
      'RLS_GENERATE_ERROR',
      undefined,
      ['Context helper functions are only emitted for CREATE output']
    )
  }

  const rlsSchema = await loadRLSSchemaModule(schemaModule)

  const { PostgresRLSGenerator } = await import('@kysera/rls/native')
  const generator = new PostgresRLSGenerator()
  const generatorOptions = {
    schemaName: options.schema ?? 'public',
    policyPrefix: options.policyPrefix ?? 'rls',
    force: options.force !== false
  }

  const statements =
    options.drop === true
      ? generator.generateDropStatements(rlsSchema, generatorOptions)
      : generator.generateStatements(rlsSchema, generatorOptions)

  if (
    options.drop !== true &&
    !statements.some(statement => statement.startsWith('CREATE POLICY'))
  ) {
    diag(
      'Note: no CREATE POLICY statements were generated - the schema contains only ' +
        'ORM-level policies (filter/validate) or policies without using/withCheck SQL'
    )
  }

  const sections =
    options.functions === true
      ? [generator.generateContextFunctions().trim(), ...statements]
      : statements
  const sqlText = `${sections.join('\n\n')}\n`

  if (options.output) {
    const outPath = resolve(process.cwd(), options.output)
    const shownPath = relative(process.cwd(), outPath) || outPath
    if (isDryRun()) {
      diag(`DRY RUN: not writing ${outPath}`)
      output(
        { file: outPath, statements: sections, dryRun: true },
        { text: `DRY RUN: would write ${sections.length} SQL statement(s) to ${shownPath}` }
      )
      return
    }
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, sqlText, 'utf8')
    output(
      { file: outPath, statements: sections },
      { text: `Wrote ${sections.length} SQL statement(s) to ${shownPath}` }
    )
    return
  }

  if (options.json === true || isJsonMode()) {
    output({ statements: sections }, { format: 'json' })
    return
  }

  output(sqlText.trimEnd())
}
