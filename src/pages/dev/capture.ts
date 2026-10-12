// Dev-only: the review page POSTs its canvas here so review captures land in
// showcase-3d/<id>/captures/ for the img2threejs gates. 404 in production.
import type { APIRoute } from 'astro';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../../lib/root';

export const prerender = false;
export const POST: APIRoute = async ({ request }) => {
  if (!import.meta.env.DEV) return new Response(null, { status: 404 });
  const { id, name, png } = await request.json();
  if (!/^[a-z0-9-]+$/.test(id) || !/^[a-z0-9-]+$/.test(name)) return new Response('bad name', { status: 400 });
  const dir = join(PROJECT_ROOT, 'showcase-3d', id, 'captures');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(String(png).split(',')[1], 'base64'));
  return new Response('ok');
};
