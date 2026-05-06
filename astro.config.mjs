import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://article1.news',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'directory',
  },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/404'),
    }),
  ],
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
