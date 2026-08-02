/**
 * Typecheck all ```typescript / ```ts fenced snippets in website/docs.
 *
 * Every non-skipped snippet is written to node_modules/.cache/kysera-doc-snippets
 * as its own module (a trailing `export {}` is appended), together with:
 *   - _prelude.d.ts  — ambient globals snippets are allowed to assume (db, ctx, …)
 *   - _modules.d.ts  — ambient declarations for third-party packages that are
 *                      referenced in docs but not installed in this workspace
 *   - generated stub modules for relative imports used by snippets (./db …)
 *
 * Imports of @kysera packages resolve via a tsconfig paths map to each
 * package's src entry, so no build is required and errors point at real
 * source. The batch is compiled
 * with the TypeScript compiler API and diagnostics are mapped back to
 * website/docs/<file>.md:<line>.
 *
 * Opt-out: put `<!-- doc-snippet: skip -->` as the nearest non-blank line
 * above a fence to exclude an intentionally partial fragment. Skips are
 * counted and reported per section.
 *
 * Usage: pnpm docs:check-snippets   (alias for: tsx scripts/check-doc-snippets.ts)
 * Exit code 0 iff every checked snippet typechecks.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join, relative, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS_DIR = join(ROOT, 'website', 'docs')
const CACHE_DIR = join(ROOT, 'node_modules', '.cache', 'kysera-doc-snippets')
// MDX form is canonical (docusaurus v3 rejects raw HTML comments);
// the HTML form is still recognized so stray legacy markers fail loudly
// in the census rather than silently un-skipping.
const SKIP_MARKERS = ['{/* doc-snippet: skip */}', '<!-- doc-snippet: skip -->']

// ---------------------------------------------------------------------------
// Ambient prelude: globals that doc snippets may assume without declaring.
// Snippet-local declarations legally shadow these (each snippet is a module).
// Extend this list as the docs grow; prefer precise types over `any`.
// ---------------------------------------------------------------------------
const PRELUDE = `\
import type { Kysely, Transaction, SelectQueryBuilder, Generated } from 'kysely'
import type { Pool } from 'pg'
import type { KyseraExecutor } from '@kysera/executor'
import type { DbContext, QueryFunction } from '@kysera/dal'
import type { KyseraLogger } from '@kysera/core'

declare global {
  /**
   * Canonical example schema used across the docs.
   * Only the columns snippets routinely insert are required; everything else
   * is Generated so partial inserts (the documented style) typecheck.
   */
  interface UsersTable {
    id: Generated<number>
    email: string
    name: Generated<string>
    bio: Generated<string | null>
    role: Generated<string>
    // tenant/org ids appear as string ('tenant-a') on some pages, number on others
    tenant_id: Generated<string | number>
    organization_id: Generated<string | number>
    is_active: Generated<boolean>
    status: Generated<string>
    balance: Generated<number>
    version: Generated<number>
    deleted_at: Generated<Date | string | null>
    created_at: Generated<Date | string>
    updated_at: Generated<Date | string | null>
  }
  interface PostsTable {
    id: Generated<number>
    user_id: Generated<number>
    author_id: Generated<number>
    tenant_id: Generated<string | number>
    title: string
    content: Generated<string>
    status: Generated<string>
    published: Generated<boolean>
    body: Generated<string>
    views: Generated<number>
    view_count: Generated<number>
    deleted_at: Generated<Date | string | null>
    created_at: Generated<Date | string>
    updated_at: Generated<Date | string | null>
  }
  interface CommentsTable {
    id: Generated<number>
    post_id: Generated<number>
    user_id: Generated<number>
    author_id: Generated<number>
    tenant_id: Generated<string | number>
    content: string
    deleted_at: Generated<Date | string | null>
    created_at: Generated<Date | string>
  }
  /** Auxiliary tables referenced by individual pages — intentionally loose. */
  type LooseTable = Record<string, any>
  interface Database {
    users: UsersTable
    posts: PostsTable
    comments: CommentsTable
    orders: LooseTable
    order_items: LooseTable
    accounts: LooseTable
    user_stats: LooseTable
    events: LooseTable
    tenants: LooseTable
    profiles: LooseTable
    products: LooseTable
    premium_features: LooseTable
    organization_members: LooseTable
    organizations: LooseTable
    notifications: LooseTable
    data: LooseTable
    cart_items: LooseTable
    auth_users: LooseTable
    admin_settings: LooseTable
    audit_logs: LooseTable
    public_content: LooseTable
    resources: LooseTable
    sessions: LooseTable
    settings: LooseTable
    categories: LooseTable
    documents: LooseTable
    projects: LooseTable
    wallets: LooseTable
    payments: LooseTable
    tenant_users: LooseTable
    items: LooseTable
    seats: LooseTable
    inventory_movements: LooseTable
  }

  /** Row shapes (selected) for prose examples. */
  interface User {
    id: number
    email: string
    name: string
    role: string
    roles: string[]
    tenantId: string
    status: string
    password: string
    deleted_at: Date | string | null
    created_at: Date
    createdAt: Date
    updated_at: Date | string | null
  }
  interface Post {
    id: number
    user_id: number
    author_id: number
    title: string
    content: string
    status: string
    published: boolean
    views: number
    view_count: number
    deleted_at: Date | string | null
    created_at: Date
  }

  const db: Kysely<Database>
  const trx: Transaction<Database>
  const executor: KyseraExecutor<Database>
  const ctx: DbContext<Database>
  const pool: Pool
  const logger: KyseraLogger

  /**
   * Loose repository shape: common methods are declared (so callback
   * parameters get contextual types under noImplicitAny) and the index
   * signature admits page-specific extensions.
   */
  interface DocRepo {
    findAll(opts?: any): Promise<any[]>
    findById(id: any, opts?: any): Promise<any>
    find(opts?: any): Promise<any[]>
    findOne(opts?: any): Promise<any>
    create(data: any): Promise<any>
    createMany(data: any[]): Promise<any[]>
    update(id: any, data: any): Promise<any>
    delete(id: any): Promise<any>
    softDelete(id: any): Promise<any>
    softDeleteMany(ids: any[]): Promise<any>
    restore(id: any): Promise<any>
    hardDelete(id: any): Promise<any>
    findAllWithDeleted(opts?: any): Promise<any[]>
    findWithDeleted(id: any): Promise<any>
    canAccess(op: any, row?: any): Promise<boolean>
    withTransaction(trx: any): DocRepo
    // audit plugin repository extensions
    getAuditLogs(...args: any[]): Promise<any[]>
    getEntityHistory(...args: any[]): Promise<any[]>
    getUserChanges(...args: any[]): Promise<any[]>
    getTableAuditLogs(...args: any[]): Promise<any[]>
    restoreFromAudit(...args: any[]): Promise<any>
    [k: string]: any
  }

  // Loosely-typed conveniences that appear in narrative fragments.
  const orm: {
    transaction<T>(fn: (ctx: DbContext<Database>) => Promise<T>): Promise<T>
    createRepository(factoryFn: any): DocRepo
    repositories?: any
    [k: string]: any
  }
  const userRepo: DocRepo
  const postRepo: DocRepo
  const commentRepo: DocRepo
  const repo: DocRepo
  const repos: any
  const query: SelectQueryBuilder<Database, 'users', User>
  const rawError: unknown
  const error: unknown
  const cursor: string
  const startDate: Date
  const endDate: Date
  const userId: number
  const postId: number
  const tenantId: string
  const currentUser: { id: any; uuid: string; role: string; roles: string[]; tenantId: string; organizationId: number } | undefined
  const seatId: any
  const SeatTakenError: any
  const metrics: any
  const MyService: any
  const currentUserId: number
  const user: User
  const users: User[]
  const post: Post
  const posts: Post[]
  const data: any
  const userData: any
  const rlsSchema: any
  const rlsContext: any
  const adapter: any
  const app: import('express').Application
  const factory: any
  const migrations: any[]
  // repository factories: typed so createRepository/createRepos infer 'any'
  const createUserRepository: (executor: any) => any
  const createPostRepository: (executor: any) => any
  const createCommentRepository: (executor: any) => any
  const createOrderRepository: (executor: any) => any
  const createRepos: any
  const CreateUserSchema: any
  const UpdateUserSchema: any
  const UserSchema: any
  // narrative references that individual pages leave undeclared
  type DB = Database
  const createUser: any
  // DAL-style query functions: typed as QueryFunction so the composition
  // helpers (compose/chain/parallel/conditional) infer DB = Database.
  const getUser: QueryFunction<Database, any[], any>
  const getUsers: QueryFunction<Database, any[], any[]>
  const getUserById: QueryFunction<Database, any[], any>
  const getPosts: QueryFunction<Database, any[], any[]>
  const getUserPosts: QueryFunction<Database, any[], any[]>
  const createProfile: (...args: any[]) => Promise<any>
  const profileData: any
  const authenticate: (req: any) => Promise<any>
  const mapUserRow: (row: any) => User
  const breaker: any
  const runner: any
  const e: any
  const eb: any
  const qb: any
  const input: any
  const request: any
  const metricsPool: any
  const loggingService: any
  const orderRepo: DocRepo
  const productRepo: DocRepo
  const baseRepo: DocRepo
  const order: any
  const id: number
  const ids: number[]
  const tenantSchema: any
  const pgPool: any
  const myPlugin: any
  const monitoring: any
  type CreateUserInput = { email: string; name: string; [k: string]: any }

  // Long-tail narrative identifiers (census-harvested). All deliberately
  // loose: they exist so fragments referencing surrounding prose compile,
  // while the kysera API calls in the same snippet stay fully checked.
  const getCurrentUserId: (...args: any[]) => any
  const getAllUsers: QueryFunction<Database, any[], any[]>
  const getAllPosts: QueryFunction<Database, any[], any[]>
  const findUserById: (...args: any[]) => Promise<any>
  const findUserByEmail: (...args: any[]) => Promise<any>
  const createRepositories: any
  const auditLogId: any
  const alerting: any
  const userContext: any
  const thirtyDaysAgo: Date
  const table: any
  const session: any
  const riskyOperation: any
  const pluginA: any
  const pluginB: any
  const plugins: any[]
  const pkConfig: any
  const originalCreatedAt: any
  const orderId: any
  const now: any
  const notifySlack: any
  const monitor: any
  const item: any
  const items: any[]
  const invalidData: any
  const getFollowers: any
  const getDashboardStats: any
  const getCurrentRequest: any
  const extractTenantFromSubdomain: any
  const createUserWithProfile: any
  const createProductRepository: any
  const createProfileRepository: any
  const createMigrationRepository: any
  const createCartRepository: any
  const createPost: any
  const cache: any
  const auditId: any
  const allRows: any[]
  const yesterday: Date
  const today: Date
  const where: any
  const validateData: any
  const validateAndPrepareUserData: any
  const updates: any
  const updateProfile: any
  const updateExternalService: any
  const updateAccountBalance: any
  const totalCount: number
  const testDb: any
  const tenantContext: any
  const taskRepo: DocRepo
  const syncContextToPostgres: any
  const startOfWeek: Date
  const startOfMonth: Date
  const endOfWeek: Date
  const endOfMonth: Date
  const lastMonth: Date
  const oneMonthAgo: Date
  const sqliteError: unknown
  const pgError: unknown
  const mysqlError: unknown
  const mssqlError: unknown
  const someValue: any
  const someCondition: boolean
  const signedCursor: string
  const sendWelcomeEmail: any
  const sendEmail: any
  const runMigration: any
  const rows: any[]
  const row: any
  const roleSchema: any
  const processUser: any
  const processOrder: any
  const previousCursor: string
  const postData: any
  const pg: any
  const paymentId: any
  const originalPath: any
  const orderData: any
  const offset: number
  const myLogger: any
  const mockQb: any
  const migrateToLatest: any
  const logToMonitoring: any
  const logError: any
  const listUsers: any
  const lastCursor: string
  const getUserStats: QueryFunction<Database, any[], any>
  const getUsersQuery: any
  const getStats: QueryFunction<Database, any[], any>
  const getSettings: QueryFunction<Database, any[], any>
  const getProcessedCount: any
  const getPremiumFeatures: QueryFunction<Database, any[], any[]>
  const getPostsByUserId: QueryFunction<Database, any[], any[]>
  const getNotifications: QueryFunction<Database, any[], any[]>
  const getComplexAnalytics: QueryFunction<Database, any[], any>
  const flushPendingWork: any
  const flushCache: any
  const fetchExternalService: any
  const fetchExternalProfile: any
  const eventRepo: DocRepo
  const dialect: any
  const deleteUser: any
  const defaultOptions: any
  const customSchema: any
  const CURSOR_SECRET: string
  const credit: any
  const debit: any
  const createTestUser: any
  const createTestDb: any
  const createPool: any
  const createConnection: any
  const contactRepo: DocRepo
  const conditions: any
  const cleanup: any
  const baseDb: any
  const baseCtx: any
  const apm: any
  const amount: number
  const adminUserId: any
  const acmePostId: any
  const accountId: any
  // Names used in type position by narrative fragments
  type T = any
  type MyDB = Database
  type MyPluginOptions = any
  type Order = any
  type Product = any
  type UserInput = any
  const Order: any
  const Product: any
  const BusinessError: any
  const ApplicationError: any
  const ConflictError: any
  const CreateTenantUserSchema: any
  const config: any
  const options: any
  const result: any
  const plugin: any
  const schema: any
  const req: any
  const res: any
  const next: any
}

export {}
`

// Ambient module declarations for packages referenced in docs but not
// installed anywhere in the workspace. Keep this list short and census-driven.
const AMBIENT_MODULES: string[] = [
  // integration examples reference these without shipping them in the workspace
  'winston',
  'pino',
  'tedious',
  'tarn',
  'tarn-tedious',
  // Deno-style npm: specifier for pg (type-only re-export below covers kysely)
  'npm:pg@^8'
]

// Deno npm: specifiers that re-export real workspace/registry types so
// `new Kysely<Database>()` etc. stay fully checked in the runtimes guide.
const NPM_REEXPORTS = `
declare module 'npm:kysely@^0.29.4' {
  export * from 'kysely'
}
declare module 'npm:@kysera/core@^0.9.0' {
  export * from '@kysera/core'
}
declare module 'npm:@kysera/executor@^0.9.0' {
  export * from '@kysera/executor'
}
`

// ---------------------------------------------------------------------------
// Synthetic import injection.
//
// Doc snippets deliberately elide imports for well-known names (`z`, `Kysely`,
// `createORM`, …). For every identifier a snippet uses but neither declares
// nor imports, and that maps to a known module export, the generator appends
// a synthetic `import { name } from 'module'` line AFTER the snippet body
// (TypeScript hoists imports, and appending keeps md line mapping intact).
// @kysera/* export lists are harvested from the real package sources; the
// entries below cover third-party modules.
// ---------------------------------------------------------------------------
const THIRD_PARTY_IMPORTS: Record<string, string> = {
  // kysely
  Kysely: 'kysely',
  Transaction: 'kysely',
  Generated: 'kysely',
  GeneratedAlways: 'kysely',
  ColumnType: 'kysely',
  Selectable: 'kysely',
  Insertable: 'kysely',
  Updateable: 'kysely',
  sql: 'kysely',
  PostgresDialect: 'kysely',
  MysqlDialect: 'kysely',
  SqliteDialect: 'kysely',
  CamelCasePlugin: 'kysely',
  CompiledQuery: 'kysely',
  SelectQueryBuilder: 'kysely',
  ExpressionBuilder: 'kysely',
  Expression: 'kysely',
  RawBuilder: 'kysely',
  KyselyPlugin: 'kysely',
  QueryResult: 'kysely',
  RootOperationNode: 'kysely',
  UnknownRow: 'kysely',
  DatabaseConnection: 'kysely',
  PluginTransformQueryArgs: 'kysely',
  PluginTransformResultArgs: 'kysely',
  // zod
  z: 'zod',
  ZodError: 'zod',
  // pg
  Pool: 'pg',
  PoolClient: 'pg',
  PoolConfig: 'pg',
  // vitest
  describe: 'vitest',
  it: 'vitest',
  test: 'vitest',
  expect: 'vitest',
  beforeEach: 'vitest',
  afterEach: 'vitest',
  beforeAll: 'vitest',
  afterAll: 'vitest',
  vi: 'vitest'
}

/** Packages whose export lists are harvested for import injection (order = precedence). */
const KYSERA_PACKAGES = [
  'repository',
  'dal',
  'executor',
  'core',
  'soft-delete',
  'audit',
  'timestamps',
  'rls',
  'migrations',
  'dialects',
  'debug',
  'infra',
  'testing'
]

/** name → module map for injection, merged from harvested exports + third-party. */
function buildInjectionMap(): Map<string, string> {
  const map = new Map<string, string>()
  for (const [name, mod] of Object.entries(THIRD_PARTY_IMPORTS)) map.set(name, mod)

  const entryFiles: { pkg: string; file: string }[] = []
  for (const pkg of KYSERA_PACKAGES) {
    const entry = join(ROOT, 'packages', pkg, 'src', 'index.ts')
    if (existsSync(entry)) entryFiles.push({ pkg: `@kysera/${pkg}`, file: entry })
  }
  const program = ts.createProgram(
    entryFiles.map(e => e.file),
    {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      paths: buildKyseraPaths()
    }
  )
  const checker = program.getTypeChecker()
  // later entries must not override earlier ones (precedence order above)
  for (const { pkg, file } of entryFiles) {
    const sf = program.getSourceFile(file)
    if (!sf) continue
    const symbol = checker.getSymbolAtLocation(sf)
    if (!symbol) continue
    for (const exp of checker.getExportsOfModule(symbol)) {
      if (!map.has(exp.name)) map.set(exp.name, pkg)
    }
  }
  return map
}

/**
 * Names a snippet uses as identifiers minus names it declares or imports
 * itself, intersected with the injection map.
 */
function computeInjections(code: string, injectable: Map<string, string>): Map<string, Set<string>> {
  const src = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true)
  const declared = new Set<string>()
  const used = new Set<string>()

  const collectBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) declared.add(name.text)
    else {
      for (const el of name.elements) {
        if (ts.isBindingElement(el)) collectBinding(el.name)
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause
      if (clause.name) declared.add(clause.name.text)
      if (clause.namedBindings) {
        if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) declared.add(el.name.text)
        } else {
          declared.add(clause.namedBindings.name.text)
        }
      }
    } else if (ts.isVariableDeclaration(node)) {
      collectBinding(node.name)
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isModuleDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      declared.add(node.name.text)
    } else if (ts.isIdentifier(node)) {
      // skip identifiers in non-reference positions (property names, labels…)
      const p = node.parent
      const isPropertyName =
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        (ts.isPropertyAssignment(p) && p.name === node) ||
        (ts.isPropertySignature(p) && p.name === node) ||
        (ts.isPropertyDeclaration(p) && p.name === node) ||
        (ts.isMethodDeclaration(p) && p.name === node) ||
        (ts.isMethodSignature(p) && p.name === node) ||
        (ts.isQualifiedName(p) && p.right === node)
      if (!isPropertyName) used.add(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(src)

  const byModule = new Map<string, Set<string>>()
  for (const name of used) {
    if (declared.has(name)) continue
    const mod = injectable.get(name)
    if (!mod) continue
    const set = byModule.get(mod) ?? new Set<string>()
    set.add(name)
    byModule.set(mod, set)
  }
  return byModule
}

// Relative-import stubs: specifier -> exported names with precise types where
// the name matches a well-known doc identifier. Auto-extended at runtime with
// `any`-typed exports for whatever names snippets actually import.
const KNOWN_EXPORT_TYPES: Record<string, string> = {
  db: "import('kysely').Kysely<Database>",
  executor: "import('@kysera/executor').KyseraExecutor<Database>",
  pool: "import('pg').Pool",
  ctx: "import('@kysera/dal').DbContext<Database>",
  logger: "import('@kysera/core').KyseraLogger"
}

// ---------------------------------------------------------------------------
// Snippet extraction
// ---------------------------------------------------------------------------

interface Snippet {
  /** doc path relative to repo root, posix-style */
  docPath: string
  /** 1-based line number of the opening fence */
  fenceLine: number
  /** snippet body (indent stripped) */
  code: string
  /** generated file absolute path */
  genPath: string
}

interface FileCensus {
  docPath: string
  checked: number
  skipped: number
  failed: number
}

function listMarkdownFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(join(entry.parentPath, entry.name))
    }
  }
  return out.sort()
}

const FENCE_OPEN = /^(\s*)```(\S*)(.*)$/

function extractSnippets(
  absPath: string,
  docPath: string,
  census: FileCensus
): Snippet[] {
  const text = readFileSync(absPath, 'utf8')
  const lines = text.split('\n')
  const snippets: Snippet[] = []

  let inFence = false
  let fenceIndent = 0
  let isTs = false
  let fenceLine = 0
  let body: string[] = []
  /** last non-blank line seen outside fences */
  let lastNonBlank = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (!inFence) {
      const m = FENCE_OPEN.exec(line)
      if (m) {
        inFence = true
        fenceIndent = (m[1] ?? '').length
        const lang = (m[2] ?? '').toLowerCase()
        const skipRequested = SKIP_MARKERS.includes(lastNonBlank)
        isTs = (lang === 'ts' || lang === 'typescript') && !skipRequested
        if ((lang === 'ts' || lang === 'typescript') && skipRequested) {
          census.skipped++
        }
        fenceLine = i + 1
        body = []
      } else if (line.trim() !== '') {
        lastNonBlank = line.trim()
      }
      continue
    }
    // inside a fence
    if (line.slice(0, fenceIndent + 3).trim() === '```' && line.trim() === '```') {
      if (isTs) {
        snippets.push({
          docPath,
          fenceLine,
          code: body.join('\n'),
          genPath: '' // filled by caller
        })
        census.checked++
      }
      inFence = false
      isTs = false
      lastNonBlank = '' // a fence resets the marker window
      continue
    }
    if (isTs) {
      // CommonMark strips up to the opening fence's indentation
      body.push(stripIndent(line, fenceIndent))
    }
  }
  return snippets
}

function stripIndent(line: string, indent: number): string {
  let i = 0
  while (i < indent && i < line.length && line[i] === ' ') i++
  return line.slice(i)
}

// ---------------------------------------------------------------------------
// Generated-module scaffolding
// ---------------------------------------------------------------------------

/** import specifiers appearing in a snippet, e.g. `./db` or `@kysera/core` */
function collectImports(code: string): { specifier: string; names: string[] }[] {
  const out: { specifier: string; names: string[] }[] = []
  const src = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, false)
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const names: string[] = []
      if (ts.isImportDeclaration(node) && node.importClause) {
        const clause = node.importClause
        if (clause.name) names.push('default')
        if (clause.namedBindings) {
          if (ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) {
              names.push((el.propertyName ?? el.name).text)
            }
          }
          // namespace imports need no named stubs
        }
      }
      // `export { a, b } from './x'` re-exports also need the names stubbed
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          names.push((el.propertyName ?? el.name).text)
        }
      }
      out.push({ specifier: node.moduleSpecifier.text, names })
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
  return out
}

/** Build tsconfig `paths` from workspace package exports, dist → src. */
function buildKyseraPaths(): Record<string, string[]> {
  const paths: Record<string, string[]> = {
    // zod and vitest are not root dependencies; resolve them through packages
    // that ship them (pnpm links them into the package's node_modules)
    zod: [join(ROOT, 'packages/repository/node_modules/zod')],
    'zod/*': [join(ROOT, 'packages/repository/node_modules/zod/*')],
    vitest: [join(ROOT, 'packages/core/node_modules/vitest')],
    'vitest/*': [join(ROOT, 'packages/core/node_modules/vitest/*')]
  }
  const packagesDir = join(ROOT, 'packages')
  for (const dir of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const pkgJsonPath = join(packagesDir, dir.name, 'package.json')
    if (!existsSync(pkgJsonPath)) continue
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      name?: string
      exports?: Record<string, unknown>
    }
    if (!pkg.name || !pkg.exports) continue
    for (const [sub, target] of Object.entries(pkg.exports)) {
      const entry =
        typeof target === 'string'
          ? target
          : ((target as Record<string, string | undefined>)['import'] ??
            (target as Record<string, string | undefined>)['types'])
      if (typeof entry !== 'string') continue
      const srcFile = entry
        .replace(/^\.\/dist\//, 'src/')
        .replace(/\.d\.ts$/, '.ts')
        .replace(/\.js$/, '.ts')
      const abs = join(packagesDir, dir.name, srcFile)
      if (!existsSync(abs)) continue
      const key = sub === '.' ? pkg.name : `${pkg.name}/${sub.slice(2)}`
      paths[key] = [abs]
    }
  }
  return paths
}

// ---------------------------------------------------------------------------
// Fragment classifier (used by --suggest-skips).
//
// A snippet is structurally a fragment — API-signature listing, exports
// listing, or prose excerpt — when it cannot stand alone as a program:
//   - it does not parse as TypeScript
//   - it contains top-level function/constructor declarations without bodies
//   - it contains bare `export { … }` lists (no module specifier, names never
//     declared locally)
//   - it redeclares the same top-level binding (docs showing alternatives)
// ---------------------------------------------------------------------------
function classifyFragment(code: string): string | null {
  const src = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true)
  const parseDiags = (src as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics
  if (parseDiags.length > 0) return 'does not parse (prose/fragment)'

  const topLevelNames = new Map<string, number>()
  let verdict: string | null = null

  const declareTop = (name: string): void => {
    topLevelNames.set(name, (topLevelNames.get(name) ?? 0) + 1)
  }

  // a `return` outside any function — an excerpt from inside a function body
  const hasBareReturn = (node: ts.Node): boolean => {
    if (ts.isReturnStatement(node)) return true
    if (ts.isFunctionLike(node)) return false
    let found = false
    node.forEachChild(child => {
      if (!found && hasBareReturn(child)) found = true
    })
    return found
  }

  for (const stmt of src.statements) {
    if (hasBareReturn(stmt)) {
      verdict = 'function-body excerpt (top-level return)'
    }
    if (ts.isLabeledStatement(stmt)) {
      // e.g. `interceptQuery: (qb, context) => { … }` — an object-property
      // excerpt shown outside its object literal
      verdict = 'object-property excerpt (labeled statement)'
    }
    if (ts.isFunctionDeclaration(stmt) && !stmt.body) {
      verdict = 'signature without implementation'
    }
    if (ts.isClassDeclaration(stmt)) {
      for (const member of stmt.members) {
        if (
          (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) &&
          !member.body
        ) {
          verdict = 'class member signature without implementation'
        }
      }
    }
    if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause) {
      verdict = 'bare export list'
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) declareTop(decl.name.text)
      }
    }
    if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
      stmt.name &&
      stmt.body !== undefined
    ) {
      declareTop(stmt.name.text)
    }
  }
  for (const [name, count] of topLevelNames) {
    if (count > 1) verdict = `redeclares '${name}' (alternatives listing)`
  }
  return verdict
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): number {
  const suggestSkips = process.argv.includes('--suggest-skips')
  rmSync(CACHE_DIR, { recursive: true, force: true })
  mkdirSync(CACHE_DIR, { recursive: true })

  const mdFiles = listMarkdownFiles(DOCS_DIR)
  const censusByFile = new Map<string, FileCensus>()
  const snippets: Snippet[] = []

  for (const abs of mdFiles) {
    const docPath = relative(ROOT, abs).split(sep).join('/')
    const census: FileCensus = { docPath, checked: 0, skipped: 0, failed: 0 }
    censusByFile.set(docPath, census)
    const found = extractSnippets(abs, docPath, census)
    for (const snip of found) {
      const base = relative(DOCS_DIR, abs).split(sep).join('__').replace(/\.md$/, '')
      snip.genPath = join(CACHE_DIR, `${base}.s${String(snippets.length).padStart(4, '0')}.ts`)
      snippets.push(snip)
    }
  }

  if (process.argv.includes('--map')) {
    for (const snip of snippets) console.log(`${snip.docPath}:${snip.fenceLine}`)
    return 0
  }

  if (suggestSkips) {
    let count = 0
    for (const snip of snippets) {
      const verdict = classifyFragment(snip.code)
      if (verdict) {
        console.log(`${snip.docPath}:${snip.fenceLine}: ${verdict}`)
        count++
      }
    }
    console.log(`# ${count} of ${snippets.length} snippets classified as fragments`)
    return 0
  }

  // Write snippet modules and collect relative/bare imports for stubbing
  const injectable = buildInjectionMap()
  const relativeStubs = new Map<string, Set<string>>()
  for (const snip of snippets) {
    const injected: string[] = []
    for (const [mod, names] of computeInjections(snip.code, injectable)) {
      injected.push(`import { ${[...names].sort().join(', ')} } from '${mod}'`)
    }
    writeFileSync(snip.genPath, `${snip.code}\nexport {}\n${injected.join('\n')}\n`)
    for (const imp of collectImports(snip.code)) {
      if (imp.specifier.startsWith('.')) {
        // normalize ./db, ./db.js and ./db.ts to one stub module
        const key = imp.specifier.replace(/\.(js|ts)$/, '')
        const set = relativeStubs.get(key) ?? new Set<string>()
        for (const n of imp.names) set.add(n)
        relativeStubs.set(key, set)
      }
    }
  }

  // Relative-import stub modules
  const IDENT = /^[A-Za-z_$][\w$]*$/
  const cacheParent = join(ROOT, 'node_modules', '.cache')
  for (const [specifier, names] of relativeStubs) {
    // write the stub where module resolution will actually look for it
    const stubPath = resolve(CACHE_DIR, `${specifier}.ts`)
    if (!stubPath.startsWith(cacheParent + sep)) {
      console.log(`  WARNING: relative import escapes the cache dir, not stubbed: ${specifier}`)
      continue
    }
    mkdirSync(dirname(stubPath), { recursive: true })
    const lines: string[] = ['/* auto-generated stub for doc snippets */']
    for (const name of names) {
      if (name === 'default') {
        lines.push('declare const _default: any', 'export default _default')
      } else if (IDENT.test(name)) {
        const type = KNOWN_EXPORT_TYPES[name] ?? 'any'
        lines.push(`export declare const ${name}: ${type}`)
        lines.push(`export type ${name} = any`)
      }
    }
    lines.push('export {}')
    writeFileSync(stubPath, `${lines.join('\n')}\n`)
  }

  const preludePath = join(CACHE_DIR, '_prelude.d.ts')
  writeFileSync(preludePath, PRELUDE)

  const modulesPath = join(CACHE_DIR, '_modules.d.ts')
  writeFileSync(
    modulesPath,
    AMBIENT_MODULES.map(m => `declare module '${m}'`).join('\n') +
      NPM_REEXPORTS +
      `
// express gets a minimally-typed shape (instead of an implicit-any module) so
// middleware callbacks receive contextual types and don't trip noImplicitAny.
declare module 'express' {
  type HandlerFn = (req: any, res: any, next: (err?: any) => any) => any
  interface App {
    use(handler: HandlerFn): App
    use(...handlers: any[]): App
    get(path: string, handler: (req: any, res: any, next?: any) => any): App
    get(path: string, ...handlers: any[]): App
    post(path: string, handler: (req: any, res: any, next?: any) => any): App
    post(path: string, ...handlers: any[]): App
    put(path: string, handler: (req: any, res: any, next?: any) => any): App
    put(path: string, ...handlers: any[]): App
    delete(path: string, handler: (req: any, res: any, next?: any) => any): App
    delete(path: string, ...handlers: any[]): App
    listen(port: number, cb?: () => void): any
  }
  function express(): App
  namespace express {
    function json(): HandlerFn
    function Router(): any
    type Application = App
    type Handler = HandlerFn
    type Request = any
    type Response = any
    type NextFunction = (err?: any) => any
  }
  export = express
}
`
    // NOTE: no trailing \`export {}\` — that would turn this .d.ts into a
    // module and shorthand \`declare module 'x'\` statements would stop
    // registering as ambient modules.
  )

  // -------------------------------------------------------------------------
  // Compile
  // -------------------------------------------------------------------------
  const options: ts.CompilerOptions = {
    strict: true,
    // Docs routinely show class shapes without constructors; requiring
    // definite assignment in illustrative classes adds noise, not safety.
    strictPropertyInitialization: false,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.esnext.d.ts'],
    types: ['node'],
    esModuleInterop: true,
    allowJs: false,
    // no baseUrl (deprecated in TS 6) — all paths entries are absolute
    paths: buildKyseraPaths()
  }

  const rootFiles = [preludePath, modulesPath, ...snippets.map(s => s.genPath)]
  const program = ts.createProgram(rootFiles, options)
  const diagnostics = ts.getPreEmitDiagnostics(program)

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------
  const genToSnippet = new Map(snippets.map(s => [s.genPath.split(sep).join('/'), s]))
  const errors: string[] = []
  let internalErrors = 0
  let sourceErrors = 0

  for (const diag of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(diag.messageText, ' ')
    if (!diag.file) {
      errors.push(`(global) TS${diag.code} ${message}`)
      continue
    }
    const fileName = resolve(diag.file.fileName).split(sep).join('/')
    const snip = genToSnippet.get(fileName)
    if (!snip) {
      if (fileName.includes('/kysera-doc-snippets/')) internalErrors++
      else sourceErrors++
      continue
    }
    const { line } = diag.file.getLineAndCharacterOfPosition(diag.start ?? 0)
    const mdLine = snip.fenceLine + line + 1
    errors.push(`${snip.docPath}:${mdLine}: TS${diag.code} ${message}`)
    const fileCensus = censusByFile.get(snip.docPath)
    if (fileCensus) fileCensus.failed++
  }

  // Census by section (top-level dir under website/docs, root files → "root")
  const sections = new Map<string, { checked: number; skipped: number; failed: number }>()
  for (const census of censusByFile.values()) {
    const rel = census.docPath.replace(/^website\/docs\//, '')
    const section = rel.includes('/') ? (rel.split('/')[0] ?? 'root') : 'root'
    const agg = sections.get(section) ?? { checked: 0, skipped: 0, failed: 0 }
    agg.checked += census.checked
    agg.skipped += census.skipped
    agg.failed += census.failed
    sections.set(section, agg)
  }

  console.log('Doc snippet typecheck census')
  console.log('----------------------------')
  let tChecked = 0
  let tSkipped = 0
  let tFailed = 0
  for (const [section, agg] of [...sections.entries()].sort()) {
    console.log(
      `  ${section.padEnd(14)} checked ${String(agg.checked).padStart(4)}  skipped ${String(
        agg.skipped
      ).padStart(3)}  failed ${String(agg.failed).padStart(3)}`
    )
    tChecked += agg.checked
    tSkipped += agg.skipped
    tFailed += agg.failed
  }
  console.log('----------------------------')
  console.log(`  total          checked ${tChecked}  skipped ${tSkipped}  failed ${tFailed}`)

  if (sourceErrors > 0) {
    console.log(`  note: ${sourceErrors} diagnostic(s) in non-snippet sources were ignored`)
  }
  if (internalErrors > 0) {
    console.log(`  WARNING: ${internalErrors} diagnostic(s) in generated scaffolding (script bug?)`)
  }

  if (errors.length > 0) {
    console.log('\nErrors:')
    for (const e of errors) console.log(`  ${e}`)
    return 1
  }
  return 0
}

process.exit(main())
