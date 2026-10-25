import type { APIRoute } from 'astro';
import { InputError } from '../../../../lib/admin-ops';
import { saveMisuraItem } from '../../../../lib/misura-item';
import { productUrl } from '../../../../lib/catalog';
import { can } from '../../../../lib/permissions';
import { audit } from '../../../../lib/audit';

export const prerender = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.admin) return json({ ok: false, error: 'Accesso richiesto.' }, 401);
  if (!can(locals.admin, 'misura')) return json({ ok: false, error: 'Non hai il permesso di usare Misura.' }, 403);
  try {
    const form = await request.formData();
    const { slug, published } = await saveMisuraItem(form, locals.admin.user);
    audit('misura_item', { user: locals.admin.user, slug, action: published ? 'publish' : 'draft' });
    return json({ ok: true, slug, published, url: published ? productUrl(slug) : `/admin/prodotti/${encodeURIComponent(slug)}` });
  } catch (e) {
    if (e instanceof InputError) return json({ ok: false, error: e.message, ...(e.blockers ? { blockers: e.blockers } : {}) }, 400);
    console.error('misura/item:', e);
    return json({ ok: false, error: 'Errore imprevisto durante il salvataggio. Riprova.' }, 500);
  }
};
