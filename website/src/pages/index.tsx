import type { ReactNode } from 'react'
import clsx from 'clsx'
import Link from '@docusaurus/Link'
import Layout from '@theme/Layout'
import Heading from '@theme/Heading'
import CodeBlock from '@theme/CodeBlock'

import styles from './index.module.css'

/* ----------------------------------------------------------------------------
 * Hero — positioning + the differentiator in code: one plugin core, two patterns
 * ------------------------------------------------------------------------- */

const heroCode = `const executor = await createExecutor(db, [
  rlsPlugin({ schema: rlsSchema }),
  softDeletePlugin(),
])

// One plugin core — both patterns
const orm = await createORM(executor, [])   // Repository
const ctx = createContext(executor)         // Functional DAL

// Filters, security, and audit apply everywhere —
// including inside transactions`

function Hero() {
  return (
    <header className={styles.hero}>
      <div className="container">
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <div className={styles.badges}>
              <span className={styles.badge}>v0.9</span>
              <span className={styles.badge}>ESM-only</span>
              <span className={styles.badge}>TypeScript strict</span>
              <span className={styles.badge}>Node 22+ · Bun · Deno</span>
            </div>
            <Heading as="h1" className={styles.heroTitle}>
              The type-safe data layer for{' '}
              <a href="https://kysely.dev" className={styles.kyselyLink}>
                Kysely
              </a>
            </Heading>
            <p className={styles.heroSubtitle}>
              Repositories, functional queries, and a plugin core that hardens both — in a toolkit
              that never hides your SQL. Not an ORM, by design.
            </p>
            <div className={styles.heroButtons}>
              <Link className="button button--primary button--lg" to="/docs/getting-started">
                Get Started
              </Link>
              <Link
                className="button button--outline button--primary button--lg"
                to="/docs/introduction"
              >
                Why not an ORM?
              </Link>
            </div>
            <p className={styles.worksWith}>
              Works with PostgreSQL · MySQL · SQLite · MSSQL
            </p>
          </div>
          <div className={styles.heroCode}>
            <CodeBlock language="typescript">{heroCode}</CodeBlock>
          </div>
        </div>
      </div>
    </header>
  )
}

/* ----------------------------------------------------------------------------
 * Positioning — three honest claims, each verifiable in the docs
 * ------------------------------------------------------------------------- */

const positions = [
  {
    title: 'SQL you can still see',
    body: (
      <>
        Kysera is a thin layer over Kysely, not a replacement for it. Every query is still a Kysely
        query; every escape hatch stays open — drop to the raw instance or a <code>sql</code>{' '}
        template whenever you need to.
      </>
    )
  },
  {
    title: 'One plugin core, two patterns',
    body: (
      <>
        Plugins intercept queries at the executor, so the Repository pattern and the functional DAL
        share the same soft-delete filters, RLS policies, and audit trail — in and out of
        transactions. Mix both styles in one codebase (CQRS-lite).
      </>
    )
  },
  {
    title: 'Hardened by default',
    body: (
      <>
        Row-level security enforces <code>SELECT</code>, <code>UPDATE</code>, and{' '}
        <code>DELETE</code> in SQL. Soft delete narrows mutations to live rows. Opt-outs are scoped
        per statement — there is no global bypass switch to forget about.
      </>
    )
  }
]

function Positioning() {
  return (
    <section className={styles.positioning}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          Not an ORM. A data-access toolkit.
        </Heading>
        <div className={styles.positionGrid}>
          {positions.map(p => (
            <div key={p.title} className={styles.positionCard}>
              <Heading as="h3">{p.title}</Heading>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------------------
 * Two patterns, side by side
 * ------------------------------------------------------------------------- */

const repositoryCode = `import {
  createORM, createRepositoryFactory, zodAdapter
} from '@kysera/repository'

const orm = await createORM(executor, [])

const users = orm.createRepository(exec =>
  createRepositoryFactory(exec).create({
    tableName: 'users',
    mapRow: row => row,
    schemas: { create: zodAdapter(CreateUser) },
  })
)

const user = await users.create({
  email: 'ada@example.com',
  name: 'Ada',
})
await users.softDelete(user.id) // added by the plugin
await users.findAll()           // deleted rows filtered`

const dalCode = `import {
  createQuery, createContext, withTransaction
} from '@kysera/dal'

const userByEmail = createQuery(
  (ctx: DbContext<DB>, email: string) =>
    ctx.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst()
)

const ctx = createContext(executor)
await userByEmail(ctx, 'ada@example.com')
// soft-delete filter applied automatically

await withTransaction(executor, async tx => {
  await userByEmail(tx, 'ada@example.com')
}) // plugins survive; nested calls → savepoints`

function Patterns() {
  return (
    <section className={styles.patterns}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          Pick a pattern. Or both.
        </Heading>
        <p className={styles.sectionLead}>
          Structured CRUD where you want conventions, composable functions where you want reach —
          against the same executor, the same plugins, the same transaction.
        </p>
        <div className={styles.patternGrid}>
          <div className={styles.patternCol}>
            <h3 className={styles.patternLabel}>Repository</h3>
            <CodeBlock language="typescript" title="users.repository.ts">
              {repositoryCode}
            </CodeBlock>
          </div>
          <div className={styles.patternCol}>
            <h3 className={styles.patternLabel}>Functional DAL</h3>
            <CodeBlock language="typescript" title="users.queries.ts">
              {dalCode}
            </CodeBlock>
          </div>
        </div>
        <p className={styles.patternFooter}>
          Writes through repositories, complex reads through the DAL —{' '}
          <Link to="/docs/guides/dal-vs-repository">the CQRS-lite guide</Link> shows when to reach
          for which.
        </p>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------------------
 * Plugins — the four that exist, described by what they actually do
 * ------------------------------------------------------------------------- */

const plugins = [
  {
    name: 'Soft Delete',
    size: '~4 KB',
    to: '/docs/plugins/soft-delete',
    body: 'Filters reads and narrows UPDATE/DELETE to live rows. Per-statement opt-out, no global bypass.'
  },
  {
    name: 'Timestamps',
    size: '~5 KB',
    to: '/docs/plugins/timestamps',
    body: 'created_at / updated_at on repository writes — bulk methods included, explicit values win.'
  },
  {
    name: 'Audit',
    size: '~12 KB',
    to: '/docs/plugins/audit',
    body: 'Row-level history with old/new values, committed atomically with the mutation. Restore included.'
  },
  {
    name: 'Row-Level Security',
    size: '~53 KB',
    to: '/docs/plugins/rls',
    body: 'Declarative policies enforced in SQL for reads and mutations — plus native PostgreSQL RLS generation.'
  }
]

function Plugins() {
  return (
    <section className={styles.plugins}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          Four plugins. No magic.
        </Heading>
        <p className={styles.sectionLead}>
          Each plugin declares a priority tier and intercepts queries in a fixed, inspectable order:
          security → filters → transforms → audit.
        </p>
        <div className={styles.pluginGrid}>
          {plugins.map(p => (
            <Link key={p.name} to={p.to} className={styles.pluginCard}>
              <div className={styles.pluginHead}>
                <span className={styles.pluginName}>{p.name}</span>
                <span className={styles.pluginSize}>{p.size}</span>
              </div>
              <p>{p.body}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------------------
 * Toolkit — everything around the data layer, one concrete line each
 * ------------------------------------------------------------------------- */

const toolkit = [
  {
    title: 'Migrations',
    to: '/docs/api/migrations',
    body: 'Advisory-locked runs (PostgreSQL/MySQL), sha256 drift detection, dry-run plans, baselining.'
  },
  {
    title: 'CLI',
    to: '/docs/cli/overview',
    body: 'kysera doctor, live-DB type codegen, migrate verify/baseline, RLS DDL generation, shell completions.'
  },
  {
    title: 'Production infra',
    to: '/docs/guides/production',
    body: 'Health checks and monitoring, retry with backoff, circuit breaker, graceful shutdown.'
  },
  {
    title: 'Debugging',
    to: '/docs/api/debug',
    body: 'Query logging, slow-query alerts, profiler with percentile metrics — wraps any Kysely instance.'
  },
  {
    title: 'Testing',
    to: '/docs/api/testing',
    body: 'Transaction-rollback isolation, data factories, plugin mocks and spies, cleanup helpers.'
  },
  {
    title: 'Dialects',
    to: '/docs/api/dialects',
    body: 'Adapters for PostgreSQL, MySQL, SQLite, and MSSQL: unified error matching, URL and schema utilities.'
  }
]

function Toolkit() {
  return (
    <section className={styles.toolkit}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          Batteries included — separately.
        </Heading>
        <p className={styles.sectionLead}>
          Thirteen focused packages. Install what you use; tree-shake the rest.
        </p>
        <div className={styles.toolkitGrid}>
          {toolkit.map(t => (
            <Link key={t.title} to={t.to} className={styles.toolkitCard}>
              <Heading as="h3">{t.title}</Heading>
              <p>{t.body}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------------------
 * Stats — every number verifiable in the repo
 * ------------------------------------------------------------------------- */

const stats = [
  { value: '13', label: 'Focused packages' },
  { value: '4', label: 'Plugins' },
  { value: '0', label: 'Third-party runtime deps' },
  { value: '3', label: 'Runtimes: Node, Bun, Deno' }
]

function Stats() {
  return (
    <section className={styles.stats}>
      <div className="container">
        <div className={styles.statsGrid}>
          {stats.map(s => (
            <div key={s.label} className={styles.stat}>
              <div className={styles.statValue}>{s.value}</div>
              <div className={styles.statLabel}>{s.label}</div>
            </div>
          ))}
        </div>
        <p className={styles.statsFootnote}>
          Tested against live PostgreSQL and MySQL on every multi-database run. The executor core is
          ~9 KB; the functional DAL is ~4 KB.
        </p>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------------------
 * Quick start
 * ------------------------------------------------------------------------- */

const installCode = `npm install kysely zod
npm install @kysera/executor @kysera/repository @kysera/soft-delete`

const scaffoldCode = `npx @kysera/cli init my-app
npx @kysera/cli doctor`

const quickStartCode = `import { Kysely, PostgresDialect } from 'kysely'
import { createExecutor } from '@kysera/executor'
import {
  createORM, createRepositoryFactory, zodAdapter
} from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'
import { z } from 'zod'

const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool })
})

const executor = await createExecutor(db, [softDeletePlugin()])
const orm = await createORM(executor, [])

const users = orm.createRepository(exec =>
  createRepositoryFactory(exec).create({
    tableName: 'users',
    mapRow: row => row,
    schemas: {
      create: zodAdapter(
        z.object({ email: z.string().email(), name: z.string() })
      )
    },
  })
)

const user = await users.create({ email: 'ada@example.com', name: 'Ada' })
await users.softDelete(user.id)
await users.findAll() // soft-deleted rows are filtered out`

function QuickStart() {
  return (
    <section className={styles.quickStart}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          Up and running in a minute
        </Heading>
        <p className={styles.sectionLead}>
          Add the packages to an existing project, or let the CLI scaffold one — config,
          migrations, and a health check included.
        </p>
        <div className={styles.quickStartTop}>
          <div className={styles.quickStartCol}>
            <h3 className={styles.quickStartLabel}>Install</h3>
            <CodeBlock language="bash">{installCode}</CodeBlock>
            <p className={styles.quickStartNote}>
              ESM-only, Node 22+. Zod is optional — bring Valibot or TypeBox instead, or skip
              validation entirely.
            </p>
          </div>
          <div className={styles.quickStartCol}>
            <h3 className={styles.quickStartLabel}>Or scaffold a project</h3>
            <CodeBlock language="bash">{scaffoldCode}</CodeBlock>
            <p className={styles.quickStartNote}>
              <code>init</code> sets up config and migrations; <code>doctor</code> verifies the
              whole environment in one shot.
            </p>
          </div>
        </div>
        <div className={styles.quickStartUse}>
          <h3 className={styles.quickStartLabel}>Use</h3>
          <CodeBlock language="typescript">{quickStartCode}</CodeBlock>
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------------------
 * Final CTA
 * ------------------------------------------------------------------------- */

function FinalCta() {
  return (
    <section className={styles.finalCta}>
      <div className="container">
        <Heading as="h2">Keep your SQL. Gain the toolkit.</Heading>
        <div className={styles.heroButtons}>
          <Link className="button button--primary button--lg" to="/docs/introduction">
            Read the Introduction
          </Link>
          <Link className="button button--outline button--primary button--lg" to="/docs/examples/overview">
            Browse Examples
          </Link>
        </div>
      </div>
    </section>
  )
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="The type-safe data layer for Kysely"
      description="Kysera is a type-safe data-access toolkit for TypeScript built on Kysely: Repository pattern, functional DAL, and a security-hardened plugin core. Not an ORM."
    >
      <Hero />
      <main>
        <Positioning />
        <Patterns />
        <Plugins />
        <Toolkit />
        <Stats />
        <QuickStart />
        <FinalCta />
      </main>
    </Layout>
  )
}
