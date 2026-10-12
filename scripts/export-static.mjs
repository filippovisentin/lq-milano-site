// Static snapshot of the public site for GitHub Pages (no Node server there).
//   PAGES_BASE=/lq-milano-site npm run build && PAGES_BASE=/lq-milano-site node scripts/export-static.mjs
// Starts the built server, crawls every public page from the home plus every
// product and event in data/, saves the HTML, copies the static assets and the
// media in data/ next to it, and prefixes root links with the base path.
// The admin panel and its API are left out: on Pages the catalogue is frozen
// at the moment of the export (re-run it to publish new products).
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = (process.env.PAGES_BASE ?? '').replace(/\/$/, '');
const OUT = join(ROOT, process.env.PAGES_OUT ?? 'pages-dist');
const PORT = 4399;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: 'ignore',
});
const stop = () => server.kill();
process.on('exit', stop);

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${ORIGIN}${BASE}/`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Il server non risponde');
}

const SKIP = /^\/(admin|api)(\/|$)/;
const isPage = (p) => !SKIP.test(p) && !/^\/(_astro|media|img)\//.test(p) && !/\.[a-z0-9]{2,5}$/i.test(p);
const strip = (p) => (BASE && (p === BASE || p.startsWith(`${BASE}/`)) ? p.slice(BASE.length) || '/' : p);

// links in attributes, srcset and inline JSON
function linksIn(html) {
  const out = new Set();
  for (const m of html.matchAll(/(?:href|src|action)=["'](\/[^"'#?]*)/g)) out.add(m[1]);
  return [...out].map(strip);
}

// root-relative URL -> base-prefixed, for the first path segments we publish
let SEGMENTS = [];
function rewrite(html) {
  if (!BASE) return html;
  const seg = SEGMENTS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(["'(=,\\s]|&quot;)/(?=(?:${seg})(?:[/?#"'&)\\s,]|$))`, 'g');
  return html
    .replace(re, `$1${BASE}/`)
    .replace(/((?:href|action)=["'])\/(["'#?])/g, `$1${BASE}/$2`);
}

// files on disk use the decoded name (Pages decodes %C3%A7 -> ç)
const fileFor = (p) => (p === '/' ? join(OUT, 'index.html') : join(OUT, decodeURIComponent(p).replace(/^\//, ''), 'index.html'));

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  await waitReady();

  const ids = (dir) => readdirSync(join(ROOT, 'data', dir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  // seeds: home, every prerendered page (some, like /checkout, are only reached
  // from scripts), every product and event
  const prerendered = readdirSync(join(ROOT, 'dist', 'client'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(ROOT, 'dist', 'client', d.name, 'index.html')))
    .map((d) => `/${d.name}`);
  const queue = ['/', ...prerendered,
    ...ids('products').map((s) => `/product-page/${encodeURIComponent(s)}`),
    ...ids('events').map((s) => `/event-details/${encodeURIComponent(s)}`)];
  const seen = new Set(queue);
  const pages = new Map();
  while (queue.length) {
    const p = queue.shift();
    const res = await fetch(`${ORIGIN}${BASE}${p}`, { redirect: 'manual' });
    if (res.status !== 200) { console.warn(`  salto ${p} (${res.status})`); continue; }
    const html = await res.text();
    pages.set(p, html);
    for (const l of linksIn(html)) {
      const clean = l.replace(/\/$/, '') || '/';
      if (isPage(clean) && !seen.has(clean)) { seen.add(clean); queue.push(clean); }
    }
  }
  const notFound = await (await fetch(`${ORIGIN}${BASE}/pagina-che-non-esiste`)).text();

  // assets: built client files + media from data/
  cpSync(join(ROOT, 'dist', 'client'), OUT, { recursive: true });
  // the 2400px masters only feed the 3D builder: pages use the renditions
  cpSync(join(ROOT, 'data', 'uploads'), join(OUT, 'media', 'uploads'), {
    recursive: true, filter: (src) => !/[\\/][0-9a-f]{12}\.webp$/.test(src),
  });
  cpSync(join(ROOT, 'data', '3d'), join(OUT, 'media', '3d'), { recursive: true });

  SEGMENTS = [...new Set([
    ...readdirSync(OUT),
    ...[...pages.keys()].map((p) => p.split('/')[1]).filter(Boolean),
  ])].filter((s) => s !== 'index.html');

  for (const [p, html] of pages) {
    const f = fileFor(p);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, rewrite(html));
  }
  writeFileSync(join(OUT, '404.html'), rewrite(notFound));
  writeFileSync(join(OUT, '.nojekyll'), '');
  console.log(`Esportate ${pages.size} pagine in ${OUT} (base "${BASE || '/'}")`);
}

main().then(() => { stop(); process.exit(0); }, (e) => { console.error(e); stop(); process.exit(1); });
