import type { APIRoute } from 'astro';
import { checkPassword, createPending, noteFailure, safeNext, tooManyAttempts } from '../../../lib/auth';
import { audit } from '../../../lib/audit';

export const prerender = false;
// Step 1: password. Success only sets the short-lived "pending" cookie;
// the session is issued by login-code after the 6-digit code.
export const POST: APIRoute = async ({ request, cookies, clientAddress, redirect, url }) => {
  const ip = clientAddress ?? 'local';
  const form = await request.formData();
  const next = safeNext(form.get('next'));
  const user = String(form.get('user') ?? '').slice(0, 64);
  if (tooManyAttempts(ip)) return redirect('/admin/login?e=wait', 303);
  const found = checkPassword(user, String(form.get('password') ?? ''));
  if (!found) {
    noteFailure(ip);
    audit('login_fail', { user, ip, step: 'password' });
    return redirect(`/admin/login?e=1&next=${encodeURIComponent(next)}`, 303);
  }
  createPending(cookies, found.user, url.protocol === 'https:');
  return redirect(`/admin/login/codice?next=${encodeURIComponent(next)}`, 303);
};
