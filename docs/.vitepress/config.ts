import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'fitsjs-ng',
  description: 'TypeScript FITS/XISF/HiPS library for Node.js and browsers',

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
            { text: 'HiPS', link: '/guide/hips' },
            { text: 'SER', link: '/guide/ser' },
            { text: 'Standards Matrix', link: '/guide/standards-matrix' },
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
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'HiPS', link: '/api/hips' },
            { text: 'SER', link: '/api/ser' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/ElementAstro/fitsjs-ng' }],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026',
    },

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/ElementAstro/fitsjs-ng/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
