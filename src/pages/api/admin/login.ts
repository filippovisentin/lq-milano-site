import type { APIRoute } from 'astro';
import { checkPassword, createPending, noteFailure, safeNext, secureCookies, tooManyAttempts } from '../../../lib/auth';
import { audit } from '../../../lib/audit';
import { BodyTooLarge, readSmallForm } from '../../../lib/request-limits';

export const prerender = false;
// Step 1: password. Success only sets the short-lived "pending" cookie;
// the session is issued by login-code after the 6-digit code.
// Open route: the limiter runs before the body is read, and the body is capped.
export const POST: APIRoute = async ({ request, cookies, clientAddress, redirect, url }) => {
  const ip = clientAddress ?? 'local';
  if (tooManyAttempts(ip)) return redirect('/admin/login?e=wait', 303);
  let form: FormData;
  try { form = await readSmallForm(request); } catch (e) {
    if (e instanceof BodyTooLarge) return new Response('Richiesta troppo grande.', { status: 413 });
    return redirect('/admin/login?e=1', 303);
  }
  const next = safeNext(form.get('next'));
  const user = String(form.get('user') ?? '').slice(0, 64);
  const found = checkPassword(user, String(form.get('password') ?? '').slice(0, 1024));
  if (!found) {
    noteFailure(ip);
    audit('login_fail', { user, ip, step: 'password' });
    return redirect(`/admin/login?e=1&next=${encodeURIComponent(next)}`, 303);
  }
  createPending(cookies, found.user, secureCookies(url));
  return redirect(`/admin/login/codice?next=${encodeURIComponent(next)}`, 303);
};
