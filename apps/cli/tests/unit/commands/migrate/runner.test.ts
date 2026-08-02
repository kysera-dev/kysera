import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MigrationError, MigrationLockError } from '@kysera/migrations'
import {
  checksumFile,
  discoverMigrationFiles,
  MigrationRunner
} from '../../../../src/commands/migrate/runner.js'
import { CLIError } from '../../../../src/utils/errors.js'

describe('migration file discovery', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kysera-migrate-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns [] for a missing directory', () => {
    expect(discoverMigrationFiles(join(dir, 'nope'))).toEqual([])
  })

  it('discovers .ts/.js/.mjs files sorted by filename, ignoring other files', () => {
    writeFileSync(join(dir, '20240102000000_b.ts'), '')
    writeFileSync(join(dir, '20240101000000_a.js'), '')
    writeFileSync(join(dir, '20240103000000_c.mjs'), '')
    writeFileSync(join(dir, 'notes.md'), '')
    writeFileSync(join(dir, 'types.d.ts'), '')
    writeFileSync(join(dir, '.hidden.ts'), '')

    const files = discoverMigrationFiles(dir)
    expect(files.map(f => f.name)).toEqual([
      '20240101000000_a',
      '20240102000000_b',
      '20240103000000_c'
    ])
    expect(files[0]).toEqual({
      name: '20240101000000_a',
      path: join(dir, '20240101000000_a.js'),
      timestamp: '20240101000000'
    })
  })

  it('accepts non-timestamped names with an empty timestamp', () => {
    writeFileSync(join(dir, '001_initial.ts'), '')

    const files = discoverMigrationFiles(dir)
    expect(files).toEqual([
      { name: '001_initial', path: join(dir, '001_initial.ts'), timestamp: '' }
    ])
  })

  it('rejects duplicate basenames across extensions', () => {
    writeFileSync(join(dir, '20240101000000_a.ts'), '')
    writeFileSync(join(dir, '20240101000000_a.js'), '')

    expect(() => discoverMigrationFiles(dir)).toThrow(CLIError)
    expect(() => discoverMigrationFiles(dir)).toThrow(/Duplicate migration name/)
  })
})

describe('checksumFile', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kysera-checksum-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns a stable sha256 hex digest', () => {
    const file = join(dir, 'm.ts')
    writeFileSync(file, 'export async function up() {}')

    const first = checksumFile(file)
    const second = checksumFile(file)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).toBe(second)
  })

  it('changes when the content changes', () => {
    const file = join(dir, 'm.ts')
    writeFileSync(file, 'a')
    const before = checksumFile(file)
    writeFileSync(file, 'b')
    expect(checksumFile(file)).not.toBe(before)
  })

  it('returns null for a missing file', () => {
    expect(checksumFile(join(dir, 'missing.ts'))).toBeNull()
  })
})

describe('run error mapping', () => {
  let dir: string
  // The constructor never touches the database; a bare object is enough
  // to exercise the error-mapping path.
  const stubDb = {} as never

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kysera-runner-map-'))
    writeFileSync(join(dir, '20240101000000_a.ts'), 'export async function up(){}\nexport async function down(){}\n')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function rethrow(error: unknown): CLIError {
    const runner = new MigrationRunner(stubDb, dir)
    try {
      // Private in TS only; the mapping contract is worth pinning directly.
      ;(runner as unknown as {
        rethrowRunError(e: unknown, op: 'up' | 'down', planned: string[], applied: string[]): never
      }).rethrowRunError(error, 'up', ['20240101000000_a'], [])
    } catch (mapped) {
      if (mapped instanceof CLIError) return mapped
      throw mapped
    }
    throw new Error('rethrowRunError did not throw')
  }

  it('maps MigrationLockError instances to CLIError code MIGRATION_LOCKED', () => {
    const mapped = rethrow(new MigrationLockError(5000))
    expect(mapped.code).toBe('MIGRATION_LOCKED')
    expect(mapped.message).toContain('already running')
  })

  it('maps lock errors structurally (name check survives duplicated library instances)', () => {
    const structural = new Error('could not acquire lock')
    structural.name = 'MigrationLockError'
    const mapped = rethrow(structural)
    expect(mapped.code).toBe('MIGRATION_LOCKED')
  })

  it('maps MigrationError to MIGRATION_FAILED with file, applied and remaining context', () => {
    const failure = new MigrationError('Migration 20240101000000_a failed: boom', '20240101000000_a', 'up')
    const mapped = rethrow(failure)
    expect(mapped.code).toBe('MIGRATION_FAILED')
    const details = mapped.details as { file?: string; applied: string[]; remaining: string[] }
    expect(details.file).toBe(join(dir, '20240101000000_a.ts'))
    expect(details.applied).toEqual([])
    expect(details.remaining).toEqual([])
    expect(mapped.suggestions.join('\n')).toContain('Failed migration file:')
  })
})
