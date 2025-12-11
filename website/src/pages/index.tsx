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
  const installCode = `npm install kysely @kysera/core @kysera/repository zod`;

  const exampleCode = `import { Kysely, PostgresDialect } from 'kysely'
import { createRepositoryFactory } from '@kysera/repository'
import { z } from 'zod'

const db = new Kysely({ dialect: new PostgresDialect({ pool }) })
const factory = createRepositoryFactory(db)

const userRepo = factory.create({
  tableName: 'users',
  mapRow: (row) => row,
  schemas: {
    create: z.object({ email: z.string().email(), name: z.string() })
  }
})

const user = await userRepo.create({ email: 'john@example.com', name: 'John' })`;

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
            <div className={styles.statValue}>554+</div>
            <div className={styles.statLabel}>Tests Passing</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>~64KB</div>
            <div className={styles.statLabel}>Total Bundle</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>0</div>
            <div className={styles.statLabel}>Runtime Dependencies</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>3</div>
            <div className={styles.statLabel}>Database Support</div>
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
