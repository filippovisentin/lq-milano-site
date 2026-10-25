import type { APIRoute } from 'astro';
import { InputError } from '../../../../lib/admin-ops';
import { publishProduct } from '../../../../lib/misura-item';
import { productUrl } from '../../../../lib/catalog';
import { can } from '../../../../lib/permissions';
import { audit } from '../../../../lib/audit';

export const prerender = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flag = (f: FormData, k: string) => ['on', 'true', '1'].includes(String(f.get(k) ?? ''));

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.admin) return json({ ok: false, error: 'Accesso richiesto.' }, 401);
  if (!can(locals.admin, 'misura')) return json({ ok: false, error: 'Non hai il permesso di pubblicare.' }, 403);
  try {
    const form = await request.formData();
    const slug = String(form.get('slug') ?? '').trim().slice(0, 120);
    const confirmMadeIn = flag(form, 'confirmMadeIn');
    const confirmComposition = flag(form, 'confirmComposition');
    const p = publishProduct(slug, locals.admin.user, { confirmMadeIn, confirmComposition });
    audit('publish', { user: locals.admin.user, slug, confirmedMadeIn: confirmMadeIn, confirmedComposition: confirmComposition });
    return json({ ok: true, slug, published: true, url: productUrl(p.slug) });
  } catch (e) {
    if (e instanceof InputError) return json({ ok: false, error: e.message, ...(e.blockers ? { blockers: e.blockers } : {}) }, 400);
    console.error('products/publish:', e);
    return json({ ok: false, error: 'Errore imprevisto durante la pubblicazione. Riprova.' }, 500);
  }
};
