import type { APIRoute } from 'astro';
import { clearFailures, clearPending, createSession, noteFailure, readPending, safeNext, tooManyAttempts } from '../../../lib/auth';
import { audit } from '../../../lib/audit';
import { getUser, setLastTotpStep } from '../../../lib/users';
import { verifyTotp } from '../../../lib/totp';

export const prerender = false;
// Step 2: 6-digit code. Verify and store the used step in one synchronous block
// (no await between them) so the same code cannot win twice.
export const POST: APIRoute = async ({ request, cookies, clientAddress, redirect, url }) => {
  const ip = clientAddress ?? 'local';
  const form = await request.formData();
  const next = safeNext(form.get('next'));
  const back = `next=${encodeURIComponent(next)}`;

  const pending = readPending(cookies);
  if (!pending) return redirect(`/admin/login?e=expired&${back}`, 303);
  const userKey = `user:${pending.user}`;
  if (tooManyAttempts(ip) || tooManyAttempts(userKey)) return redirect(`/admin/login/codice?e=wait&${back}`, 303);

  let user;
  try { user = getUser(pending.user); } catch (err) {
    console.error('login-code: elenco utenti non leggibile', err);
  }
  if (!user) {
    clearPending(cookies);
    return redirect(`/admin/login?e=expired&${back}`, 303);
  }

  const code = String(form.get('code') ?? '').replace(/\s+/g, '');
  const step = verifyTotp(user.totpSecret, code, user.lastTotpStep);
  if (step === null) {
    noteFailure(ip);
    noteFailure(userKey);
    audit('login_fail', { user: user.user, ip, step: 'code' });
    return redirect(`/admin/login/codice?e=1&${back}`, 303);
  }
  setLastTotpStep(user.user, step);
  createSession(cookies, user, url.protocol === 'https:');
  clearPending(cookies);
  clearFailures(ip);
  clearFailures(userKey);
  audit('login', { user: user.user, ip });
  return redirect(next, 303);
};
