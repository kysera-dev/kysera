import { Command } from 'commander'
import { prism } from '@xec-sh/kit'
import { spinner } from '../../utils/spinner.js'
import { guardDestructive } from '../../utils/guard.js'
import { CLIError } from '../../utils/errors.js'
import { withDatabase } from '../../utils/with-database.js'
import { safePath, isPathSafe } from '../../utils/fs.js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import type { DatabaseDialect } from '../../utils/database.js'
import type { DatabaseInstance } from '../../types/index.js'

export interface RestoreOptions {
  force?: boolean
  config?: string
}

interface JsonDumpTable {
  schema?: unknown
  data?: unknown[]
}

export function restoreCommand(): Command {
  const cmd = new Command('restore')
    .description('Restore database from dump')
    .argument('<file>', 'Dump file to restore from')
    .option('--force', 'Skip confirmation prompt')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (file: string, options: RestoreOptions) => {
      try {
        await restoreDatabase(file, options)
      } catch (error) {
        if (error instanceof CLIError) {
          throw error
        }
        throw new CLIError(
          `Failed to restore database: ${error instanceof Error ? error.message : String(error)}`,
          'RESTORE_ERROR'
        )
      }
    })

  return cmd
}

async function restoreDatabase(dumpFile: string, options: RestoreOptions): Promise<void> {
  const baseDir = process.cwd()
  let dumpPath: string

  if (resolve(dumpFile) === dumpFile) {
    dumpPath = dumpFile
  } else {
    if (!isPathSafe(baseDir, dumpFile)) {
      throw new CLIError('Invalid file path: path traversal detected', 'INVALID_PATH', [
        'Use an absolute path or a path within the current directory'
      ])
    }
    dumpPath = safePath(baseDir, dumpFile)
  }

  if (!existsSync(dumpPath)) {
    throw new CLIError(`Dump file not found: ${dumpPath}`, 'FILE_NOT_FOUND')
  }

  const proceed = await guardDestructive(
    'This will restore the database from the dump file and may overwrite existing data. Continue?',
    { force: options.force }
  )
  if (!proceed) {
    console.error(prism.gray('Restore cancelled'))
    return
  }

  await withDatabase({ config: options.config }, async (db, config) => {
    const restoreSpinner = spinner()
    restoreSpinner.start(`Restoring from ${dumpFile}...`)

    try {
      const dumpContent = readFileSync(dumpPath, 'utf-8')
      const isJson = dumpFile.endsWith('.json') || dumpContent.trim().startsWith('{')

      if (isJson) {
        await restoreFromJson(db, dumpContent, config.database.dialect)
      } else {
        await restoreFromSql(db, dumpContent)
      }

      restoreSpinner.stop()
      console.log(prism.green('Database restored successfully'))
      console.log('')
      console.log(prism.gray(`Source: ${dumpPath}`))
    } catch (error) {
      restoreSpinner.stop()
      throw error
    }
  })
}

async function restoreFromJson(
  db: DatabaseInstance,
  jsonContent: string,
  dialect: DatabaseDialect
): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonContent)
  } catch {
    throw new CLIError('Invalid JSON dump file', 'INVALID_DUMP')
  }

  const dump = parsed as { tables?: unknown }
  if (!dump.tables || typeof dump.tables !== 'object') {
    throw new CLIError('Invalid dump format: missing tables', 'INVALID_DUMP')
  }
  const dumpTables = dump.tables as Record<string, unknown>

  const { CompiledQuery } = await import('kysely')

  await db.transaction().execute(async trx => {
    if (dialect === 'postgres') {
      await trx.executeQuery(CompiledQuery.raw('SET session_replication_role = replica', []))
    } else if (dialect === 'mysql') {
      await trx.executeQuery(CompiledQuery.raw('SET FOREIGN_KEY_CHECKS = 0', []))
    } else {
      await trx.executeQuery(CompiledQuery.raw('PRAGMA foreign_keys = OFF', []))
    }

    for (const [tableName, tableData] of Object.entries(dumpTables)) {
      const table = tableData as JsonDumpTable

      if (table.data && Array.isArray(table.data) && table.data.length > 0) {
        if (!table.schema) {
          await trx.deleteFrom(tableName).execute()
        }

        const rows: unknown[] = table.data
        const batchSize = 100
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize) as Record<string, unknown>[]
          await trx.insertInto(tableName).values(batch).execute()
        }
      }
    }

    if (dialect === 'postgres') {
      await trx.executeQuery(CompiledQuery.raw('SET session_replication_role = DEFAULT', []))
    } else if (dialect === 'mysql') {
      await trx.executeQuery(CompiledQuery.raw('SET FOREIGN_KEY_CHECKS = 1', []))
    } else {
      await trx.executeQuery(CompiledQuery.raw('PRAGMA foreign_keys = ON', []))
    }
  })
}

async function restoreFromSql(db: DatabaseInstance, sqlContent: string): Promise<void> {
  const statements = sqlContent
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'))

  if (statements.length === 0) {
    throw new CLIError('No SQL statements found in dump file', 'INVALID_DUMP')
  }

  const { CompiledQuery } = await import('kysely')

  await db.transaction().execute(async trx => {
    for (const statement of statements) {
      if (statement.trim() && !statement.startsWith('--')) {
        await trx.executeQuery(CompiledQuery.raw(statement, []))
      }
    }
  })
}
