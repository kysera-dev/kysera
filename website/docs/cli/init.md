---
sidebar_position: 2
title: init
description: Initialize a new Kysera project
---

# kysera init

Initialize a new Kysera project with interactive or command-line options.

## Usage

```bash
kysera init [project-name]
```

## Options

```
-t, --template <name>         Project template (default: basic)
                              Options: basic, api, graphql, monorepo
-d, --database <dialect>      Database dialect (default: postgres)
                              Options: postgres, mysql, sqlite
-p, --plugins <list>          Comma-separated plugin names
                              Default: timestamps,soft-delete
--package-manager <pm>        Package manager (npm/pnpm/yarn/bun)
--typescript                  Use TypeScript (default: true)
--no-typescript               Use JavaScript
--git                         Initialize git repository (default: true)
--no-git                      Skip git initialization
--install                     Install dependencies (default: true)
--no-install                  Skip dependency installation
```

## Templates

### basic

Minimal setup with core packages:

```
my-app/
├── src/
│   └── index.ts
├── migrations/
├── package.json
├── tsconfig.json
├── kysera.config.ts
└── .env.example
```

### api

Express.js REST API setup:

```
my-app/
├── src/
│   ├── index.ts
│   ├── routes/
│   ├── repositories/
│   └── middleware/
├── migrations/
└── ...
```

### graphql

Apollo GraphQL server:

```
my-app/
├── src/
│   ├── index.ts
│   ├── schema/
│   ├── resolvers/
│   └── repositories/
└── ...
```

### monorepo

Turborepo monorepo structure:

```
my-app/
├── apps/
│   └── api/
├── packages/
│   ├── database/
│   └── shared/
├── turbo.json
└── pnpm-workspace.yaml
```

## Available Plugins

Select during initialization:

- `timestamps` - Automatic created_at/updated_at
- `soft-delete` - Soft delete functionality
- `audit` - Audit logging
- `rls` - Row-level security

## Examples

### Interactive Mode

```bash
kysera init my-app
# Prompts for all options
```

### Non-Interactive

```bash
# API with PostgreSQL
kysera init my-app -d postgres -t api

# GraphQL with MySQL
kysera init my-app -d mysql -t graphql

# With specific plugins
kysera init my-app -p timestamps,audit,rls

# Current directory
kysera init . -d postgres
```

## Generated Files

### kysera.config.ts

```typescript
import { defineConfig } from '@kysera/cli'

export default defineConfig({
  database: {
    dialect: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'myapp',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD
  },
  migrations: {
    directory: './migrations',
    tableName: 'kysera_migrations'
  },
  plugins: {
    '@kysera/timestamps': { enabled: true },
    '@kysera/soft-delete': { enabled: true }
  }
})
```

### .env.example

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=myapp
DB_USER=postgres
DB_PASSWORD=
```
