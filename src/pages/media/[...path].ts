// Serves runtime media (uploaded photos, generated 3D assets) from data/.
import type { APIRoute } from 'astro';
import { createReadStream, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { Readable } from 'node:stream';
import { UPLOADS_DIR, MODELS_DIR } from '../../lib/catalog';

export const prerender = false;
const TYPES: Record<string, string> = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

export const GET: APIRoute = ({ params, url }) => {
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
  // upload names are random ids (immutable); 3D files are versioned with ?v=
  const immutable = parts[0] === 'uploads' || url.searchParams.has('v');
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(st.size),
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
