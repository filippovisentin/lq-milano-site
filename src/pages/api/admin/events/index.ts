import type { APIRoute } from 'astro';
import { saveEventFromForm, InputError } from '../../../../lib/admin-ops';

export const prerender = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const POST: APIRoute = async ({ request }) => {
  try {
    const ev = await saveEventFromForm(await request.formData());
    return json({ ok: true, slug: ev.slug });
  } catch (e) {
    if (e instanceof InputError) return json({ ok: false, error: e.message }, 400);
    console.error(e);
    return json({ ok: false, error: 'Errore imprevisto durante il salvataggio. Riprova.' }, 500);
  }
};
