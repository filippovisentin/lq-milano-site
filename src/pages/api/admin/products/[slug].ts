import type { APIRoute } from 'astro';
import { deleteProduct, getAnyProduct } from '../../../../lib/catalog';
import { can } from '../../../../lib/permissions';
import { audit } from '../../../../lib/audit';

export const prerender = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const DELETE: APIRoute = ({ params, locals }) => {
  if (!locals.admin) return json({ ok: false, error: 'Accesso richiesto.' }, 401);
  if (!can(locals.admin, 'catalogo')) return json({ ok: false, error: 'Non hai il permesso di modificare il catalogo.' }, 403);
  const slug = params.slug ?? ''; // already decoded by the router
  if (!getAnyProduct(slug)) return json({ ok: false, error: 'Prodotto non trovato.' }, 404);
  deleteProduct(slug);
  audit('product_delete', { user: locals.admin.user, slug });
  return json({ ok: true });
};
