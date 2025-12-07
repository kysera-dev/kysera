import { Command } from 'commander';
import { prism, text, select, confirm, multiselect, spinner, box, group, isCancel } from '@xec-sh/kit';
import { join, resolve, dirname } from 'node:path';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { writeFileSync } from 'node:fs';
import { execa } from 'execa';

// Simple template rendering helper
function renderTemplate(templateName: string, data: any, outputPath: string): void {
  // Ensure directory exists
  mkdirSync(dirname(outputPath), { recursive: true });

  let content: string;
  if (typeof data === 'object' && !Buffer.isBuffer(data)) {
    // For JSON files
    if (outputPath.endsWith('.json')) {
      content = JSON.stringify(data, null, 2);
    } else {
      // For other files, data is the content itself
      content = data;
    }
  } else {
    content = String(data);
  }

  writeFileSync(outputPath, content, 'utf-8');
}

export interface InitOptions {
  template?: string;
  database?: string;
  plugins?: string;
  packageManager?: string;
  typescript?: boolean;
  git?: boolean;
  install?: boolean;
}

const TEMPLATES = {
  basic: {
    name: 'basic',
    description: 'Basic project setup',
    dependencies: ['kysely', '@kysera/core', '@kysera/repository'],
  },
  api: {
    name: 'api',
    description: 'REST API with Express',
    dependencies: ['kysely', '@kysera/core', '@kysera/repository', 'express', 'cors', 'helmet', 'compression'],
    devDependencies: ['@types/express', '@types/cors', '@types/compression'],
  },
  graphql: {
    name: 'graphql',
    description: 'GraphQL API with Apollo',
    dependencies: ['kysely', '@kysera/core', '@kysera/repository', '@apollo/server', 'graphql', 'dataloader'],
    devDependencies: ['@types/node'],
  },
  monorepo: {
    name: 'monorepo',
    description: 'Monorepo setup',
    dependencies: [],
    devDependencies: ['turbo', 'eslint', 'prettier', 'typescript'],
  },
};

const DATABASES = {
  postgres: {
    name: 'PostgreSQL',
    driver: 'pg',
    dependencies: ['pg'],
    devDependencies: ['@types/pg'],
  },
  mysql: {
    name: 'MySQL',
    driver: 'mysql2',
    dependencies: ['mysql2'],
  },
  sqlite: {
    name: 'SQLite',
    driver: 'better-sqlite3',
    dependencies: ['better-sqlite3'],
  },
};

const PLUGINS = {
  timestamps: {
    name: 'Timestamps',
    package: '@kysera/timestamps',
    description: 'Automatic created/updated timestamps',
  },
  'soft-delete': {
    name: 'Soft Delete',
    package: '@kysera/soft-delete',
    description: 'Soft delete functionality',
  },
  audit: {
    name: 'Audit Logging',
    package: '@kysera/audit',
    description: 'Comprehensive audit logging',
  },
};

export function initCommand(): Command {
  const cmd = new Command('init')
    .description('Initialize a new Kysera project')
    .argument('[project-name]', 'Project name')
    .option('-t, --template <name>', 'Project template (basic/api/graphql/monorepo)', 'basic')
    .option('-d, --database <dialect>', 'Database dialect (postgres/mysql/sqlite)', 'postgres')
    .option('-p, --plugins <list>', 'Comma-separated list of plugins', 'timestamps,soft-delete')
    .option('--package-manager <pm>', 'Package manager (npm/pnpm/yarn/bun)', detectPackageManager())
    .option('--typescript', 'Use TypeScript', true)
    .option('--no-typescript', 'Use JavaScript')
    .option('--git', 'Initialize git repository', true)
    .option('--no-git', 'Skip git initialization')
    .option('--install', 'Install dependencies', true)
    .option('--no-install', 'Skip dependency installation')
    .action(async (projectName: string | undefined, options: InitOptions) => {
      try {
        await initProject(projectName, options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to initialize project: ${error instanceof Error ? error.message : String(error)}`,
          'INIT_ERROR'
        );
      }
    });

  return cmd;
}

async function initProject(projectName: string | undefined, options: InitOptions): Promise<void> {
  // Check if we're in a non-interactive environment
  const isNonInteractive = process.env['NODE_ENV'] === 'test' || !process.stdin.isTTY || process.env['CI'];

  // Interactive mode if no project name provided (and we're in an interactive environment)
  if (!projectName) {
    if (isNonInteractive) {
      throw new CLIError('Project name is required in non-interactive mode', 'PROJECT_NAME_REQUIRED', [
        'Provide project name as argument: kysera init <project-name>',
      ]);
    }

    const answers = await group({
      projectName: () =>
        text({
          message: 'Project name',
          placeholder: 'my-kysera-app',
          validate: (value) => {
            if (!value || value.trim() === '') {
              return 'Project name is required';
            }
            if (!/^[a-z0-9-_.]+$/i.test(value)) {
              return 'Project name can only contain letters, numbers, hyphens, underscores, and dots';
            }
            return undefined;
          },
        }),
      template: () =>
        select({
          message: 'Select template',
          options: Object.entries(TEMPLATES).map(([key, template]) => ({
            label: `${template.name} - ${template.description}`,
            value: key,
          })),
        }),
      database: () =>
        select({
          message: 'Select database',
          options: Object.entries(DATABASES).map(([key, db]) => ({
            label: db.name,
            value: key,
          })),
        }),
      plugins: () =>
        multiselect({
          message: 'Enable plugins',
          options: Object.entries(PLUGINS).map(([key, plugin]) => ({
            label: plugin.name,
            value: key,
            hint: plugin.description,
          })),
          initialValues: ['timestamps', 'soft-delete'],
        }),
      packageManager: () =>
        select({
          message: 'Package manager',
          options: [
            { label: 'pnpm', value: 'pnpm' },
            { label: 'npm', value: 'npm' },
            { label: 'yarn', value: 'yarn' },
            { label: 'bun', value: 'bun' },
          ],
          initialValue: detectPackageManager(),
        }),
      git: () =>
        confirm({
          message: 'Initialize git repository?',
          initialValue: true,
        }),
      install: () =>
        confirm({
          message: 'Install dependencies?',
          initialValue: true,
        }),
    });

    // Check if user cancelled
    if (isCancel(answers.projectName)) {
      throw new CLIError('Project initialization cancelled', 'CANCELLED');
    }

    projectName = answers.projectName as string;
    options = {
      template: answers.template as string,
      database: answers.database as string,
      plugins: (answers.plugins as string[])?.join(','),
      packageManager: answers.packageManager as string,
      typescript: true, // Always use TypeScript for now
      git: answers.git as boolean,
      install: answers.install as boolean,
    };
  }

  // Validate options
  const template = options.template || 'basic';
  if (!TEMPLATES[template as keyof typeof TEMPLATES]) {
    throw new CLIError(`Invalid template: ${template}`, 'INVALID_TEMPLATE', [
      'Available templates: basic, api, graphql, monorepo',
    ]);
  }

  const database = options.database || 'postgres';
  if (!DATABASES[database as keyof typeof DATABASES]) {
    throw new CLIError(`Invalid database: ${database}`, 'INVALID_DATABASE', [
      'Available databases: postgres, mysql, sqlite',
    ]);
  }

  const plugins = options.plugins?.split(',').filter(Boolean) || ['timestamps', 'soft-delete'];
  for (const plugin of plugins) {
    if (!PLUGINS[plugin as keyof typeof PLUGINS]) {
      throw new CLIError(`Invalid plugin: ${plugin}`, 'INVALID_PLUGIN', [
        `Available plugins: ${Object.keys(PLUGINS).join(', ')}`,
      ]);
    }
  }

  const packageManager = options.packageManager || detectPackageManager();

  // Resolve project path
  const projectPath = projectName === '.' ? process.cwd() : resolve(process.cwd(), projectName);
  const projectDir = projectName === '.' ? '.' : projectName;

  // Check if directory exists
  if (projectDir !== '.' && existsSync(projectPath)) {
    const files = readdirSync(projectPath);
    if (files.length > 0) {
      throw new CLIError(`Directory ${projectName} already exists and is not empty`, 'DIRECTORY_EXISTS', [
        'Choose a different project name',
        'Use an empty directory',
        'Delete existing files first',
      ]);
    }
  }

  // Show creation message
  console.log('');

  // Use the previously defined isNonInteractive variable
  let createSpinner: any = null;
  if (!isNonInteractive) {
    createSpinner = spinner();
    createSpinner.start(`Creating project ${prism.cyan(projectName)}`);
  } else {
    console.log(`Creating project ${projectName}...`);
  }

  try {
    // Create project directory
    if (projectDir !== '.') {
      mkdirSync(projectPath, { recursive: true });
    }

    // Generate project files based on template
    await generateProjectFiles(projectPath, {
      name: projectName === '.' ? 'kysera-app' : projectName,
      template,
      database,
      plugins,
      packageManager,
      typescript: options.typescript !== false,
    });

    if (createSpinner) {
      createSpinner.succeed('Project initialized successfully');
    } else {
      console.log('✓ Project initialized successfully');
    }

    // Initialize git if requested
    if (options.git !== false) {
      let gitSpinner: any = null;
      if (!isNonInteractive) {
        gitSpinner = spinner();
        gitSpinner.start('Initializing git repository');
      } else {
        console.log('Initializing git repository...');
      }

      try {
        await execa('git', ['init'], { cwd: projectPath, stdio: 'ignore' });
        await execa('git', ['add', '.'], { cwd: projectPath, stdio: 'ignore' });
        await execa('git', ['commit', '-m', 'Initial commit'], { cwd: projectPath, stdio: 'ignore' });
        if (gitSpinner) {
          gitSpinner.succeed('Git repository initialized');
        } else {
          console.log('✓ Git repository initialized');
        }
      } catch (error) {
        if (gitSpinner) {
          gitSpinner.warn('Failed to initialize git repository');
        } else {
          console.log('⚠ Failed to initialize git repository');
        }
        logger.debug(`Git error: ${error}`);
      }
    }

    // Install dependencies if requested
    if (options.install !== false) {
      let installSpinner: any = null;
      if (!isNonInteractive) {
        installSpinner = spinner();
        installSpinner.start('Installing dependencies');
      } else {
        console.log('Installing dependencies...');
      }

      try {
        await execa(packageManager, ['install'], { cwd: projectPath, stdio: 'ignore' });
        if (installSpinner) {
          installSpinner.succeed('Dependencies installed');
        } else {
          console.log('✓ Dependencies installed');
        }
      } catch (error) {
        if (installSpinner) {
          installSpinner.warn('Failed to install dependencies');
        } else {
          console.log('⚠ Failed to install dependencies');
        }
        logger.debug(`Install error: ${error}`);
        const installCmd = getInstallCommand(packageManager);
        console.log(prism.yellow(`\nRun ${prism.cyan(installCmd)} to install dependencies manually`));
      }
    }

    // Success message
    console.log('');

    // Display security warning for database configurations with authentication
    if (database === 'postgres' || database === 'mysql') {
      console.log(prism.yellow('⚠️  SECURITY WARNING'));
      console.log(prism.yellow('   Your project uses an empty database password by default.'));
      console.log(prism.yellow('   See SECURITY.md for important security guidelines.'));
      console.log('');
    }

    const nextSteps = ['Next steps:'];
    let stepNumber = 1;

    if (projectDir !== '.') {
      nextSteps.push(`  ${prism.gray(`${stepNumber}.`)} cd ${projectName}`);
      stepNumber++;
    }

    if (database === 'postgres' || database === 'mysql') {
      nextSteps.push(`  ${prism.gray(`${stepNumber}.`)} Set DB_PASSWORD in .env file`);
      stepNumber++;
    }

    nextSteps.push(`  ${prism.gray(`${stepNumber}.`)} ${packageManager} run dev`);

    const successMessage = [
      `Project: ${prism.cyan(projectName)}`,
      `Template: ${prism.cyan(template)}`,
      `Database: ${prism.cyan(database)}`,
      `Plugins: ${prism.cyan(plugins.join(', '))}`,
      '',
      ...nextSteps,
      '',
      `Documentation: ${prism.blue('https://kysera.dev/docs')}`,
      `GitHub: ${prism.blue('https://github.com/kysera/kysera')}`,
    ]
      .filter(Boolean)
      .join('\n');

    // In non-interactive mode, just print the message
    if (isNonInteractive) {
      console.log('✨ Project created successfully!');
      console.log('');
      console.log(successMessage);
    } else {
      // Use box in interactive mode
      console.log(
        box({
          title: '✨ Project created successfully!',
          body: successMessage,
          color: 'green',
        })
      );
    }
  } catch (error) {
    if (createSpinner) {
      createSpinner.fail('Failed to create project');
    } else {
      console.log('✗ Failed to create project');
    }
    throw error;
  }
}

async function generateProjectFiles(
  projectPath: string,
  config: {
    name: string;
    template: string;
    database: string;
    plugins: string[];
    packageManager: string;
    typescript: boolean;
  }
): Promise<void> {
  const template = TEMPLATES[config.template as keyof typeof TEMPLATES];
  const database = DATABASES[config.database as keyof typeof DATABASES];

  // Collect all dependencies
  const dependencies = new Set([...template.dependencies, ...database.dependencies]);

  // Add plugin dependencies
  for (const plugin of config.plugins) {
    const pluginConfig = PLUGINS[plugin as keyof typeof PLUGINS];
    if (pluginConfig) {
      dependencies.add(pluginConfig.package);
    }
  }

  const devDependencies = new Set([
    ...(template.devDependencies || []),
    ...(database.devDependencies || []),
    'typescript',
    '@types/node',
    'tsx',
    'vitest',
    '@vitest/coverage-v8',
    'eslint',
    'prettier',
  ]);

  // Create package.json
  const packageJson = {
    name: config.name,
    version: '0.1.0',
    description: 'A Kysera-powered application',
    type: 'module',
    scripts: {
      dev: 'tsx watch src/index.ts',
      build: 'tsc',
      start: 'node dist/index.js',
      test: 'vitest',
      'test:coverage': 'vitest run --coverage',
      typecheck: 'tsc --noEmit',
      lint: 'eslint src --ext .ts',
      format: 'prettier --write "src/**/*.ts"',
      'migrate:up': 'kysera migrate up',
      'migrate:down': 'kysera migrate down',
      'migrate:create': 'kysera migrate create',
    },
    dependencies: Object.fromEntries(Array.from(dependencies).map((dep) => [dep, 'latest'])),
    devDependencies: Object.fromEntries(Array.from(devDependencies).map((dep) => [dep, 'latest'])),
    engines: {
      node: '>=20.0.0',
    },
  };

  // Generate files based on template
  await renderTemplate('init/package.json', packageJson, join(projectPath, 'package.json'));

  // Create basic project structure
  const dirs = ['src', 'src/repositories', 'migrations', 'tests'];

  if (config.template === 'api') {
    dirs.push('src/services', 'src/controllers', 'src/middleware', 'src/routes');
  } else if (config.template === 'graphql') {
    dirs.push('src/resolvers', 'src/schema', 'src/dataloaders');
  } else if (config.template === 'monorepo') {
    dirs.push(
      'apps',
      'apps/api',
      'apps/worker',
      'packages',
      'packages/database',
      'packages/repositories',
      'packages/schemas'
    );
  }

  for (const dir of dirs) {
    mkdirSync(join(projectPath, dir), { recursive: true });
  }

  // Generate configuration files
  await generateConfigFiles(projectPath, config);

  // Generate source files based on template
  await generateSourceFiles(projectPath, config);
}

async function generateConfigFiles(projectPath: string, config: any): Promise<void> {
  // Generate kysera.config.ts
  let databaseConfig = '';
  if (config.database === 'sqlite') {
    databaseConfig = `  database: {
    dialect: 'sqlite',
    database: process.env.DB_FILE || './database.sqlite'
  },`;
  } else if (config.database === 'postgres') {
    // SECURITY: Default password is empty string instead of a hardcoded value
    // Users MUST set DB_PASSWORD in their .env file for secure deployments
    databaseConfig = `  database: {
    dialect: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || '${config.name}',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || ''
  },`;
  } else if (config.database === 'mysql') {
    databaseConfig = `  database: {
    dialect: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME || '${config.name}',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  },`;
  }

  const kyseraConfig = `export default {
${databaseConfig}
  migrations: {
    directory: './migrations',
    tableName: 'kysera_migrations'
  },
  plugins: {
    ${config.plugins.map((plugin: string) => `'${plugin}': { enabled: true }`).join(',\n    ')}
  }
}
`;

  await renderTemplate('init/kysera.config.ts', kyseraConfig, join(projectPath, 'kysera.config.ts'));

  // Generate tsconfig.json
  const tsConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      lib: ['ES2022'],
      moduleResolution: 'bundler',
      rootDir: './src',
      outDir: './dist',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist', 'tests'],
  };

  await renderTemplate('init/tsconfig.json', tsConfig, join(projectPath, 'tsconfig.json'));

  // Generate .gitignore
  const gitignore = `# Dependencies
node_modules/
.pnp
.pnp.js

# Build
dist/
build/
*.tsbuildinfo

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo
.DS_Store

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Testing
coverage/
.nyc_output/

# Database
*.sqlite
*.sqlite3
*.db
`;

  await renderTemplate('init/.gitignore', gitignore, join(projectPath, '.gitignore'));

  // Generate .env.example
  const envExample = `# Database Configuration
${
  config.database === 'postgres'
    ? `DB_HOST=localhost
DB_PORT=5432
DB_NAME=${config.name}
DB_USER=postgres
DB_PASSWORD=`
    : ''
}
${
  config.database === 'mysql'
    ? `DB_HOST=localhost
DB_PORT=3306
DB_NAME=${config.name}
DB_USER=root
DB_PASSWORD=`
    : ''
}
${config.database === 'sqlite' ? `DB_FILE=./database.sqlite` : ''}

# Application
NODE_ENV=development
PORT=3000
`;

  await renderTemplate('init/.env.example', envExample, join(projectPath, '.env.example'));

  // Generate security warning if using database with authentication
  if (config.database === 'postgres' || config.database === 'mysql') {
    const securityWarning = `
⚠️  SECURITY WARNING ⚠️

Your project configuration uses an empty password for the database connection.
This is insecure and should ONLY be used for local development.

BEFORE DEPLOYING TO PRODUCTION:
1. Set a strong password in your .env file
2. Use environment variables for all credentials
3. Never commit .env files to version control
4. Consider using connection strings with secret management

Example secure setup:
  DB_PASSWORD=<your-strong-password-here>

For PostgreSQL, you can generate a secure password with:
  openssl rand -base64 32
`;

    const securityFilePath = join(projectPath, 'SECURITY.md');
    await renderTemplate('init/SECURITY.md', securityWarning, securityFilePath);
  }
}

async function generateSourceFiles(projectPath: string, config: any): Promise<void> {
  // Generate database.ts
  const databaseFile = `import { Kysely${config.database === 'postgres' ? ', PostgresDialect' : config.database === 'mysql' ? ', MysqlDialect' : ', SqliteDialect'} } from 'kysely'
${config.database === 'postgres' ? "import { Pool } from 'pg'" : ''}
${config.database === 'mysql' ? "import { createPool } from 'mysql2'" : ''}
${config.database === 'sqlite' ? "import Database from 'better-sqlite3'" : ''}

// Define your database schema interface
export interface Database {
  // Add your tables here
  // users: UserTable
  // posts: PostTable
}

// Create database instance
export const db = new Kysely<Database>({
  dialect: ${
    config.database === 'postgres'
      ? `new PostgresDialect({
    pool: new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || '${config.name}',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || ''
    })
  })`
      : config.database === 'mysql'
        ? `new MysqlDialect({
    pool: createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      database: process.env.DB_NAME || '${config.name}',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || ''
    })
  })`
        : `new SqliteDialect({
    database: new Database(process.env.DB_FILE || './database.sqlite')
  })`
  }
})
`;

  await renderTemplate('init/database.ts', databaseFile, join(projectPath, 'src', 'database.ts'));

  // Generate index.ts based on template
  let indexFile = '';

  if (config.template === 'basic') {
    indexFile = `import { db } from './database.js'

console.log('🚀 Kysera application starting...')

// Your application code here

// Example: Test database connection
async function main() {
  try {
    // Test connection
    await db.selectFrom('kysera_migrations')
      .select('version')
      .limit(1)
      .execute()
      .catch(() => {
        console.log('📦 Migrations table not found. Run "kysera migrate up" to create it.')
      })

    console.log('✅ Database connected successfully!')

    // Your application logic here

  } catch (error) {
    console.error('❌ Application error:', error)
    process.exit(1)
  }
}

main()
`;
  } else if (config.template === 'api') {
    indexFile = `import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import { db } from './database.js'

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(helmet())
app.use(cors())
app.use(compression())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Routes
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    await db.selectFrom('kysera_migrations')
      .select('version')
      .limit(1)
      .execute()
      .catch(() => null)

    res.json({ status: 'healthy', timestamp: new Date().toISOString() })
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message })
  }
})

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Internal server error' })
})

// Start server
app.listen(PORT, () => {
  console.log(\`🚀 Server running on http://localhost:\${PORT}\`)
})
`;
  } else if (config.template === 'graphql') {
    indexFile = `import { ApolloServer } from '@apollo/server'
import { startStandaloneServer } from '@apollo/server/standalone'
import { db } from './database.js'

// Type definitions
const typeDefs = \`#graphql
  type Query {
    health: Health!
  }

  type Health {
    status: String!
    timestamp: String!
  }
\`

// Resolvers
const resolvers = {
  Query: {
    health: async () => {
      try {
        // Test database connection
        await db.selectFrom('kysera_migrations')
          .select('version')
          .limit(1)
          .execute()
          .catch(() => null)

        return {
          status: 'healthy',
          timestamp: new Date().toISOString()
        }
      } catch (error) {
        return {
          status: 'unhealthy',
          timestamp: new Date().toISOString()
        }
      }
    }
  }
}

// Create server
const server = new ApolloServer({
  typeDefs,
  resolvers
})

// Start server
const { url } = await startStandaloneServer(server, {
  listen: { port: Number(process.env.PORT) || 4000 }
})

console.log(\`🚀 GraphQL server ready at \${url}\`)
`;
  }

  await renderTemplate('init/index.ts', indexFile, join(projectPath, 'src', 'index.ts'));

  // Create README.md
  const readme = `# ${config.name}

A Kysera-powered application.

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- ${config.database === 'postgres' ? 'PostgreSQL' : config.database === 'mysql' ? 'MySQL' : 'SQLite'}

### Installation

\`\`\`bash
${config.packageManager} install
\`\`\`

### Development

\`\`\`bash
${config.packageManager} run dev
\`\`\`

### Build

\`\`\`bash
${config.packageManager} run build
\`\`\`

### Testing

\`\`\`bash
${config.packageManager} test
\`\`\`

## Database Migrations

Create a new migration:
\`\`\`bash
kysera migrate create <name>
\`\`\`

Run migrations:
\`\`\`bash
kysera migrate up
\`\`\`

Rollback migrations:
\`\`\`bash
kysera migrate down
\`\`\`

## Documentation

- [Kysera Documentation](https://kysera.dev/docs)
- [GitHub Repository](https://github.com/kysera/kysera)

## License

MIT
`;

  await renderTemplate('init/README.md', readme, join(projectPath, 'README.md'));
}

function detectPackageManager(): string {
  // Check for lock files
  if (existsSync('pnpm-lock.yaml')) return 'pnpm';
  if (existsSync('yarn.lock')) return 'yarn';
  if (existsSync('package-lock.json')) return 'npm';
  if (existsSync('bun.lockb')) return 'bun';

  // Check npm_config_user_agent
  const userAgent = process.env.npm_config_user_agent || '';
  if (userAgent.includes('pnpm')) return 'pnpm';
  if (userAgent.includes('yarn')) return 'yarn';
  if (userAgent.includes('bun')) return 'bun';

  // Default to pnpm as it's preferred
  return 'pnpm';
}

function getInstallCommand(packageManager: string): string {
  switch (packageManager) {
    case 'pnpm':
      return 'pnpm install';
    case 'yarn':
      return 'yarn install';
    case 'bun':
      return 'bun install';
    default:
      return 'npm install';
  }
}
