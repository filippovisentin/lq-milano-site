import type { APIRoute } from 'astro';
import { checkLogin, createSession, tooManyAttempts, noteFailure, clearFailures } from '../../../lib/auth';

export const prerender = false;
export const POST: APIRoute = async ({ request, cookies, clientAddress, redirect, url }) => {
  const ip = clientAddress ?? 'local';
  const form = await request.formData();
  const next = String(form.get('next') ?? '/admin');
  const safeNext = next.startsWith('/admin') ? next : '/admin';
  if (tooManyAttempts(ip)) return redirect('/admin/login?e=wait', 303);
  const ok = checkLogin(String(form.get('user') ?? ''), String(form.get('password') ?? ''));
  if (!ok) { noteFailure(ip); return redirect(`/admin/login?e=1&next=${encodeURIComponent(safeNext)}`, 303); }
  clearFailures(ip);
  createSession(cookies, String(form.get('user')), url.protocol === 'https:');
  return redirect(safeNext, 303);
};
