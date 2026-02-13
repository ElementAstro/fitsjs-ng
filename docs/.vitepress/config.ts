import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'TypeScript Quick Starter',
  description: 'A TypeScript library quick starter template',

  base: '/typescript-quick-starter/',

  lastUpdated: true,
  cleanUrls: true,

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Installation', link: '/guide/installation' },
          ],
        },
        {
          text: 'Development',
          items: [
            { text: 'Project Structure', link: '/guide/project-structure' },
            { text: 'Building', link: '/guide/building' },
            { text: 'Testing', link: '/guide/testing' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [{ text: 'Overview', link: '/api/' }],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/your-username/typescript-quick-starter' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026',
    },

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/your-username/typescript-quick-starter/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
