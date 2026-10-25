import type { APIRoute } from 'astro';
import { deleteProduct, getAnyProduct } from '../../../../lib/catalog';

export const prerender = false;
export const DELETE: APIRoute = ({ params }) => {
  const slug = decodeURIComponent(params.slug ?? '');
  if (!getAnyProduct(slug)) return new Response(JSON.stringify({ ok: false, error: 'Prodotto non trovato.' }), { status: 404 });
  deleteProduct(slug);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
};
