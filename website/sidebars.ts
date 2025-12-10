import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'introduction',
      label: 'Introduction',
    },
    {
      type: 'doc',
      id: 'getting-started',
      label: 'Getting Started',
    },
    {
      type: 'category',
      label: 'Core Concepts',
      collapsed: false,
      items: [
        'core-concepts/overview',
        'core-concepts/architecture',
        'core-concepts/repository-pattern',
        'core-concepts/transactions',
        'core-concepts/validation',
        'core-concepts/error-handling',
      ],
    },
    {
      type: 'category',
      label: 'Plugins',
      collapsed: false,
      items: [
        'plugins/overview',
        'plugins/soft-delete',
        'plugins/audit',
        'plugins/timestamps',
        'plugins/rls',
        'plugins/authoring-guide',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/best-practices',
        'guides/testing',
        'guides/migrations',
        'guides/pagination',
      ],
    },
    {
      type: 'category',
      label: 'Examples',
      collapsed: true,
      items: [
        'examples/overview',
        'examples/blog-app',
        'examples/e-commerce',
        'examples/multi-tenant-saas',
      ],
    },
  ],
  apiSidebar: [
    {
      type: 'doc',
      id: 'api/overview',
      label: 'API Overview',
    },
    {
      type: 'category',
      label: '@kysera/core',
      collapsed: false,
      items: [
        'api/core',
        'api/core/errors',
        'api/core/pagination',
        'api/core/logger',
      ],
    },
    {
      type: 'category',
      label: '@kysera/repository',
      collapsed: false,
      items: [
        'api/repository',
        'api/repository/factory',
        'api/repository/validation',
        'api/repository/types',
      ],
    },
    {
      type: 'category',
      label: '@kysera/dal',
      collapsed: false,
      items: [
        'api/dal',
      ],
    },
    {
      type: 'category',
      label: '@kysera/infra',
      collapsed: true,
      items: [
        'api/infra',
      ],
    },
    {
      type: 'category',
      label: '@kysera/debug',
      collapsed: true,
      items: [
        'api/debug',
      ],
    },
    {
      type: 'category',
      label: '@kysera/testing',
      collapsed: true,
      items: [
        'api/testing',
      ],
    },
    {
      type: 'category',
      label: '@kysera/migrations',
      collapsed: true,
      items: [
        'api/migrations',
      ],
    },
  ],
  cliSidebar: [
    {
      type: 'doc',
      id: 'cli/overview',
      label: 'CLI Overview',
    },
    {
      type: 'category',
      label: 'Commands',
      collapsed: false,
      items: [
        'cli/init',
        'cli/migrate',
        'cli/generate',
        'cli/db',
        'cli/health',
        'cli/test',
        'cli/debug',
        'cli/query',
        'cli/repository',
        'cli/plugin',
        'cli/audit',
      ],
    },
    {
      type: 'doc',
      id: 'cli/configuration',
      label: 'Configuration',
    },
  ],
};

export default sidebars;
