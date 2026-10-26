import type { APIRoute } from 'astro';
import { checkLogin, createSession, tooManyAttempts, noteFailure, clearFailures, secureCookies } from '../../../lib/auth';
import { BodyTooLarge, readSmallForm } from '../../../lib/request-limits';

export const prerender = false;
// Open route: the limiter runs before the body is read, and the body is capped.
export const POST: APIRoute = async ({ request, cookies, clientAddress, redirect, url }) => {
  const ip = clientAddress ?? 'local';
  if (tooManyAttempts(ip)) return redirect('/admin/login?e=wait', 303);
  let form: FormData;
  try { form = await readSmallForm(request); } catch (e) {
    if (e instanceof BodyTooLarge) return new Response('Richiesta troppo grande.', { status: 413 });
    return redirect('/admin/login?e=1', 303);
  }
  const next = String(form.get('next') ?? '/admin');
  const safeNext = next.startsWith('/admin') ? next : '/admin';
  const ok = checkLogin(String(form.get('user') ?? ''), String(form.get('password') ?? '').slice(0, 1024));
  if (!ok) { noteFailure(ip); return redirect(`/admin/login?e=1&next=${encodeURIComponent(safeNext)}`, 303); }
  clearFailures(ip);
  createSession(cookies, String(form.get('user')), secureCookies(url));
  return redirect(safeNext, 303);
};
