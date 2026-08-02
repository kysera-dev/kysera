import { describe, it, expect } from 'vitest'
import { splitSqlStatements, normalizeDialect } from '../../../src/utils/database.js'

describe('splitSqlStatements', () => {
  it('splits a script into individual statements', () => {
    const script = 'CREATE TABLE users (id INT);\nINSERT INTO users VALUES (1);'
    expect(splitSqlStatements(script)).toEqual([
      'CREATE TABLE users (id INT)',
      'INSERT INTO users VALUES (1)'
    ])
  })

  it('does not swallow statements that follow comment lines', () => {
    // Regression: dump files put "-- Table: users" style comments before
    // each statement; the old splitter dropped the WHOLE chunk (including
    // the DROP/INSERT that followed) because it started with '--'.
    const dump = [
      '-- Kysera Database Dump',
      '-- Dialect: sqlite',
      '',
      'PRAGMA foreign_keys = OFF;',
      '',
      '-- Table: users',
      '',
      'DROP TABLE IF EXISTS "users";',
      '',
      'CREATE TABLE "users" (id INTEGER);',
      '',
      '-- Data for table: users',
      'INSERT INTO "users" (id) VALUES (1);'
    ].join('\n')

    const statements = splitSqlStatements(dump)
    expect(statements).toEqual([
      'PRAGMA foreign_keys = OFF',
      'DROP TABLE IF EXISTS "users"',
      'CREATE TABLE "users" (id INTEGER)',
      'INSERT INTO "users" (id) VALUES (1)'
    ])
  })

  it('returns an empty list for comment-only scripts', () => {
    expect(splitSqlStatements('-- nothing here\n-- at all')).toEqual([])
  })
})

describe('normalizeDialect', () => {
  it("maps the legacy 'postgresql' spelling to 'postgres'", () => {
    expect(normalizeDialect('postgresql')).toBe('postgres')
    expect(normalizeDialect('postgres')).toBe('postgres')
  })

  it('passes mysql and sqlite through', () => {
    expect(normalizeDialect('mysql')).toBe('mysql')
    expect(normalizeDialect('sqlite')).toBe('sqlite')
  })

  it('rejects unknown dialects', () => {
    expect(() => normalizeDialect('oracle')).toThrow()
  })
})
