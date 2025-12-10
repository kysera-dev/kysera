import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  icon: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Type Safe',
    icon: '🛡️',
    description: (
      <>
        Full TypeScript support with strict mode. Zod validation for inputs,
        type-safe queries with Kysely, and comprehensive error types.
      </>
    ),
  },
  {
    title: 'Zero Dependencies',
    icon: '📦',
    description: (
      <>
        Core packages have zero runtime dependencies. Only peer dependencies
        on Kysely and Zod. Minimal security surface and full control.
      </>
    ),
  },
  {
    title: 'Production Ready',
    icon: '🚀',
    description: (
      <>
        Built-in health checks, graceful shutdown, retry logic, and circuit
        breaker. Battle-tested with 554+ passing tests.
      </>
    ),
  },
  {
    title: 'Plugin System',
    icon: '🔌',
    description: (
      <>
        Extend functionality with plugins: soft delete, audit logging,
        automatic timestamps, and row-level security.
      </>
    ),
  },
  {
    title: 'Multi-Database',
    icon: '🗄️',
    description: (
      <>
        Support for PostgreSQL, MySQL, and SQLite. Database-specific
        optimizations and unified error handling.
      </>
    ),
  },
  {
    title: 'Minimal & Modular',
    icon: '⚡',
    description: (
      <>
        Use only what you need. ~24KB core, ~12KB repository. Tree-shakeable
        ESM architecture for modern runtimes.
      </>
    ),
  },
];

function Feature({title, icon, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <div className={styles.featureIcon}>{icon}</div>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
