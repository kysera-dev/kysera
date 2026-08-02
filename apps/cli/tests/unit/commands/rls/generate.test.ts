import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PostgresRLSGenerator } from '@kysera/rls/native'
import {
  loadRLSSchemaModule,
  requirePostgresDialect
} from '../../../../src/commands/rls/schema-loader.js'
import { CLIError } from '../../../../src/utils/errors.js'
import type { KyseraConfig } from '../../../../src/config/schema.js'

const FIXTURE_SCHEMA = `export default {
  posts: {
    policies: [
      {
        type: 'allow',
        operation: 'read',
        role: 'app_user',
        using: "tenant_id = current_setting('app.tenant_id')::uuid"
      },
      {
        type: 'filter',
        operation: 'read',
        condition: () => true
      }
    ]
  },
  comments: {
    policies: [
      {
        type: 'deny',
        operation: 'delete',
        role: 'app_user',
        using: 'false'
      }
    ]
  }
}
`

describe('rls schema loading and generation', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kysera-rls-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const writeFixture = (name: string, content: string): string => {
    const path = join(tempDir, name)
    writeFileSync(path, content, 'utf8')
    return path
  }

  describe('loadRLSSchemaModule', () => {
    it('loads a default-exported schema from a .mjs module', async () => {
      const path = writeFixture('schema.mjs', FIXTURE_SCHEMA)
      const schema = await loadRLSSchemaModule(path)
      expect(Object.keys(schema)).toEqual(['posts', 'comments'])
      expect(Array.isArray(schema.posts?.policies)).toBe(true)
    })

    it('accepts a named rlsSchema export as fallback', async () => {
      const path = writeFixture(
        'named.mjs',
        `export const rlsSchema = { posts: { policies: [] } }\n`
      )
      const schema = await loadRLSSchemaModule(path)
      expect(schema.posts?.policies).toEqual([])
    })

    it('rejects a missing file with a CLIError', async () => {
      await expect(loadRLSSchemaModule(join(tempDir, 'missing.mjs'))).rejects.toThrow(
        /not found/
      )
    })

    it('rejects unsupported extensions', async () => {
      const path = writeFixture('schema.txt', FIXTURE_SCHEMA)
      await expect(loadRLSSchemaModule(path)).rejects.toThrow(/Unsupported schema module/)
    })

    it('rejects modules that do not export a schema object', async () => {
      const path = writeFixture('bad.mjs', 'export default 42\n')
      await expect(loadRLSSchemaModule(path)).rejects.toThrow(/does not export an RLS schema/)
    })

    it('rejects an empty schema object', async () => {
      const path = writeFixture('empty.mjs', 'export default {}\n')
      await expect(loadRLSSchemaModule(path)).rejects.toThrow(/does not export an RLS schema/)
    })

    it('rejects table entries without a policies array', async () => {
      const path = writeFixture('nopolicies.mjs', 'export default { posts: { policies: "x" } }\n')
      await expect(loadRLSSchemaModule(path)).rejects.toThrow(/does not export an RLS schema/)
    })

    it('wraps module evaluation errors with the module path context', async () => {
      const path = writeFixture('throws.mjs', 'throw new Error("boom at import time")\n')
      await expect(loadRLSSchemaModule(path)).rejects.toThrow(/boom at import time/)
    })
  })

  describe('requirePostgresDialect', () => {
    it('accepts a postgres configuration', () => {
      const config = {
        database: { dialect: 'postgres', connection: 'postgres://localhost/app' }
      } as KyseraConfig
      expect(() => {
        requirePostgresDialect(config)
      }).not.toThrow()
    })

    it('refuses non-postgres dialects with a clear message', () => {
      const config = { database: { dialect: 'mysql', connection: 'x' } } as KyseraConfig
      expect(() => {
        requirePostgresDialect(config)
      }).toThrow(/PostgreSQL-only.*mysql/)
    })

    it('refuses when no database is configured', () => {
      expect(() => {
        requirePostgresDialect({} as KyseraConfig)
      }).toThrow(CLIError)
    })
  })

  describe('generation pipeline (fixture schema through PostgresRLSGenerator)', () => {
    it('produces ENABLE/FORCE and CREATE POLICY statements', async () => {
      const path = writeFixture('schema.mjs', FIXTURE_SCHEMA)
      const schema = await loadRLSSchemaModule(path)
      const statements = new PostgresRLSGenerator().generateStatements(schema)

      expect(statements).toContain('ALTER TABLE "public"."posts" ENABLE ROW LEVEL SECURITY;')
      expect(statements).toContain('ALTER TABLE "public"."posts" FORCE ROW LEVEL SECURITY;')
      const policies = statements.filter(statement => statement.startsWith('CREATE POLICY'))
      // The ORM-only filter policy is skipped; allow + deny become native.
      expect(policies).toHaveLength(2)
      expect(policies[0]).toContain('USING (tenant_id = current_setting')
      expect(policies[1]).toContain('AS RESTRICTIVE')
    })

    it('honors schemaName and force options', async () => {
      const path = writeFixture('schema.mjs', FIXTURE_SCHEMA)
      const schema = await loadRLSSchemaModule(path)
      const statements = new PostgresRLSGenerator().generateStatements(schema, {
        schemaName: 'tenant_a',
        force: false
      })
      expect(statements).toContain('ALTER TABLE "tenant_a"."posts" ENABLE ROW LEVEL SECURITY;')
      expect(statements.join('\n')).not.toContain('FORCE ROW LEVEL SECURITY')
    })

    it('produces DISABLE statements for drop output', async () => {
      const path = writeFixture('schema.mjs', FIXTURE_SCHEMA)
      const schema = await loadRLSSchemaModule(path)
      const statements = new PostgresRLSGenerator().generateDropStatements(schema)
      expect(statements.join('\n')).toContain(
        'ALTER TABLE "public"."posts" DISABLE ROW LEVEL SECURITY;'
      )
    })
  })
})
