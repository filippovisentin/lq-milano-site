import type { APIRoute } from 'astro';
import { deleteEvent, getEvent } from '../../../../lib/catalog';

export const prerender = false;
export const DELETE: APIRoute = ({ params }) => {
  const slug = decodeURIComponent(params.slug ?? '');
  if (!getEvent(slug)) return new Response(JSON.stringify({ ok: false, error: 'Evento non trovato.' }), { status: 404 });
  deleteEvent(slug);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
};
