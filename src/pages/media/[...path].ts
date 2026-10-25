// Serves runtime media (uploaded photos, generated 3D assets) from data/.
import type { APIRoute } from 'astro';
import { createReadStream, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { Readable } from 'node:stream';
import { readSession } from '../../lib/auth';
import { UPLOADS_DIR, MODELS_DIR, listAllProducts, isDraft } from '../../lib/catalog';

export const prerender = false;
const TYPES: Record<string, string> = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

export const GET: APIRoute = ({ params, url, cookies }) => {
  const parts = (params.path ?? '').split('/');
  const root = parts[0] === 'uploads' ? UPLOADS_DIR : parts[0] === '3d' ? MODELS_DIR : null;
  if (!root) return new Response('Not found', { status: 404 });
  const file = resolve(root, ...parts.slice(1).map(decodeURIComponent));
  if (!file.startsWith(root + sep)) return new Response('Not found', { status: 404 });
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) return new Response('Not found', { status: 404 });
  let st;
  try { st = statSync(file); } catch { return new Response('Not found', { status: 404 }); }
  if (!st.isFile()) return new Response('Not found', { status: 404 });
  // a draft's photos and 3D files are private: admins only, never cached
  // (slug taken from the resolved path, compared case-insensitively: no ../ or case tricks)
  const rel = file.slice(root.length + 1).split(sep);
  const slug = parts[0] === 'uploads' ? (rel[0].toLowerCase() === 'products' ? rel[1] : undefined) : rel[0];
  const draft = !!slug && listAllProducts().some((p) => isDraft(p) && p.slug.toLowerCase() === slug.toLowerCase());
  if (draft && !readSession(cookies)) return new Response('Not found', { status: 404 });
  // upload names are random ids (immutable); 3D files are versioned with ?v=
  const immutable = parts[0] === 'uploads' || url.searchParams.has('v');
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(st.size),
      'Cache-Control': draft ? 'private, no-store' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
