import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'introduction',
      label: 'Introduction'
    },
    {
      type: 'doc',
      id: 'getting-started',
      label: 'Getting Started'
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
        'core-concepts/error-handling'
      ]
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
        'plugins/authoring-guide'
      ]
    },
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/best-practices',
        'guides/querying',
        'guides/testing',
        'guides/migrations',
        'guides/pagination',
        'guides/multi-database',
        'guides/dal-vs-repository',
        'guides/troubleshooting',
        {
          type: 'category',
          label: 'Migration Guides',
          collapsed: true,
          items: ['guides/migration-v07', 'guides/migration-v08']
        }
      ]
    },
    {
      type: 'category',
      label: 'Examples',
      collapsed: true,
      items: [
        'examples/overview',
        'examples/blog-app',
        'examples/e-commerce',
        'examples/multi-tenant-saas'
      ]
    }
  ],
  apiSidebar: [
    {
      type: 'doc',
      id: 'api/overview',
      label: 'API Overview'
    },
    {
      type: 'category',
      label: 'Core Packages',
      collapsed: false,
      items: [
        {
          type: 'category',
          label: '@kysera/core',
          collapsed: false,
          items: ['api/core', 'api/core/errors', 'api/core/pagination', 'api/core/logger']
        },
        {
          type: 'doc',
          id: 'api/executor',
          label: '@kysera/executor'
        },
        {
          type: 'category',
          label: '@kysera/repository',
          collapsed: false,
          items: [
            'api/repository',
            'api/repository/factory',
            'api/repository/validation',
            'api/repository/operators',
            'api/repository/types'
          ]
        },
        {
          type: 'doc',
          id: 'api/dal',
          label: '@kysera/dal'
        }
      ]
    },
    {
      type: 'category',
      label: 'Infrastructure',
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'api/infra',
          label: '@kysera/infra'
        },
        {
          type: 'doc',
          id: 'api/dialects',
          label: '@kysera/dialects'
        },
        {
          type: 'doc',
          id: 'api/debug',
          label: '@kysera/debug'
        },
        {
          type: 'doc',
          id: 'api/testing',
          label: '@kysera/testing'
        },
        {
          type: 'doc',
          id: 'api/migrations',
          label: '@kysera/migrations'
        }
      ]
    },
    {
      type: 'category',
      label: 'Plugins',
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'api/soft-delete',
          label: '@kysera/soft-delete'
        },
        {
          type: 'doc',
          id: 'api/timestamps',
          label: '@kysera/timestamps'
        },
        {
          type: 'doc',
          id: 'api/audit',
          label: '@kysera/audit'
        },
        {
          type: 'doc',
          id: 'api/rls',
          label: '@kysera/rls'
        }
      ]
    }
  ],
  cliSidebar: [
    {
      type: 'doc',
      id: 'cli/overview',
      label: 'CLI Overview'
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
        'cli/schema',
        'cli/health',
        'cli/test',
        'cli/debug',
        'cli/query',
        'cli/repository',
        'cli/plugin',
        'cli/audit'
      ]
    },
    {
      type: 'doc',
      id: 'cli/configuration',
      label: 'Configuration'
    }
  ]
}

export default sidebars
