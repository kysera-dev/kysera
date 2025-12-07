import { describe, it, expect } from 'vitest';
import {
  isValidIdentifier,
  validateIdentifier,
  escapeIdentifier,
  escapeTypedIdentifier,
  escapeQualifiedIdentifier,
  validateIdentifiers,
  interpolateTableName,
  safeTruncate,
  safeDropDatabase,
  safePragmaTableInfo,
  safePragmaIndexInfo,
  safePragmaForeignKeyList,
  safeVacuumInto,
  safeAnalyze,
  safeOptimizeTable,
  safeCheckTable,
  safeRepairTable,
  safeVacuumAnalyze,
  safeCreateExtension,
  safeTerminateBackendQuery,
  isSqlSanitizationError,
  SqlSanitizationError,
  type IdentifierType,
  type SqlDialect,
} from '@/utils/sql-sanitizer';

describe('SqlSanitizationError', () => {
  it('should create an error with message, type, and invalid value', () => {
    const error = new SqlSanitizationError('Invalid table name', 'table', 'drop--table');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SqlSanitizationError);
    expect(error.name).toBe('SqlSanitizationError');
    expect(error.message).toBe('Invalid table name');
    expect(error.identifierType).toBe('table');
    expect(error.invalidValue).toBe('drop--table');
  });

  it('should have a stack trace', () => {
    const error = new SqlSanitizationError('Test error', 'column', 'bad');
    expect(error.stack).toBeDefined();
  });
});

describe('isSqlSanitizationError', () => {
  it('should return true for SqlSanitizationError instances', () => {
    const error = new SqlSanitizationError('Test', 'table', 'test');
    expect(isSqlSanitizationError(error)).toBe(true);
  });

  it('should return false for regular errors', () => {
    const error = new Error('Regular error');
    expect(isSqlSanitizationError(error)).toBe(false);
  });

  it('should return false for non-error values', () => {
    expect(isSqlSanitizationError('string')).toBe(false);
    expect(isSqlSanitizationError(null)).toBe(false);
    expect(isSqlSanitizationError(undefined)).toBe(false);
    expect(isSqlSanitizationError({})).toBe(false);
  });
});

describe('isValidIdentifier', () => {
  describe('valid identifiers', () => {
    it('should accept simple lowercase names', () => {
      expect(isValidIdentifier('users')).toBe(true);
      expect(isValidIdentifier('accounts')).toBe(true);
      expect(isValidIdentifier('orders')).toBe(true);
    });

    it('should accept names starting with underscore', () => {
      expect(isValidIdentifier('_private')).toBe(true);
      expect(isValidIdentifier('_users')).toBe(true);
      expect(isValidIdentifier('__internal')).toBe(true);
    });

    it('should accept names with underscores', () => {
      expect(isValidIdentifier('user_accounts')).toBe(true);
      expect(isValidIdentifier('order_items')).toBe(true);
      expect(isValidIdentifier('a_b_c_d')).toBe(true);
    });

    it('should accept names with numbers (not at start)', () => {
      expect(isValidIdentifier('user1')).toBe(true);
      expect(isValidIdentifier('accounts2023')).toBe(true);
      expect(isValidIdentifier('table_v2')).toBe(true);
      expect(isValidIdentifier('a1b2c3')).toBe(true);
    });

    it('should accept uppercase letters', () => {
      expect(isValidIdentifier('Users')).toBe(true);
      expect(isValidIdentifier('USERS')).toBe(true);
      expect(isValidIdentifier('UserAccounts')).toBe(true);
    });

    it('should accept mixed case with underscores and numbers', () => {
      expect(isValidIdentifier('User_Accounts_2023')).toBe(true);
      expect(isValidIdentifier('_PrivateTable1')).toBe(true);
    });

    it('should accept single character names', () => {
      expect(isValidIdentifier('a')).toBe(true);
      expect(isValidIdentifier('Z')).toBe(true);
      expect(isValidIdentifier('_')).toBe(true);
    });

    it('should accept names up to 128 characters', () => {
      const validLongName = 'a'.repeat(128);
      expect(isValidIdentifier(validLongName)).toBe(true);
    });
  });

  describe('invalid identifiers - basic validation', () => {
    it('should reject empty strings', () => {
      expect(isValidIdentifier('')).toBe(false);
    });

    it('should reject null and undefined', () => {
      expect(isValidIdentifier(null as unknown as string)).toBe(false);
      expect(isValidIdentifier(undefined as unknown as string)).toBe(false);
    });

    it('should reject non-string values', () => {
      expect(isValidIdentifier(123 as unknown as string)).toBe(false);
      expect(isValidIdentifier({} as unknown as string)).toBe(false);
      expect(isValidIdentifier([] as unknown as string)).toBe(false);
    });

    it('should reject names starting with numbers', () => {
      expect(isValidIdentifier('123table')).toBe(false);
      expect(isValidIdentifier('1users')).toBe(false);
      expect(isValidIdentifier('0')).toBe(false);
    });

    it('should reject names longer than 128 characters', () => {
      const tooLongName = 'a'.repeat(129);
      expect(isValidIdentifier(tooLongName)).toBe(false);
    });

    it('should reject names with hyphens', () => {
      expect(isValidIdentifier('user-table')).toBe(false);
      expect(isValidIdentifier('my-database')).toBe(false);
    });

    it('should reject names with spaces', () => {
      expect(isValidIdentifier('user table')).toBe(false);
      expect(isValidIdentifier(' users')).toBe(false);
      expect(isValidIdentifier('users ')).toBe(false);
    });

    it('should reject names with dots', () => {
      expect(isValidIdentifier('schema.table')).toBe(false);
      expect(isValidIdentifier('db.schema.table')).toBe(false);
    });
  });

  describe('SQL injection prevention - quote characters', () => {
    it('should reject single quotes', () => {
      expect(isValidIdentifier("users'")).toBe(false);
      expect(isValidIdentifier("'users")).toBe(false);
      expect(isValidIdentifier("us'ers")).toBe(false);
      expect(isValidIdentifier("'")).toBe(false);
    });

    it('should reject double quotes', () => {
      expect(isValidIdentifier('users"')).toBe(false);
      expect(isValidIdentifier('"users')).toBe(false);
      expect(isValidIdentifier('us"ers')).toBe(false);
    });

    it('should reject backticks', () => {
      expect(isValidIdentifier('users`')).toBe(false);
      expect(isValidIdentifier('`users')).toBe(false);
      expect(isValidIdentifier('us`ers')).toBe(false);
    });
  });

  describe('SQL injection prevention - comment patterns', () => {
    it('should reject SQL single-line comments (--)', () => {
      expect(isValidIdentifier('users--')).toBe(false);
      expect(isValidIdentifier('users--comment')).toBe(false);
      expect(isValidIdentifier('--users')).toBe(false);
    });

    it('should reject SQL block comment start (/*)', () => {
      expect(isValidIdentifier('users/*')).toBe(false);
      expect(isValidIdentifier('/*users')).toBe(false);
      expect(isValidIdentifier('us/*ers')).toBe(false);
    });

    it('should reject SQL block comment end (*/)', () => {
      expect(isValidIdentifier('users*/')).toBe(false);
      expect(isValidIdentifier('*/users')).toBe(false);
      expect(isValidIdentifier('us*/ers')).toBe(false);
    });
  });

  describe('SQL injection prevention - statement terminators', () => {
    it('should reject semicolons', () => {
      expect(isValidIdentifier('users;')).toBe(false);
      expect(isValidIdentifier(';users')).toBe(false);
      expect(isValidIdentifier('us;ers')).toBe(false);
      expect(isValidIdentifier(';')).toBe(false);
    });
  });

  describe('SQL injection prevention - classic attacks', () => {
    it("should reject ' OR '1'='1", () => {
      expect(isValidIdentifier("' OR '1'='1")).toBe(false);
      expect(isValidIdentifier("users' OR '1'='1")).toBe(false);
    });

    it("should reject '; DROP TABLE --", () => {
      expect(isValidIdentifier("'; DROP TABLE --")).toBe(false);
      expect(isValidIdentifier("users'; DROP TABLE users--")).toBe(false);
    });

    it('should reject UNION SELECT attacks', () => {
      expect(isValidIdentifier("' UNION SELECT")).toBe(false);
      expect(isValidIdentifier('users UNION SELECT * FROM passwords')).toBe(false);
    });

    it('should reject DELETE injection', () => {
      expect(isValidIdentifier("'; DELETE FROM users --")).toBe(false);
    });

    it('should reject INSERT injection', () => {
      expect(isValidIdentifier("'; INSERT INTO users --")).toBe(false);
    });

    it('should reject UPDATE injection', () => {
      expect(isValidIdentifier("'; UPDATE users SET --")).toBe(false);
    });

    it('should reject DROP injection', () => {
      expect(isValidIdentifier("'; DROP DATABASE --")).toBe(false);
    });

    it('should reject EXEC/EXECUTE injection', () => {
      expect(isValidIdentifier("'; EXEC xp_cmdshell --")).toBe(false);
      expect(isValidIdentifier("'; EXECUTE sp_configure --")).toBe(false);
    });

    it('should reject SQL Server xp_ procedures', () => {
      expect(isValidIdentifier('xp_cmdshell')).toBe(false);
      expect(isValidIdentifier('xp_fileexist')).toBe(false);
    });
  });

  describe('SQL injection prevention - special characters', () => {
    it('should reject backslashes', () => {
      expect(isValidIdentifier('users\\')).toBe(false);
      expect(isValidIdentifier('\\users')).toBe(false);
    });

    it('should reject null bytes', () => {
      expect(isValidIdentifier('users\x00')).toBe(false);
      expect(isValidIdentifier('\x00users')).toBe(false);
    });
  });

  describe('SQL injection prevention - unicode and encoding attacks', () => {
    it('should reject unicode characters', () => {
      expect(isValidIdentifier('users\u0027')).toBe(false); // Unicode single quote
      expect(isValidIdentifier('tbl\u2019')).toBe(false); // Right single quotation mark
    });

    it('should reject non-ASCII characters', () => {
      // Note: The identifier pattern only allows [a-zA-Z_][a-zA-Z0-9_]*
      // So any non-ASCII characters should be rejected
      expect(isValidIdentifier('\u00E9table')).toBe(false); // e with accent
      expect(isValidIdentifier('table\u00F1')).toBe(false); // n with tilde
      expect(isValidIdentifier('\u4E2D\u6587')).toBe(false); // Chinese characters
      expect(isValidIdentifier('\u0430\u0431\u0432')).toBe(false); // Cyrillic
    });
  });
});

describe('validateIdentifier', () => {
  describe('valid identifiers - returns trimmed value', () => {
    it('should return valid identifiers as-is', () => {
      expect(validateIdentifier('users', 'table')).toBe('users');
      expect(validateIdentifier('user_accounts', 'column')).toBe('user_accounts');
      expect(validateIdentifier('mydb', 'database')).toBe('mydb');
    });

    it('should trim whitespace from valid identifiers', () => {
      expect(validateIdentifier('  users  ', 'table')).toBe('users');
      expect(validateIdentifier('\tusers\n', 'table')).toBe('users');
    });
  });

  describe('invalid identifiers - throws SqlSanitizationError', () => {
    it('should throw for empty strings', () => {
      expect(() => validateIdentifier('', 'table')).toThrow(SqlSanitizationError);
      expect(() => validateIdentifier('   ', 'table')).toThrow(SqlSanitizationError);
    });

    it('should throw for null/undefined', () => {
      expect(() => validateIdentifier(null as unknown as string, 'table')).toThrow(SqlSanitizationError);
      expect(() => validateIdentifier(undefined as unknown as string, 'table')).toThrow(SqlSanitizationError);
    });

    it('should throw for SQL injection attempts with correct error details', () => {
      try {
        validateIdentifier("users'; DROP TABLE --", 'table');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SqlSanitizationError);
        const sqlError = error as SqlSanitizationError;
        expect(sqlError.identifierType).toBe('table');
        expect(sqlError.invalidValue).toBe("users'; DROP TABLE --");
      }
    });
  });

  describe('type-specific validation', () => {
    const types: IdentifierType[] = ['table', 'database', 'column', 'index', 'schema'];

    types.forEach((type) => {
      it(`should validate ${type} identifiers`, () => {
        expect(validateIdentifier('valid_name', type)).toBe('valid_name');
        expect(() => validateIdentifier("invalid'name", type)).toThrow(SqlSanitizationError);
      });
    });

    it('should enforce database max length (64 characters)', () => {
      const exactLength = 'a'.repeat(64);
      const tooLong = 'a'.repeat(65);

      expect(validateIdentifier(exactLength, 'database')).toBe(exactLength);
      expect(() => validateIdentifier(tooLong, 'database')).toThrow(SqlSanitizationError);
    });

    it('should enforce schema max length (64 characters)', () => {
      const exactLength = 'a'.repeat(64);
      const tooLong = 'a'.repeat(65);

      expect(validateIdentifier(exactLength, 'schema')).toBe(exactLength);
      expect(() => validateIdentifier(tooLong, 'schema')).toThrow(SqlSanitizationError);
    });

    it('should enforce table max length (128 characters)', () => {
      const exactLength = 'a'.repeat(128);
      const tooLong = 'a'.repeat(129);

      expect(validateIdentifier(exactLength, 'table')).toBe(exactLength);
      expect(() => validateIdentifier(tooLong, 'table')).toThrow(SqlSanitizationError);
    });
  });
});

describe('escapeIdentifier', () => {
  describe('PostgreSQL dialect', () => {
    it('should wrap identifiers in double quotes', () => {
      expect(escapeIdentifier('users', 'postgres')).toBe('"users"');
      expect(escapeIdentifier('user_accounts', 'postgres')).toBe('"user_accounts"');
    });

    it('should throw for invalid identifiers before quoting', () => {
      expect(() => escapeIdentifier("users'; DROP TABLE", 'postgres')).toThrow(SqlSanitizationError);
    });
  });

  describe('MySQL dialect', () => {
    it('should wrap identifiers in backticks', () => {
      expect(escapeIdentifier('users', 'mysql')).toBe('`users`');
      expect(escapeIdentifier('user_accounts', 'mysql')).toBe('`user_accounts`');
    });

    it('should throw for invalid identifiers before quoting', () => {
      expect(() => escapeIdentifier("users'; DROP TABLE", 'mysql')).toThrow(SqlSanitizationError);
    });
  });

  describe('SQLite dialect', () => {
    it('should wrap identifiers in double quotes', () => {
      expect(escapeIdentifier('users', 'sqlite')).toBe('"users"');
      expect(escapeIdentifier('user_accounts', 'sqlite')).toBe('"user_accounts"');
    });

    it('should throw for invalid identifiers before quoting', () => {
      expect(() => escapeIdentifier("users'; DROP TABLE", 'sqlite')).toThrow(SqlSanitizationError);
    });
  });
});

describe('escapeTypedIdentifier', () => {
  it('should escape with type-specific validation', () => {
    expect(escapeTypedIdentifier('users', 'table', 'postgres')).toBe('"users"');
    expect(escapeTypedIdentifier('id', 'column', 'mysql')).toBe('`id`');
    expect(escapeTypedIdentifier('mydb', 'database', 'sqlite')).toBe('"mydb"');
  });

  it('should apply type-specific length limits', () => {
    const longName = 'a'.repeat(65);
    // Should fail for database (max 64) but succeed for table (max 128)
    expect(() => escapeTypedIdentifier(longName, 'database', 'postgres')).toThrow(SqlSanitizationError);
    expect(escapeTypedIdentifier(longName, 'table', 'postgres')).toBe(`"${longName}"`);
  });
});

describe('escapeQualifiedIdentifier', () => {
  it('should escape schema and table separately', () => {
    expect(escapeQualifiedIdentifier('public', 'users', 'postgres')).toBe('"public"."users"');
    expect(escapeQualifiedIdentifier('myschema', 'accounts', 'mysql')).toBe('`myschema`.`accounts`');
  });

  it('should handle undefined schema', () => {
    expect(escapeQualifiedIdentifier(undefined, 'users', 'postgres')).toBe('"users"');
  });

  it('should throw for invalid schema names', () => {
    expect(() => escapeQualifiedIdentifier("bad'schema", 'users', 'postgres')).toThrow(SqlSanitizationError);
  });

  it('should throw for invalid table names', () => {
    expect(() => escapeQualifiedIdentifier('public', "bad'table", 'postgres')).toThrow(SqlSanitizationError);
  });
});

describe('validateIdentifiers', () => {
  it('should validate array of identifiers', () => {
    const result = validateIdentifiers(['users', 'accounts', 'orders'], 'table');
    expect(result).toEqual(['users', 'accounts', 'orders']);
  });

  it('should throw on first invalid identifier', () => {
    expect(() => validateIdentifiers(['users', "bad'table", 'orders'], 'table')).toThrow(SqlSanitizationError);
  });

  it('should handle empty array', () => {
    expect(validateIdentifiers([], 'table')).toEqual([]);
  });

  it('should trim all identifiers', () => {
    const result = validateIdentifiers(['  users  ', '\taccounts\n'], 'table');
    expect(result).toEqual(['users', 'accounts']);
  });
});

describe('interpolateTableName', () => {
  it('should replace ${table} placeholder with escaped table name', () => {
    const result = interpolateTableName('SELECT * FROM ${table}', 'users', 'postgres');
    expect(result).toBe('SELECT * FROM "users"');
  });

  it('should replace multiple occurrences', () => {
    const sql = 'SELECT * FROM ${table} WHERE id IN (SELECT id FROM ${table})';
    const result = interpolateTableName(sql, 'users', 'mysql');
    expect(result).toBe('SELECT * FROM `users` WHERE id IN (SELECT id FROM `users`)');
  });

  it('should throw for invalid table names', () => {
    expect(() => interpolateTableName('SELECT * FROM ${table}', "bad'table", 'postgres')).toThrow(
      SqlSanitizationError
    );
  });

  it('should return SQL unchanged if no placeholder', () => {
    const result = interpolateTableName('SELECT 1', 'users', 'postgres');
    expect(result).toBe('SELECT 1');
  });
});

describe('safeTruncate', () => {
  it('should generate PostgreSQL TRUNCATE statement', () => {
    expect(safeTruncate('users', 'postgres')).toBe('TRUNCATE TABLE "users"');
  });

  it('should generate PostgreSQL TRUNCATE with CASCADE', () => {
    expect(safeTruncate('users', 'postgres', true)).toBe('TRUNCATE TABLE "users" CASCADE');
  });

  it('should generate MySQL TRUNCATE statement (no CASCADE)', () => {
    expect(safeTruncate('users', 'mysql')).toBe('TRUNCATE TABLE `users`');
    expect(safeTruncate('users', 'mysql', true)).toBe('TRUNCATE TABLE `users`'); // CASCADE ignored
  });

  it('should generate SQLite DELETE statement (no TRUNCATE support)', () => {
    expect(safeTruncate('users', 'sqlite')).toBe('DELETE FROM "users"');
  });

  it('should throw for invalid table names', () => {
    expect(() => safeTruncate("users'; DROP TABLE --", 'postgres')).toThrow(SqlSanitizationError);
  });
});

describe('safeDropDatabase', () => {
  it('should generate DROP DATABASE with IF EXISTS by default', () => {
    expect(safeDropDatabase('testdb', 'postgres')).toBe('DROP DATABASE IF EXISTS "testdb"');
    expect(safeDropDatabase('testdb', 'mysql')).toBe('DROP DATABASE IF EXISTS `testdb`');
  });

  it('should generate DROP DATABASE without IF EXISTS when specified', () => {
    expect(safeDropDatabase('testdb', 'postgres', false)).toBe('DROP DATABASE "testdb"');
  });

  it('should throw for invalid database names', () => {
    expect(() => safeDropDatabase("db'; DROP DATABASE --", 'postgres')).toThrow(SqlSanitizationError);
  });
});

describe('safePragmaTableInfo', () => {
  it('should generate safe PRAGMA table_info statement', () => {
    expect(safePragmaTableInfo('users')).toBe("PRAGMA table_info('users')");
  });

  it('should throw for invalid table names', () => {
    expect(() => safePragmaTableInfo("users'; DROP TABLE --")).toThrow(SqlSanitizationError);
  });
});

describe('safePragmaIndexInfo', () => {
  it('should generate safe PRAGMA index_info statement', () => {
    expect(safePragmaIndexInfo('idx_users_email')).toBe("PRAGMA index_info('idx_users_email')");
  });

  it('should throw for invalid index names', () => {
    expect(() => safePragmaIndexInfo("idx'; DROP INDEX --")).toThrow(SqlSanitizationError);
  });
});

describe('safePragmaForeignKeyList', () => {
  it('should generate safe PRAGMA foreign_key_list statement', () => {
    expect(safePragmaForeignKeyList('orders')).toBe("PRAGMA foreign_key_list('orders')");
  });

  it('should throw for invalid table names', () => {
    expect(() => safePragmaForeignKeyList("orders'; --")).toThrow(SqlSanitizationError);
  });
});

describe('safeVacuumInto', () => {
  it('should generate safe VACUUM INTO statement', () => {
    expect(safeVacuumInto('/path/to/backup.db')).toBe("VACUUM INTO '/path/to/backup.db'");
  });

  it('should allow paths with various characters', () => {
    expect(safeVacuumInto('/home/user/my-backup.db')).toBe("VACUUM INTO '/home/user/my-backup.db'");
    expect(safeVacuumInto('C:\\Users\\test\\backup.db')).toBe("VACUUM INTO 'C:\\Users\\test\\backup.db'");
  });

  it('should throw for paths with single quotes', () => {
    expect(() => safeVacuumInto("/path/with'quote/backup.db")).toThrow(SqlSanitizationError);
  });

  it('should throw for paths with semicolons', () => {
    expect(() => safeVacuumInto('/path/to/backup.db; DROP TABLE users')).toThrow(SqlSanitizationError);
  });

  it('should throw for paths with SQL comments', () => {
    expect(() => safeVacuumInto('/path/to/backup.db--comment')).toThrow(SqlSanitizationError);
  });
});

describe('safeAnalyze', () => {
  it('should generate ANALYZE without table name', () => {
    expect(safeAnalyze(undefined, 'sqlite')).toBe('ANALYZE');
    expect(safeAnalyze(undefined, 'postgres')).toBe('ANALYZE');
  });

  it('should generate PostgreSQL ANALYZE with table', () => {
    expect(safeAnalyze('users', 'postgres')).toBe('ANALYZE "users"');
  });

  it('should generate MySQL ANALYZE TABLE', () => {
    expect(safeAnalyze('users', 'mysql')).toBe('ANALYZE TABLE `users`');
  });

  it('should generate SQLite ANALYZE with single quotes', () => {
    expect(safeAnalyze('users', 'sqlite')).toBe("ANALYZE 'users'");
  });

  it('should throw for invalid table names', () => {
    expect(() => safeAnalyze("users'; --", 'postgres')).toThrow(SqlSanitizationError);
  });
});

describe('safeOptimizeTable', () => {
  it('should generate MySQL OPTIMIZE TABLE statement', () => {
    expect(safeOptimizeTable('users')).toBe('OPTIMIZE TABLE `users`');
  });

  it('should throw for invalid table names', () => {
    expect(() => safeOptimizeTable("users'; --")).toThrow(SqlSanitizationError);
  });
});

describe('safeCheckTable', () => {
  it('should generate MySQL CHECK TABLE statement', () => {
    expect(safeCheckTable('users')).toBe('CHECK TABLE `users`');
  });

  it('should throw for invalid table names', () => {
    expect(() => safeCheckTable("users'; --")).toThrow(SqlSanitizationError);
  });
});

describe('safeRepairTable', () => {
  it('should generate MySQL REPAIR TABLE statement', () => {
    expect(safeRepairTable('users')).toBe('REPAIR TABLE `users`');
  });

  it('should throw for invalid table names', () => {
    expect(() => safeRepairTable("users'; --")).toThrow(SqlSanitizationError);
  });
});

describe('safeVacuumAnalyze', () => {
  it('should generate PostgreSQL VACUUM ANALYZE statement', () => {
    expect(safeVacuumAnalyze('users')).toBe('VACUUM ANALYZE "users"');
  });

  it('should throw for invalid table names', () => {
    expect(() => safeVacuumAnalyze("users'; --")).toThrow(SqlSanitizationError);
  });
});

describe('safeCreateExtension', () => {
  it('should generate PostgreSQL CREATE EXTENSION statement', () => {
    expect(safeCreateExtension('uuid_ossp')).toBe('CREATE EXTENSION IF NOT EXISTS "uuid_ossp"');
    expect(safeCreateExtension('postgis')).toBe('CREATE EXTENSION IF NOT EXISTS "postgis"');
  });

  it('should throw for invalid extension names', () => {
    expect(() => safeCreateExtension("ext'; --")).toThrow(SqlSanitizationError);
  });
});

describe('safeTerminateBackendQuery', () => {
  it('should return parameterized query', () => {
    const result = safeTerminateBackendQuery('mydb');

    expect(result.sql).toContain('pg_terminate_backend');
    expect(result.sql).toContain('$1');
    expect(result.params).toEqual(['mydb']);
  });

  it('should validate database name before returning', () => {
    expect(() => safeTerminateBackendQuery("mydb'; --")).toThrow(SqlSanitizationError);
  });
});

describe('comprehensive SQL injection attack vectors', () => {
  const dialects: SqlDialect[] = ['postgres', 'mysql', 'sqlite'];

  describe('tautology attacks', () => {
    const tautologyAttacks = [
      "' OR '1'='1",
      "' OR 1=1--",
      "' OR 'x'='x",
      '" OR "1"="1',
      "' OR ''='",
      "1' OR '1'='1'/*",
    ];

    tautologyAttacks.forEach((attack) => {
      it(`should reject tautology attack: ${attack}`, () => {
        expect(isValidIdentifier(attack)).toBe(false);
        dialects.forEach((dialect) => {
          expect(() => escapeIdentifier(attack, dialect)).toThrow(SqlSanitizationError);
        });
      });
    });
  });

  describe('UNION-based attacks', () => {
    const unionAttacks = [
      "' UNION SELECT * FROM users--",
      "' UNION ALL SELECT NULL,NULL,NULL--",
      "1 UNION SELECT username, password FROM users",
      "' UNION SELECT 1,2,3,4,5--",
    ];

    unionAttacks.forEach((attack) => {
      it(`should reject UNION attack: ${attack}`, () => {
        expect(isValidIdentifier(attack)).toBe(false);
      });
    });
  });

  describe('piggy-backed queries', () => {
    const piggybackAttacks = [
      "'; DROP TABLE users--",
      "'; DELETE FROM users WHERE 1=1--",
      "'; INSERT INTO users VALUES('hacker','hacker')--",
      "'; UPDATE users SET password='hacked'--",
      "'; TRUNCATE TABLE users--",
    ];

    piggybackAttacks.forEach((attack) => {
      it(`should reject piggy-backed query: ${attack}`, () => {
        expect(isValidIdentifier(attack)).toBe(false);
      });
    });
  });

  describe('comment-based attacks', () => {
    const commentAttacks = ['admin--', 'admin/*', '*/admin', 'admin#', "admin'--", "admin'/*comment*/"];

    commentAttacks.forEach((attack) => {
      it(`should reject comment attack: ${attack}`, () => {
        expect(isValidIdentifier(attack)).toBe(false);
      });
    });
  });

  describe('second-order injection attempts', () => {
    // These might look valid but contain dangerous patterns
    const secondOrderAttacks = [
      "admin'--",
      'user; DROP',
      'SELECT * FROM',
      "x' OR 'y",
      'table`name',
      'schema"name',
    ];

    secondOrderAttacks.forEach((attack) => {
      it(`should reject second-order attempt: ${attack}`, () => {
        expect(isValidIdentifier(attack)).toBe(false);
      });
    });
  });

  describe('encoding bypass attempts', () => {
    const encodingAttacks = [
      "users%27", // URL-encoded quote (fails because % is invalid)
      "users\\'", // Escaped backslash + quote
      'users\x27', // Hex-encoded quote
      "users\u0027", // Unicode quote
    ];

    encodingAttacks.forEach((attack) => {
      it(`should reject encoding attack: ${attack}`, () => {
        expect(isValidIdentifier(attack)).toBe(false);
      });
    });
  });

  describe('case variation attacks', () => {
    const caseAttacks = [
      "' oR '1'='1",
      "' Or '1'='1",
      "' OR '1'='1",
      "' UNION SELECT",
      "' uNiOn SeLeCt",
      "' UnIoN sElEcT",
    ];

    caseAttacks.forEach((attack) => {
      it(`should reject case variation: ${attack}`, () => {
        expect(isValidIdentifier(attack)).toBe(false);
      });
    });
  });

  describe('stored procedure attacks', () => {
    const spAttacks = [
      "; EXEC xp_cmdshell('dir')--",
      "; EXECUTE sp_configure 'show advanced options'--",
      "'; xp_regread--",
      "'; xp_fileexist--",
    ];

    spAttacks.forEach((attack) => {
      it(`should reject stored procedure attack: ${attack}`, () => {
        expect(isValidIdentifier(attack)).toBe(false);
      });
    });
  });

  describe('boolean-based blind injection', () => {
    const blindAttacks = [
      "' AND 1=1--",
      "' AND 1=2--",
      "' AND SUBSTRING(username,1,1)='a'--",
      "' AND (SELECT COUNT(*) FROM users)>0--",
    ];

    blindAttacks.forEach((attack) => {
      it(`should reject blind injection: ${attack}`, () => {
        expect(isValidIdentifier(attack)).toBe(false);
      });
    });
  });

  describe('time-based blind injection', () => {
    const timeAttacks = [
      "'; WAITFOR DELAY '0:0:5'--",
      "'; SELECT SLEEP(5)--",
      "' OR SLEEP(5)--",
      "' AND BENCHMARK(10000000,SHA1('test'))--",
    ];

    timeAttacks.forEach((attack) => {
      it(`should reject time-based attack: ${attack}`, () => {
        expect(isValidIdentifier(attack)).toBe(false);
      });
    });
  });

  describe('out-of-band attacks', () => {
    const oobAttacks = [
      "'; SELECT * INTO OUTFILE '/tmp/results.txt'--",
      "'; LOAD_FILE('/etc/passwd')--",
      "'; COPY users TO '/tmp/users.txt'--",
    ];

    oobAttacks.forEach((attack) => {
      it(`should reject out-of-band attack: ${attack}`, () => {
        expect(isValidIdentifier(attack)).toBe(false);
      });
    });
  });
});

describe('edge cases and boundary conditions', () => {
  describe('boundary length testing', () => {
    it('should accept exactly 128 character table names', () => {
      const name = 'a'.repeat(128);
      expect(isValidIdentifier(name)).toBe(true);
      expect(validateIdentifier(name, 'table')).toBe(name);
    });

    it('should reject 129 character table names', () => {
      const name = 'a'.repeat(129);
      expect(isValidIdentifier(name)).toBe(false);
    });

    it('should accept exactly 64 character database names', () => {
      const name = 'a'.repeat(64);
      expect(validateIdentifier(name, 'database')).toBe(name);
    });

    it('should reject 65 character database names', () => {
      const name = 'a'.repeat(65);
      expect(() => validateIdentifier(name, 'database')).toThrow(SqlSanitizationError);
    });
  });

  describe('whitespace handling', () => {
    it('should trim leading and trailing whitespace', () => {
      expect(validateIdentifier('  users  ', 'table')).toBe('users');
      expect(validateIdentifier('\tusers\t', 'table')).toBe('users');
      expect(validateIdentifier('\nusers\n', 'table')).toBe('users');
      expect(validateIdentifier('\r\nusers\r\n', 'table')).toBe('users');
    });

    it('should reject names that become empty after trimming', () => {
      expect(() => validateIdentifier('   ', 'table')).toThrow(SqlSanitizationError);
      expect(() => validateIdentifier('\t\n\r', 'table')).toThrow(SqlSanitizationError);
    });

    it('should reject names with internal whitespace', () => {
      expect(isValidIdentifier('user name')).toBe(false);
      expect(isValidIdentifier('user\tname')).toBe(false);
      expect(isValidIdentifier('user\nname')).toBe(false);
    });
  });

  describe('special identifier patterns', () => {
    it('should accept underscore-only names', () => {
      expect(isValidIdentifier('_')).toBe(true);
      expect(isValidIdentifier('__')).toBe(true);
      expect(isValidIdentifier('___')).toBe(true);
    });

    it('should accept names ending with underscore', () => {
      expect(isValidIdentifier('users_')).toBe(true);
      expect(isValidIdentifier('users__')).toBe(true);
    });

    it('should accept names with consecutive underscores', () => {
      expect(isValidIdentifier('user__accounts')).toBe(true);
      expect(isValidIdentifier('a__b__c')).toBe(true);
    });

    it('should accept single letter names', () => {
      expect(isValidIdentifier('a')).toBe(true);
      expect(isValidIdentifier('Z')).toBe(true);
    });

    it('should accept common naming conventions', () => {
      // snake_case
      expect(isValidIdentifier('user_accounts')).toBe(true);
      // camelCase
      expect(isValidIdentifier('userAccounts')).toBe(true);
      // PascalCase
      expect(isValidIdentifier('UserAccounts')).toBe(true);
      // SCREAMING_SNAKE_CASE
      expect(isValidIdentifier('USER_ACCOUNTS')).toBe(true);
    });
  });

  describe('dialect-specific edge cases', () => {
    it('should handle all dialects consistently for valid names', () => {
      const validName = 'user_accounts_2023';
      expect(escapeIdentifier(validName, 'postgres')).toBe('"user_accounts_2023"');
      expect(escapeIdentifier(validName, 'mysql')).toBe('`user_accounts_2023`');
      expect(escapeIdentifier(validName, 'sqlite')).toBe('"user_accounts_2023"');
    });

    it('should handle qualified identifiers with all dialects', () => {
      expect(escapeQualifiedIdentifier('public', 'users', 'postgres')).toBe('"public"."users"');
      expect(escapeQualifiedIdentifier('public', 'users', 'mysql')).toBe('`public`.`users`');
      expect(escapeQualifiedIdentifier('public', 'users', 'sqlite')).toBe('"public"."users"');
    });
  });
});
