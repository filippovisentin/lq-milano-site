// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { fileURLToPath } from 'node:url';

// Absolute project root, so build-time file checks (public/3d) work no matter
// which directory the dev server / build is launched from.
const ROOT = fileURLToPath(new URL('.', import.meta.url));
process.env.LQ_PROJECT_ROOT = ROOT;

// GitHub Pages snapshot (scripts/export-static.mjs): the site lives under a
// sub-path such as /lq-milano-site, so assets and chunks get that base.
const PAGES_BASE = process.env.PAGES_BASE || undefined;

// https://astro.build/config
export default defineConfig({
  site: process.env.PAGES_SITE || 'https://www.lqmilano.it',
  base: PAGES_BASE,
  // Wix URLs have no trailing slash; keep them identical.
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  // Static pages are prerendered; shop, products, events, media and the admin
  // panel run on demand on the Node server (they read the live catalogue).
  adapter: node({ mode: 'standalone' }),
  security: {
    checkOrigin: true,
    // In GitHub Codespaces the site sits behind the *.app.github.dev proxy:
    // trust its forwarded host so login and admin forms pass the origin check.
    allowedDomains: process.env.CODESPACES ? [{ protocol: 'https', hostname: '*.app.github.dev' }] : [],
  },
  image: {
    responsiveStyles: false,
  },
  devToolbar: { enabled: false },
});
