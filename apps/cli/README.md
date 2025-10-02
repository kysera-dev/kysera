# @kysera/cli

Comprehensive command-line interface for Kysera ORM.

## Installation

```bash
# Global installation
npm install -g @kysera/cli

# Project installation
npm install --save-dev @kysera/cli
```

## Usage

```bash
# Initialize new project
kysera init my-app

# Run migrations
kysera migrate up

# Generate code
kysera generate crud User --table users

# Check database health
kysera health check
```

## Commands

### Project Management
- `kysera init` - Initialize new project
- `kysera plugin` - Manage plugins

### Database Operations
- `kysera migrate` - Migration management
- `kysera db` - Database utilities
- `kysera health` - Health monitoring

### Code Generation
- `kysera generate` - Generate code
- `kysera repository` - Repository management

### Development Tools
- `kysera audit` - Audit logging
- `kysera debug` - Debug utilities
- `kysera query` - Query tools
- `kysera test` - Testing utilities

## Configuration

Create `kysera.config.ts` in your project root:

```typescript
import { defineConfig } from '@kysera/cli'

export default defineConfig({
  database: {
    connection: process.env.DATABASE_URL,
    dialect: 'postgres'
  },
  migrations: {
    directory: './migrations'
  },
  plugins: {
    timestamps: { enabled: true },
    softDelete: { enabled: true },
    audit: { enabled: true }
  }
})
```

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Development mode
pnpm dev
```

## License

MIT