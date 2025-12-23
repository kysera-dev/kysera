---
sidebar_position: 5
---

# Multi-Database Configuration

Kysera supports multiple database systems through Kysely's dialect system. This guide covers how to configure and work with PostgreSQL, MySQL, SQLite, and MSSQL.

## Overview

Kysera is database-agnostic and works seamlessly with:

- **PostgreSQL** - Full support for all features
- **MySQL** - Full support for all features
- **SQLite** - Full support with minor behavioral differences
- **MSSQL** - Full support with specific constraints

All Kysera packages (Repository, DAL, plugins) work identically across databases, with automatic handling of dialect-specific behaviors.

## Database Connection Setup

### PostgreSQL

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'

interface Database {
  users: {
    id: number
    name: string
    email: string
    is_active: boolean
    created_at: Date
  }
}

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: 'postgresql://user:password@localhost:5432/mydb',
      max: 10
    })
  })
})
```

**Installation:**

```bash
pnpm add kysely pg
pnpm add -D @types/pg
```

**Connection options:**

```typescript
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'mydb',
  user: 'postgres',
  password: 'secret',
  max: 10, // Connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
})
```

### MySQL

```typescript
import { Kysely, MysqlDialect } from 'kysely'
import { createPool } from 'mysql2'

const db = new Kysely<Database>({
  dialect: new MysqlDialect({
    pool: createPool({
      uri: 'mysql://user:password@localhost:3306/mydb',
      connectionLimit: 10
    })
  })
})
```

**Installation:**

```bash
pnpm add kysely mysql2
```

**Connection options:**

```typescript
const pool = createPool({
  host: 'localhost',
  port: 3306,
  database: 'mydb',
  user: 'root',
  password: 'secret',
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0
})
```

### SQLite

```typescript
import { Kysely, SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'

const db = new Kysely<Database>({
  dialect: new SqliteDialect({
    database: new Database('mydb.sqlite')
  })
})
```

**Installation:**

```bash
pnpm add kysely better-sqlite3
pnpm add -D @types/better-sqlite3
```

**In-memory database:**

```typescript
const db = new Kysely<Database>({
  dialect: new SqliteDialect({
    database: new Database(':memory:')
  })
})
```

**Connection options:**

```typescript
const database = new Database('mydb.sqlite', {
  readonly: false,
  fileMustExist: false,
  timeout: 5000,
  verbose: console.log // Enable query logging
})
```

### MSSQL

```typescript
import { Kysely, MssqlDialect } from 'kysely'
import * as Tedious from 'tedious'
import * as Tarn from 'tarn'

const db = new Kysely<Database>({
  dialect: new MssqlDialect({
    tarn: {
      ...Tarn,
      options: {
        min: 0,
        max: 10
      }
    },
    tedious: {
      connectionFactory: () =>
        new Tedious.Connection({
          server: 'localhost',
          authentication: {
            type: 'default',
            options: {
              userName: 'sa',
              password: 'YourPassword123'
            }
          },
          options: {
            database: 'mydb',
            port: 1433,
            trustServerCertificate: true
          }
        }),
      errorHandler: err => {
        console.error('MSSQL connection error:', err)
      }
    }
  })
})
```

**Installation:**

```bash
pnpm add kysely tedious tarn
pnpm add -D @types/tedious @types/tarn
```

## Dialect-Specific Considerations

### Boolean Handling

Different databases handle boolean values differently:

```typescript
// PostgreSQL & MySQL: Native boolean support
await db.insertInto('users').values({ is_active: true }).execute()

// SQLite: Uses integers (0/1)
await db.insertInto('users').values({ is_active: 1 }).execute()

// Type-safe cross-database approach
interface User {
  id: number
  is_active: boolean // TypeScript type is always boolean
}

// Kysely handles conversion automatically
const user = await db
  .selectFrom('users')
  .selectAll()
  .where('id', '=', 1)
  .executeTakeFirst()

console.log(user.is_active) // Always boolean in TypeScript
```

### Auto-Increment Columns

Each database has different syntax for auto-incrementing primary keys:

**PostgreSQL:**

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

-- Or with BIGSERIAL for larger IDs
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
```

**MySQL:**

```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);
```

**SQLite:**

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);
```

**MSSQL:**

```sql
CREATE TABLE users (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(255) NOT NULL
);
```

### Pagination

MSSQL requires `ORDER BY` for `OFFSET`/`FETCH` pagination:

```typescript
import { createPagination } from '@kysera/core'

// Works on all databases
const { data, metadata } = await createPagination(
  db.selectFrom('users').selectAll().orderBy('id', 'asc'), // ORDER BY required for MSSQL
  { page: 1, limit: 10 }
)
```

**MSSQL-specific limitation:**

```typescript
// ❌ ERROR on MSSQL: ORDER BY is required
await db
  .selectFrom('users')
  .selectAll()
  .limit(10)
  .offset(20)
  .execute()

// ✅ CORRECT: Always include ORDER BY
await db
  .selectFrom('users')
  .selectAll()
  .orderBy('id', 'asc')
  .limit(10)
  .offset(20)
  .execute()
```

### Foreign Key Constraints

**MSSQL limitation:** Cannot have multiple cascade paths to the same table.

```sql
-- ❌ ERROR on MSSQL: Multiple cascade paths
CREATE TABLE orders (
  id INT IDENTITY(1,1) PRIMARY KEY,
  user_id INT NOT NULL,
  created_by INT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- ✅ SOLUTION: Use NO ACTION for one of the constraints
CREATE TABLE orders (
  id INT IDENTITY(1,1) PRIMARY KEY,
  user_id INT NOT NULL,
  created_by INT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE NO ACTION
);
```

### JSON Support

```typescript
// PostgreSQL: Native JSON/JSONB support
await db
  .selectFrom('users')
  .select(eb => eb.fn('json_extract', ['metadata', '$.age']).as('age'))
  .execute()

// MySQL: JSON functions
await db
  .selectFrom('users')
  .select(eb => eb.fn('JSON_EXTRACT', ['metadata', '$.age']).as('age'))
  .execute()

// SQLite: JSON functions (if compiled with JSON1)
await db
  .selectFrom('users')
  .select(eb => eb.fn('json_extract', ['metadata', '$.age']).as('age'))
  .execute()

// MSSQL: JSON functions (SQL Server 2016+)
await db
  .selectFrom('users')
  .select(eb => eb.fn('JSON_VALUE', ['metadata', '$.age']).as('age'))
  .execute()
```

### Date/Time Handling

```typescript
// All databases support Date objects
await db.insertInto('users').values({
  name: 'Alice',
  created_at: new Date()
}).execute()

// Kysely handles conversion automatically
const user = await db
  .selectFrom('users')
  .selectAll()
  .where('id', '=', 1)
  .executeTakeFirst()

console.log(user.created_at instanceof Date) // true
```

## Environment-Based Configuration

Create a flexible database configuration that switches based on environment:

```typescript
// db.ts
import { Kysely, PostgresDialect, MysqlDialect, SqliteDialect, MssqlDialect } from 'kysely'
import { Pool } from 'pg'
import { createPool } from 'mysql2'
import Database from 'better-sqlite3'
import * as Tedious from 'tedious'
import * as Tarn from 'tarn'

interface Database {
  users: {
    id: number
    name: string
    email: string
    is_active: boolean
    created_at: Date
  }
}

function createDialect() {
  const dbType = process.env.DATABASE_TYPE || 'sqlite'

  switch (dbType) {
    case 'postgres':
      return new PostgresDialect({
        pool: new Pool({
          connectionString: process.env.DATABASE_URL,
          max: Number(process.env.DB_POOL_MAX) || 10
        })
      })

    case 'mysql':
      return new MysqlDialect({
        pool: createPool({
          uri: process.env.DATABASE_URL,
          connectionLimit: Number(process.env.DB_POOL_MAX) || 10
        })
      })

    case 'mssql':
      return new MssqlDialect({
        tarn: {
          ...Tarn,
          options: {
            min: 0,
            max: Number(process.env.DB_POOL_MAX) || 10
          }
        },
        tedious: {
          connectionFactory: () => new Tedious.Connection({
            server: process.env.DB_HOST || 'localhost',
            authentication: {
              type: 'default',
              options: {
                userName: process.env.DB_USER || 'sa',
                password: process.env.DB_PASSWORD || ''
              }
            },
            options: {
              database: process.env.DB_NAME || 'mydb',
              port: Number(process.env.DB_PORT) || 1433,
              trustServerCertificate: true
            }
          })
        }
      })

    default: // SQLite
      return new SqliteDialect({
        database: new Database(process.env.DATABASE_URL || 'mydb.sqlite')
      })
  }
}

export const db = new Kysely<Database>({
  dialect: createDialect()
})
```

**.env configuration:**

```bash
# PostgreSQL
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://user:password@localhost:5432/mydb
DB_POOL_MAX=10

# MySQL
DATABASE_TYPE=mysql
DATABASE_URL=mysql://user:password@localhost:3306/mydb
DB_POOL_MAX=10

# SQLite
DATABASE_TYPE=sqlite
DATABASE_URL=mydb.sqlite

# MSSQL
DATABASE_TYPE=mssql
DB_HOST=localhost
DB_PORT=1433
DB_USER=sa
DB_PASSWORD=YourPassword123
DB_NAME=mydb
DB_POOL_MAX=10
```

## Cross-Database Repository Example

Create repositories that work across all databases:

```typescript
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { timestampsPlugin } from '@kysera/timestamps'
import { db } from './db'

// Works identically on PostgreSQL, MySQL, SQLite, MSSQL
const orm = await createORM(db, [
  softDeletePlugin(),
  timestampsPlugin()
])

const userRepo = orm.createRepository((builder, db) => {
  const base = builder
    .table('users')
    .identifier('id')
    .returning(['id', 'name', 'email', 'is_active', 'created_at'])

  return {
    ...base,

    async findActive() {
      return db
        .selectFrom('users')
        .selectAll()
        .where('is_active', '=', true) // Kysely handles boolean conversion
        .orderBy('id', 'asc') // Required for MSSQL pagination
        .execute()
    },

    async searchByEmail(email: string) {
      return db
        .selectFrom('users')
        .selectAll()
        .where('email', 'like', `%${email}%`)
        .execute()
    }
  }
})

// Use the repository - works on any database
const users = await userRepo.findActive()
const matches = await userRepo.searchByEmail('example.com')
```

## Testing Across Databases

### Test Configuration

```typescript
// test/helpers/db.ts
import { Kysely } from 'kysely'
import { describe, test, beforeEach, afterEach } from 'vitest'

export async function setupTestDatabase(dbType: string) {
  // Create database connection based on type
  const db = createTestDb(dbType)

  // Run migrations
  await migrateToLatest(db)

  return db
}

export function describeMultiDb(name: string, tests: (db: Kysely<Database>) => void) {
  const databases = []

  if (process.env.TEST_POSTGRES) databases.push('postgres')
  if (process.env.TEST_MYSQL) databases.push('mysql')
  if (process.env.TEST_MSSQL) databases.push('mssql')
  if (databases.length === 0) databases.push('sqlite') // Default

  for (const dbType of databases) {
    describe(`${name} [${dbType}]`, () => {
      let db: Kysely<Database>

      beforeEach(async () => {
        db = await setupTestDatabase(dbType)
      })

      afterEach(async () => {
        await db.destroy()
      })

      tests(db)
    })
  }
}
```

### Test Example

```typescript
// test/repository.test.ts
import { describeMultiDb } from './helpers/db'
import { createORM } from '@kysera/repository'

describeMultiDb('User Repository', db => {
  test('creates user with auto-increment ID', async ({ expect }) => {
    const orm = await createORM(db, [])
    const userRepo = orm.createRepository(createUserRepository)

    const user = await userRepo.create({
      name: 'Alice',
      email: 'alice@example.com',
      is_active: true
    })

    expect(user.id).toBeGreaterThan(0)
    expect(user.name).toBe('Alice')
  })

  test('soft delete works across databases', async ({ expect }) => {
    const orm = await createORM(db, [softDeletePlugin()])
    const userRepo = orm.createRepository(createUserRepository)

    const user = await userRepo.create({ name: 'Bob', email: 'bob@example.com' })
    await userRepo.softDelete(user.id)

    const found = await userRepo.findById(user.id)
    expect(found).toBeUndefined()
  })
})
```

### Docker Setup

**docker-compose.yml:**

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: kysera_test
    ports:
      - '5432:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U test']
      interval: 5s
      timeout: 5s
      retries: 5

  mysql:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: test
      MYSQL_DATABASE: kysera_test
    ports:
      - '3306:3306'
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost']
      interval: 5s
      timeout: 5s
      retries: 5

  mssql:
    image: mcr.microsoft.com/mssql/server:2022-latest
    environment:
      ACCEPT_EULA: Y
      SA_PASSWORD: YourPassword123
    ports:
      - '1433:1433'
    healthcheck:
      test: /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P YourPassword123 -Q "SELECT 1"
      interval: 5s
      timeout: 5s
      retries: 5
```

**Test commands:**

```bash
# Start all databases
docker-compose up -d

# Wait for health checks
docker-compose ps

# Run tests
TEST_POSTGRES=1 TEST_MYSQL=1 TEST_MSSQL=1 pnpm test

# Cleanup
docker-compose down -v
```

### CI/CD Matrix Testing

**.github/workflows/test.yml:**

```yaml
name: Test Multi-Database

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    strategy:
      matrix:
        database: [postgres, mysql, mssql, sqlite]

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: kysera_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

      mysql:
        image: mysql:8
        env:
          MYSQL_ROOT_PASSWORD: test
          MYSQL_DATABASE: kysera_test
        options: >-
          --health-cmd "mysqladmin ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 3306:3306

      mssql:
        image: mcr.microsoft.com/mssql/server:2022-latest
        env:
          ACCEPT_EULA: Y
          SA_PASSWORD: YourPassword123
        ports:
          - 1433:1433

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: corepack enable
      - run: pnpm install
      - run: pnpm build

      - name: Test ${{ matrix.database }}
        env:
          TEST_POSTGRES: ${{ matrix.database == 'postgres' && '1' || '' }}
          TEST_MYSQL: ${{ matrix.database == 'mysql' && '1' || '' }}
          TEST_MSSQL: ${{ matrix.database == 'mssql' && '1' || '' }}
        run: pnpm test
```

## Migration Considerations

Use Kysera's migration system with database-specific SQL when needed:

```typescript
import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  const dialect = db.getExecutor().adapter.constructor.name

  // Common structure
  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', col => {
      // Dialect-specific auto-increment
      if (dialect.includes('Postgres')) {
        return col.generatedAlwaysAsIdentity().primaryKey()
      } else if (dialect.includes('Mysql')) {
        return col.autoIncrement().primaryKey()
      } else if (dialect.includes('Mssql')) {
        return col.primaryKey()
      } else {
        // SQLite
        return col.autoIncrement().primaryKey()
      }
    })
    .addColumn('name', 'varchar(255)', col => col.notNull())
    .addColumn('email', 'varchar(255)', col => col.notNull().unique())
    .addColumn('is_active', 'boolean', col => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamp', col =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('users').execute()
}
```

## Best Practices

1. **Always use ORDER BY with pagination** - Required for MSSQL, good practice for all databases

2. **Test on target database** - While Kysera abstracts differences, always test on your production database type

3. **Use database-agnostic types** - Stick to common column types when possible:
   - `integer`, `varchar`, `text`, `boolean`, `timestamp`, `date`, `decimal`

4. **Handle boolean carefully** - Let Kysely handle conversion, always use TypeScript boolean type

5. **Avoid database-specific features in core logic** - Keep dialect-specific code in migrations

6. **Use environment variables** - Make database selection configurable

7. **Connection pooling** - Configure appropriate pool sizes for your workload

8. **Foreign key constraints** - Be aware of MSSQL cascade limitations

9. **JSON operations** - Abstract behind functions when using JSON features

10. **Date/time zones** - Store UTC timestamps, convert in application layer

## Next Steps

- [Migrations Guide](./migrations) - Database schema versioning
- [Repository Pattern](../api/repository) - Type-safe repositories
- [DAL Pattern](../api/dal) - Functional data access
- [Plugins](/docs/plugins/overview) - Cross-database features

## Resources

- [Kysely Dialects Documentation](https://kysely.dev/docs/dialects)
- [PostgreSQL Dialect](https://github.com/kysely-org/kysely/tree/master/src/dialect/postgres)
- [MySQL Dialect](https://github.com/kysely-org/kysely/tree/master/src/dialect/mysql)
- [SQLite Dialect](https://github.com/kysely-org/kysely/tree/master/src/dialect/sqlite)
- [MSSQL Dialect](https://github.com/kysely-org/kysely/tree/master/src/dialect/mssql)
