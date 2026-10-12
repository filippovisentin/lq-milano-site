import { defineMiddleware } from 'astro:middleware';
import { readSession } from './lib/auth';

// Everything under /admin and /api/admin requires the owner session, except
// the login page and login endpoint. State-changing requests must also come
// from this origin (CSRF guard on top of the SameSite=Strict cookie).
export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname;
  const isAdmin = path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/');
  if (!isAdmin) return next();

  if (ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') {
    const origin = ctx.request.headers.get('origin');
    if (origin && origin !== ctx.url.origin) return new Response('Origine non valida', { status: 403 });
  }
  const open = path === '/admin/login' || path === '/api/admin/login';
  const session = readSession(ctx.cookies);
  ctx.locals.admin = session;
  if (!open && !session) {
    if (path.startsWith('/api/')) return new Response(JSON.stringify({ error: 'Sessione scaduta: accedi di nuovo.' }), { status: 401, headers: { 'content-type': 'application/json' } });
    return ctx.redirect(`/admin/login?next=${encodeURIComponent(path)}`);
  }
  const res = await next();
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('X-Robots-Tag', 'noindex');
  return res;
});
