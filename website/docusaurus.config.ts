import { themes as prismThemes } from 'prism-react-renderer'
import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'

const config: Config = {
  title: 'Kysera',
  tagline: 'Type-safe data access toolkit for TypeScript built on Kysely',
  favicon: 'img/favicon.ico',

  future: {
    v4: true
  },

  url: 'https://kysera.dev',
  baseUrl: '/',

  organizationName: 'kysera-dev',
  projectName: 'kysera',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn'
    }
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en']
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/kysera-dev/kysera/tree/main/website/',
          showLastUpdateTime: true
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css'
        }
      } satisfies Preset.Options
    ]
  ],

  themes: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        language: ['en'],
        indexDocs: true,
        indexBlog: false,
        indexPages: false,
        docsRouteBasePath: '/docs',
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true
      }
    ]
  ],

  themeConfig: {
    image: 'img/logo.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true
    },
    navbar: {
      title: 'Kysera',
      logo: {
        alt: 'Kysera Logo',
        src: 'img/logo.png'
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs'
        },
        {
          type: 'docSidebar',
          sidebarId: 'apiSidebar',
          position: 'left',
          label: 'API Reference'
        },
        {
          type: 'docSidebar',
          sidebarId: 'cliSidebar',
          position: 'left',
          label: 'CLI'
        },
        {
          href: 'https://github.com/kysera-dev/kysera',
          label: 'GitHub',
          position: 'right'
        }
      ]
    },
    footer: {
      links: [
        {
          title: 'Learn',
          items: [
            {
              label: 'Introduction',
              to: '/docs/introduction'
            },
            {
              label: 'Getting Started',
              to: '/docs/getting-started'
            },
            {
              label: 'Core Concepts',
              to: '/docs/core-concepts/overview'
            },
            {
              label: 'Architecture',
              to: '/docs/core-concepts/architecture'
            }
          ]
        },
        {
          title: 'Guides',
          items: [
            {
              label: 'Best Practices',
              to: '/docs/guides/best-practices'
            },
            {
              label: 'Testing',
              to: '/docs/guides/testing'
            },
            {
              label: 'Migrations',
              to: '/docs/guides/migrations'
            },
            {
              label: 'DAL vs Repository',
              to: '/docs/guides/dal-vs-repository'
            },
            {
              label: 'Troubleshooting',
              to: '/docs/guides/troubleshooting'
            }
          ]
        },
        {
          title: 'API Reference',
          items: [
            {
              label: '@kysera/core',
              to: '/docs/api/core'
            },
            {
              label: '@kysera/executor',
              to: '/docs/api/executor'
            },
            {
              label: '@kysera/repository',
              to: '/docs/api/repository'
            },
            {
              label: '@kysera/dal',
              to: '/docs/api/dal'
            },
            {
              label: 'All Packages',
              to: '/docs/api/overview'
            }
          ]
        },
        {
          title: 'Plugins',
          items: [
            {
              label: 'Overview',
              to: '/docs/plugins/overview'
            },
            {
              label: 'Soft Delete',
              to: '/docs/plugins/soft-delete'
            },
            {
              label: 'Timestamps',
              to: '/docs/plugins/timestamps'
            },
            {
              label: 'Audit',
              to: '/docs/plugins/audit'
            },
            {
              label: 'RLS',
              to: '/docs/plugins/rls'
            }
          ]
        },
        {
          title: 'Tools',
          items: [
            {
              label: 'CLI Overview',
              to: '/docs/cli/overview'
            },
            {
              label: 'Examples',
              to: '/docs/examples/overview'
            },
            {
              label: 'Migration v0.7 → v0.8',
              to: '/docs/guides/migration-v08'
            }
          ]
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/kysera-dev/kysera'
            },
            {
              label: 'Issues',
              href: 'https://github.com/kysera-dev/kysera/issues'
            },
            {
              label: 'Discussions',
              href: 'https://github.com/kysera-dev/kysera/discussions'
            },
            {
              label: 'Kysely',
              href: 'https://kysely.dev'
            },
            {
              label: 'npm',
              href: 'https://www.npmjs.com/org/kysera'
            }
          ]
        }
      ],
      copyright: `Copyright ${new Date().getFullYear()} Kysera. Built with Docusaurus.`
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'typescript', 'json', 'sql']
    }
  } satisfies Preset.ThemeConfig
}

export default config
