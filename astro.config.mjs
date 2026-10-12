// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

// Absolute project root, so build-time file checks (public/3d) work no matter
// which directory the dev server / build is launched from.
const ROOT = fileURLToPath(new URL('.', import.meta.url));
process.env.LQ_PROJECT_ROOT = ROOT;

// https://astro.build/config
export default defineConfig({
  site: 'https://www.lqmilano.it',
  // Wix URLs have no trailing slash; keep them identical.
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  image: {
    responsiveStyles: false,
  },
  devToolbar: { enabled: false },
});
