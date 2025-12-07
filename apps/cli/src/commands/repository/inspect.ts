import { Command } from 'commander';
import { prism, spinner, table, select } from '@xec-sh/kit';
import { logger } from '../../utils/logger.js';
import { CLIError } from '../../utils/errors.js';
import { getDatabaseConnection } from '../../utils/database.js';
import { loadConfig } from '../../config/loader.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface InspectRepositoryOptions {
  file?: string;
  className?: string;
  showAst?: boolean;
  showDependencies?: boolean;
  showComplexity?: boolean;
  showDatabase?: boolean;
  json?: boolean;
  config?: string;
}

interface RepositoryInspection {
  file: string;
  className: string;
  tableName?: string;
  entity?: {
    name: string;
    properties: Array<{
      name: string;
      type: string;
      optional: boolean;
      description?: string;
    }>;
  };
  methods: Array<{
    name: string;
    parameters: Array<{
      name: string;
      type: string;
      optional: boolean;
    }>;
    returnType: string;
    async: boolean;
    visibility: 'public' | 'private' | 'protected';
    complexity?: number;
    linesOfCode: number;
    hasValidation?: boolean;
    queries?: string[];
  }>;
  dependencies: string[];
  imports: Array<{
    module: string;
    items: string[];
  }>;
  schema?: {
    name: string;
    type: 'zod' | 'joi' | 'yup' | 'custom';
    properties: Array<{
      name: string;
      type: string;
      validation: string[];
      required: boolean;
    }>;
  };
  stats: {
    totalLines: number;
    totalMethods: number;
    publicMethods: number;
    privateMethods: number;
    protectedMethods: number;
    asyncMethods: number;
    averageMethodLength: number;
    cyclomaticComplexity: number;
    maintainabilityIndex: number;
  };
  database?: {
    tableExists: boolean;
    columnCount?: number;
    rowCount?: number;
    indexes?: string[];
    constraints?: string[];
  };
}

export function inspectRepositoryCommand(): Command {
  const cmd = new Command('inspect')
    .description('Inspect a repository class in detail')
    .option('-f, --file <path>', 'Repository file to inspect')
    .option('-c, --className <name>', 'Repository class name')
    .option('--show-ast', 'Show abstract syntax tree', false)
    .option('--show-dependencies', 'Show dependencies graph', false)
    .option('--show-complexity', 'Show complexity metrics', false)
    .option('--show-database', 'Show database table info', false)
    .option('--json', 'Output as JSON', false)
    .option('--config <path>', 'Path to configuration file')
    .action(async (options: InspectRepositoryOptions) => {
      try {
        await inspectRepository(options);
      } catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(
          `Failed to inspect repository: ${error instanceof Error ? error.message : String(error)}`,
          'REPOSITORY_INSPECT_ERROR'
        );
      }
    });

  return cmd;
}

async function inspectRepository(options: InspectRepositoryOptions): Promise<void> {
  // Load configuration
  const config = await loadConfig(options.config);

  const inspectSpinner = spinner();

  try {
    let filePath: string;

    // Determine which file to inspect
    if (options.file) {
      filePath = path.resolve(options.file);
      inspectSpinner.start(`Inspecting ${path.basename(filePath)}...`);
    } else if (options.className) {
      inspectSpinner.start(`Searching for ${options.className}...`);

      // Search for the class in common locations
      const searchPaths = [
        `src/repositories/${options.className}.ts`,
        `src/repository/${options.className}.ts`,
        `src/models/${options.className}.ts`,
        `src/**/${options.className}.ts`,
      ];

      let found = false;
      for (const searchPath of searchPaths) {
        const resolvedPath = path.resolve(searchPath);
        try {
          await fs.access(resolvedPath);
          filePath = resolvedPath;
          found = true;
          break;
        } catch {
          // Continue searching
        }
      }

      if (!found) {
        inspectSpinner.fail(`Repository class '${options.className}' not found`);
        return;
      }
    } else {
      // Interactive selection
      inspectSpinner.start('Finding repository files...');
      const files = await findAllRepositoryFiles('src');
      inspectSpinner.stop();

      if (files.length === 0) {
        console.log(prism.yellow('No repository files found'));
        return;
      }

      const selected = await select(
        'Select a repository to inspect:',
        files.map((f) => ({
          label: path.basename(f),
          value: f,
          description: path.relative(process.cwd(), f),
        }))
      );

      filePath = selected;
      inspectSpinner.start(`Inspecting ${path.basename(filePath)}...`);
    }

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      inspectSpinner.fail(`File not found: ${filePath}`);
      return;
    }

    // Read and parse the file
    const content = await fs.readFile(filePath, 'utf-8');
    const inspection = await performInspection(filePath, content, options);

    if (!inspection) {
      inspectSpinner.fail('Failed to parse repository file');
      return;
    }

    // Get database info if requested
    if (options.showDatabase && config?.database && inspection.tableName) {
      const db = await getDatabaseConnection(config.database);
      if (db) {
        inspection.database = await getTableInfo(db, inspection.tableName);
        await db.destroy();
      }
    }

    inspectSpinner.succeed('Repository inspected successfully');

    // Display results
    if (options.json) {
      console.log(JSON.stringify(inspection, null, 2));
    } else {
      displayInspection(inspection, options);
    }
  } catch (error) {
    inspectSpinner.fail('Inspection failed');
    throw error;
  }
}

async function performInspection(
  filePath: string,
  content: string,
  options: InspectRepositoryOptions
): Promise<RepositoryInspection | null> {
  // Extract basic information
  const classMatch = content.match(/export\s+(?:default\s+)?class\s+(\w+Repository)/m);
  if (!classMatch) {
    return null;
  }

  const className = classMatch[1];
  const tableMatch = content.match(/tableName[:\s=]+['"`](\w+)['"`]/m);
  const tableName = tableMatch ? tableMatch[1] : undefined;

  // Parse entity
  const entity = parseEntity(content);

  // Parse methods
  const methods = parseMethods(content, options.showComplexity || false);

  // Parse dependencies
  const dependencies = parseDependencies(content);

  // Parse imports
  const imports = parseImports(content);

  // Parse schema
  const schema = parseSchema(content);

  // Calculate stats
  const lines = content.split('\n');
  const stats = calculateStats(methods, lines.length);

  return {
    file: filePath,
    className,
    tableName,
    entity,
    methods,
    dependencies,
    imports,
    schema,
    stats,
  };
}

function parseEntity(content: string): RepositoryInspection['entity'] | undefined {
  const entityMatch = content.match(/(?:interface|type)\s+(\w+Entity)\s*(?:extends\s+\w+)?\s*\{([^}]+)\}/m);
  if (!entityMatch) {
    return undefined;
  }

  const name = entityMatch[1];
  const bodyContent = entityMatch[2];

  const properties: RepositoryInspection['entity']['properties'] = [];
  const propMatches = bodyContent.matchAll(/\s*(\w+)(\?)?:\s*([^;\n]+)(?:;|$)/gm);

  for (const match of propMatches) {
    properties.push({
      name: match[1],
      type: match[3].trim(),
      optional: match[2] === '?',
    });
  }

  return { name, properties };
}

function parseMethods(content: string, calculateComplexity: boolean): RepositoryInspection['methods'] {
  const methods: RepositoryInspection['methods'] = [];

  const methodRegex = /(public\s+|private\s+|protected\s+)?(async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/gm;

  let match;
  while ((match = methodRegex.exec(content)) !== null) {
    const methodName = match[3];
    if (['constructor', 'get', 'set'].includes(methodName)) {
      continue;
    }

    const visibility = match[1] ? (match[1].trim() as any) : 'public';
    const isAsync = !!match[2];
    const params = match[4];
    const returnType = match[5]?.trim() || 'void';

    // Parse parameters
    const parameters = parseParameters(params);

    // Find method body
    let braceCount = 1;
    let bodyStart = match.index + match[0].length;
    let bodyEnd = bodyStart;

    for (let i = bodyStart; i < content.length; i++) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          bodyEnd = i;
          break;
        }
      }
    }

    const methodBody = content.substring(bodyStart, bodyEnd);
    const methodLines = methodBody.split('\n').length;

    // Check for validation
    const hasValidation = methodBody.includes('.parse(') || methodBody.includes('validate');

    // Extract queries (simplified)
    const queries: string[] = [];
    const queryMatches = methodBody.matchAll(/\.(selectFrom|insertInto|updateTable|deleteFrom)\(['"`](\w+)['"`]\)/g);
    for (const qMatch of queryMatches) {
      queries.push(`${qMatch[1]} ${qMatch[2]}`);
    }

    // Calculate complexity if requested
    let complexity = 0;
    if (calculateComplexity) {
      complexity = calculateCyclomaticComplexity(methodBody);
    }

    methods.push({
      name: methodName,
      parameters,
      returnType,
      async: isAsync,
      visibility,
      complexity: calculateComplexity ? complexity : undefined,
      linesOfCode: methodLines,
      hasValidation,
      queries: queries.length > 0 ? queries : undefined,
    });
  }

  return methods;
}

function parseParameters(params: string): RepositoryInspection['methods'][0]['parameters'] {
  if (!params.trim()) return [];

  const parameters: RepositoryInspection['methods'][0]['parameters'] = [];
  const paramParts = params.split(',');

  for (const part of paramParts) {
    const paramMatch = part.match(/\s*(\w+)(\?)?:\s*(.+)/);
    if (paramMatch) {
      parameters.push({
        name: paramMatch[1],
        type: paramMatch[3].trim(),
        optional: paramMatch[2] === '?',
      });
    }
  }

  return parameters;
}

function parseDependencies(content: string): string[] {
  const deps: Set<string> = new Set();

  // Parse import statements
  const importMatches = content.matchAll(/import\s+(?:\*\s+as\s+\w+|{[^}]+}|\w+)\s+from\s+['"`]([^'"`]+)['"`]/gm);
  for (const match of importMatches) {
    const module = match[1];
    if (!module.startsWith('.') && !module.startsWith('@types')) {
      deps.add(module);
    }
  }

  return Array.from(deps);
}

function parseImports(content: string): RepositoryInspection['imports'] {
  const imports: RepositoryInspection['imports'] = [];

  const importMatches = content.matchAll(/import\s+(?:\*\s+as\s+(\w+)|{([^}]+)}|(\w+))\s+from\s+['"`]([^'"`]+)['"`]/gm);

  for (const match of importMatches) {
    const module = match[4];
    let items: string[] = [];

    if (match[1]) {
      // import * as name
      items = [match[1]];
    } else if (match[2]) {
      // import { ... }
      items = match[2].split(',').map((s) => s.trim());
    } else if (match[3]) {
      // import name
      items = [match[3]];
    }

    imports.push({ module, items });
  }

  return imports;
}

function parseSchema(content: string): RepositoryInspection['schema'] | undefined {
  // Try to find Zod schema
  const zodMatch = content.match(/(?:const|let)\s+(\w+Schema)\s*=\s*z\.object\(\{([^}]+)\}/m);
  if (zodMatch) {
    const name = zodMatch[1];
    const schemaBody = zodMatch[2];

    const properties: RepositoryInspection['schema']['properties'] = [];
    const propMatches = schemaBody.matchAll(/(\w+):\s*z\.(\w+)\(\)([^,\n}]*)/gm);

    for (const match of propMatches) {
      const propName = match[1];
      const type = match[2];
      const validations = match[3];

      const validation: string[] = [type];
      if (validations.includes('.min(')) validation.push('min');
      if (validations.includes('.max(')) validation.push('max');
      if (validations.includes('.email(')) validation.push('email');
      if (validations.includes('.url(')) validation.push('url');
      if (validations.includes('.uuid(')) validation.push('uuid');

      properties.push({
        name: propName,
        type,
        validation,
        required: !validations.includes('.optional()'),
      });
    }

    return {
      name,
      type: 'zod',
      properties,
    };
  }

  return undefined;
}

function calculateStats(methods: RepositoryInspection['methods'], totalLines: number): RepositoryInspection['stats'] {
  const publicMethods = methods.filter((m) => m.visibility === 'public').length;
  const privateMethods = methods.filter((m) => m.visibility === 'private').length;
  const protectedMethods = methods.filter((m) => m.visibility === 'protected').length;
  const asyncMethods = methods.filter((m) => m.async).length;

  const totalMethodLines = methods.reduce((sum, m) => sum + m.linesOfCode, 0);
  const averageMethodLength = methods.length > 0 ? Math.round(totalMethodLines / methods.length) : 0;

  const cyclomaticComplexity = methods.reduce((sum, m) => sum + (m.complexity || 1), 0);

  // Simple maintainability index calculation (0-100)
  const maintainabilityIndex = Math.min(
    100,
    Math.max(0, 100 - cyclomaticComplexity * 2 - averageMethodLength / 2 + publicMethods * 2)
  );

  return {
    totalLines,
    totalMethods: methods.length,
    publicMethods,
    privateMethods,
    protectedMethods,
    asyncMethods,
    averageMethodLength,
    cyclomaticComplexity,
    maintainabilityIndex: Math.round(maintainabilityIndex),
  };
}

function calculateCyclomaticComplexity(code: string): number {
  let complexity = 1;

  // Count decision points
  const patterns = [
    /\bif\b/g,
    /\belse\s+if\b/g,
    /\bwhile\b/g,
    /\bfor\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\?\s*[^:]+:/g, // ternary operator
    /&&/g,
    /\|\|/g,
  ];

  for (const pattern of patterns) {
    const matches = code.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  return complexity;
}

async function getTableInfo(db: any, tableName: string): Promise<RepositoryInspection['database']> {
  try {
    // Check if table exists
    const tables = await db
      .selectFrom('information_schema.tables')
      .select('table_name')
      .where('table_name', '=', tableName)
      .execute();

    if (tables.length === 0) {
      return { tableExists: false };
    }

    // Get column count
    const columns = await db
      .selectFrom('information_schema.columns')
      .select('column_name')
      .where('table_name', '=', tableName)
      .execute();

    // Get row count
    const countResult = await db.selectFrom(tableName).select(db.fn.countAll().as('count')).executeTakeFirst();

    // Get indexes (simplified - dialect specific in reality)
    const indexes: string[] = [];
    try {
      const indexResult = await db
        .selectFrom('information_schema.statistics')
        .select('index_name')
        .where('table_name', '=', tableName)
        .distinct()
        .execute();

      indexes.push(...indexResult.map((r: any) => r.index_name));
    } catch {
      // Indexes query might fail on some databases
    }

    return {
      tableExists: true,
      columnCount: columns.length,
      rowCount: Number(countResult?.count || 0),
      indexes: indexes.length > 0 ? indexes : undefined,
    };
  } catch (error) {
    logger.debug(`Failed to get table info: ${error}`);
    return { tableExists: false };
  }
}

async function findAllRepositoryFiles(directory: string): Promise<string[]> {
  const files: string[] = [];

  async function scanDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('Repository.ts')) {
          files.push(fullPath);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await scanDir(directory);
  return files;
}

function displayInspection(inspection: RepositoryInspection, options: InspectRepositoryOptions): void {
  console.log('');
  console.log(prism.bold(`🔍 Repository Inspection: ${inspection.className}`));
  console.log(prism.gray('═'.repeat(60)));

  // Basic info
  console.log('');
  console.log(prism.cyan('📋 Basic Information:'));
  console.log(`  File: ${path.relative(process.cwd(), inspection.file)}`);
  if (inspection.tableName) console.log(`  Table: ${inspection.tableName}`);
  console.log(`  Lines of code: ${inspection.stats.totalLines}`);

  // Entity
  if (inspection.entity) {
    console.log('');
    console.log(prism.cyan(`📦 Entity: ${inspection.entity.name}`));
    console.log('  Properties:');
    for (const prop of inspection.entity.properties) {
      const optional = prop.optional ? '?' : '';
      console.log(`    • ${prop.name}${optional}: ${prism.gray(prop.type)}`);
    }
  }

  // Schema
  if (inspection.schema) {
    console.log('');
    console.log(prism.cyan(`✅ Validation Schema: ${inspection.schema.name} (${inspection.schema.type})`));
    console.log('  Properties:');
    for (const prop of inspection.schema.properties) {
      const required = prop.required ? prism.red('*') : '';
      console.log(`    • ${prop.name}${required}: ${prop.type} [${prop.validation.join(', ')}]`);
    }
  }

  // Methods
  console.log('');
  console.log(prism.cyan(`🔧 Methods (${inspection.stats.totalMethods}):`));

  const methodGroups = {
    public: inspection.methods.filter((m) => m.visibility === 'public'),
    protected: inspection.methods.filter((m) => m.visibility === 'protected'),
    private: inspection.methods.filter((m) => m.visibility === 'private'),
  };

  for (const [visibility, methods] of Object.entries(methodGroups)) {
    if (methods.length > 0) {
      console.log(`  ${visibility.charAt(0).toUpperCase() + visibility.slice(1)}:`);
      for (const method of methods) {
        const async = method.async ? 'async ' : '';
        const params = method.parameters.map((p) => `${p.name}: ${p.type}`).join(', ');
        console.log(`    • ${async}${method.name}(${params}): ${method.returnType}`);

        if (options.showComplexity && method.complexity) {
          console.log(`      Complexity: ${method.complexity}, Lines: ${method.linesOfCode}`);
        }

        if (method.hasValidation) {
          console.log(prism.green(`      ✓ Has validation`));
        }

        if (method.queries && method.queries.length > 0) {
          console.log(`      Queries: ${method.queries.join(', ')}`);
        }
      }
    }
  }

  // Stats
  console.log('');
  console.log(prism.cyan('📊 Statistics:'));
  const statsTable = table([
    { Metric: 'Total Methods', Value: String(inspection.stats.totalMethods) },
    { Metric: 'Public Methods', Value: String(inspection.stats.publicMethods) },
    { Metric: 'Private Methods', Value: String(inspection.stats.privateMethods) },
    { Metric: 'Async Methods', Value: String(inspection.stats.asyncMethods) },
    { Metric: 'Avg Method Length', Value: `${inspection.stats.averageMethodLength} lines` },
    { Metric: 'Cyclomatic Complexity', Value: String(inspection.stats.cyclomaticComplexity) },
    { Metric: 'Maintainability Index', Value: `${inspection.stats.maintainabilityIndex}/100` },
  ]);
  console.log(statsTable);

  // Dependencies
  if (options.showDependencies && inspection.dependencies.length > 0) {
    console.log('');
    console.log(prism.cyan('📦 Dependencies:'));
    for (const dep of inspection.dependencies) {
      console.log(`  • ${dep}`);
    }
  }

  // Database info
  if (options.showDatabase && inspection.database) {
    console.log('');
    console.log(prism.cyan('💾 Database Information:'));
    if (inspection.database.tableExists) {
      console.log(`  Table exists: ✅`);
      console.log(`  Columns: ${inspection.database.columnCount}`);
      console.log(`  Rows: ${inspection.database.rowCount}`);
      if (inspection.database.indexes) {
        console.log(`  Indexes: ${inspection.database.indexes.join(', ')}`);
      }
    } else {
      console.log(`  Table exists: ❌`);
      console.log(prism.yellow(`  Table '${inspection.tableName}' not found in database`));
    }
  }

  // Recommendations
  console.log('');
  console.log(prism.cyan('💡 Recommendations:'));

  const recommendations: string[] = [];

  if (inspection.stats.averageMethodLength > 50) {
    recommendations.push('Consider breaking down large methods into smaller ones');
  }

  if (inspection.stats.cyclomaticComplexity > 20) {
    recommendations.push('High complexity detected - consider refactoring complex methods');
  }

  if (inspection.stats.maintainabilityIndex < 50) {
    recommendations.push('Low maintainability index - consider improving code structure');
  }

  if (!inspection.schema) {
    recommendations.push('Consider adding validation schema for data integrity');
  }

  if (inspection.stats.publicMethods > 10) {
    recommendations.push('Many public methods - consider grouping related functionality');
  }

  if (recommendations.length === 0) {
    console.log(prism.green('  ✅ Repository follows best practices'));
  } else {
    for (const rec of recommendations) {
      console.log(`  • ${rec}`);
    }
  }
}
