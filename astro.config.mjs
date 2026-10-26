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

// Behind a TLS reverse proxy Astro must trust the proxy's forwarded headers,
// otherwise the admin sees http://localhost (Origin check fails with 403, cookies
// lose Secure, every visitor shares the proxy IP in the login limiter).
// LQ_ALLOWED_DOMAINS=www.lqmilano.it,lqmilano.it at build time enables that.
// Set it only when the proxy overwrites X-Forwarded-For/-Host: Astro then uses
// the first X-Forwarded-For value as the client IP.
// In GitHub Codespaces the site sits behind the *.app.github.dev proxy.
const ALLOWED_DOMAINS = [
  ...(process.env.CODESPACES ? [{ protocol: 'https', hostname: '*.app.github.dev' }] : []),
  ...(process.env.LQ_ALLOWED_DOMAINS ?? '').split(',').map((h) => h.trim()).filter(Boolean)
    .map((hostname) => ({ protocol: 'https', hostname })),
];
const BODY_LIMIT_MB = Number(process.env.LQ_BODY_LIMIT_MB) > 0 ? Number(process.env.LQ_BODY_LIMIT_MB) : 130;

// https://astro.build/config
export default defineConfig({
  site: process.env.PAGES_SITE || 'https://www.lqmilano.it',
  base: PAGES_BASE,
  // Wix URLs have no trailing slash; keep them identical.
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  // Static pages are prerendered; shop, products, events, media and the admin
  // panel run on demand on the Node server (they read the live catalogue).
  // Whole-request cap (the adapter default is 1 GiB). Misura sends up to 8
  // photos of 15 MB; the open login routes have their own 16 KB cap.
  adapter: node({ mode: 'standalone', bodySizeLimit: BODY_LIMIT_MB * 1024 * 1024 }),
  security: {
    checkOrigin: true,
    // Hosts whose forwarded Host/Proto/For headers are trusted (read at build time).
    allowedDomains: ALLOWED_DOMAINS,
  },
  image: {
    responsiveStyles: false,
  },
  devToolbar: { enabled: false },
});
