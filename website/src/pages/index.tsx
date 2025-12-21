import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/introduction">
            Get Started
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/docs/api/core"
            style={{marginLeft: '1rem'}}>
            API Reference
          </Link>
        </div>
      </div>
    </header>
  );
}

function QuickStart() {
  const installCode = `npm install kysely @kysera/repository @kysera/soft-delete`;

  const exampleCode = `import { Kysely, PostgresDialect } from 'kysely'
import { createORM } from '@kysera/repository'
import { softDeletePlugin } from '@kysera/soft-delete'

const db = new Kysely({ dialect: new PostgresDialect({ pool }) })

// Create plugin container with soft delete - not a traditional ORM
const orm = await createORM(db, [softDeletePlugin()])

const userRepo = orm.createRepository({
  tableName: 'users',
  primaryKey: 'id',
  mapRow: (row) => row,
})

// CRUD with automatic soft delete filtering
const user = await userRepo.create({ email: 'john@example.com', name: 'John' })
const users = await userRepo.findAll() // excludes soft-deleted records`;

  return (
    <section className={styles.quickStart}>
      <div className="container">
        <Heading as="h2">Quick Start</Heading>
        <div className={styles.codeBlocks}>
          <div className={styles.codeBlock}>
            <h3>Install</h3>
            <CodeBlock language="bash">{installCode}</CodeBlock>
          </div>
          <div className={styles.codeBlock}>
            <h3>Use</h3>
            <CodeBlock language="typescript">{exampleCode}</CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section className={styles.stats}>
      <div className="container">
        <div className={styles.statsGrid}>
          <div className={styles.stat}>
            <div className={styles.statValue}>13</div>
            <div className={styles.statLabel}>Packages</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>5</div>
            <div className={styles.statLabel}>Plugins</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>0</div>
            <div className={styles.statLabel}>Runtime Dependencies</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>3</div>
            <div className={styles.statLabel}>Databases Supported</div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title="Type-safe data access toolkit"
      description="Type-safe data access toolkit for TypeScript built on Kysely. Repository pattern, Functional DAL, and plugin ecosystem.">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <Stats />
        <QuickStart />
      </main>
    </Layout>
  );
}
