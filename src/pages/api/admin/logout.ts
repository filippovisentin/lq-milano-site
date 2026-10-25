import type { APIRoute } from 'astro';
import { clearPending, clearSession } from '../../../lib/auth';
import { audit } from '../../../lib/audit';
import { bumpSessionVersion } from '../../../lib/users';

export const prerender = false;
// all=1 revokes every session of this user (sessionVersion + 1), on every device.
export const POST: APIRoute = async ({ request, cookies, redirect, locals, clientAddress }) => {
  const admin = locals.admin;
  const form = await request.formData().catch(() => null);
  const everywhere = form?.get('all') === '1';
  const ip = clientAddress ?? 'local';
  if (admin && everywhere) {
    bumpSessionVersion(admin.user);
    audit('logout_all', { user: admin.user, ip });
  } else if (admin) {
    audit('logout', { user: admin.user, ip });
  }
  clearSession(cookies);
  clearPending(cookies);
  return redirect('/admin/login?out=1', 303);
};
