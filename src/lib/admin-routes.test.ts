// Route-level checks for the hardened admin endpoints: permission, audit trail,
// and the capped, limiter-first login body.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AstroCookies } from 'astro';
import { EVENTS_DIR, PRODUCTS_DIR, getAnyProduct, getEvent, saveEvent, saveProduct, type Product } from './catalog';
import { AUDIT_FILE } from './audit';
import { noteFailure, tooManyAttempts } from './auth';
import { USERS_FILE, writeUsers } from './users';
import { DELETE as deleteProductRoute } from '../pages/api/admin/products/[slug]';
import { POST as saveProductRoute } from '../pages/api/admin/products/index';
import { DELETE as deleteEventRoute } from '../pages/api/admin/events/[slug]';
import { POST as saveEventRoute } from '../pages/api/admin/events/index';
import { POST as loginRoute } from '../pages/api/admin/login';

const mkProduct = (slug: string): Product => ({
  slug, title: slug, price: 50, size: 'M', category: 'Altro', available: true, quantity: 1, featured: false, order: 1,
  description: '', details: { misure: [], materiale: [], stato: null, anni: null },
  images: [], model3d: { front: 0, back: null, tolerance: 22, disabled: true, version: null, hasBack: false },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});
const OWNER = { user: 'anna', role: 'proprietario' as const };
const ctx = (over: Record<string, unknown>) => ({ locals: {}, params: {}, request: new Request('http://x/api/admin', { method: 'POST' }), ...over }) as never;
const auditLines = () => (existsSync(AUDIT_FILE) ? readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

beforeAll(() => { process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-0123456789'; });
beforeEach(() => {
  for (const d of [PRODUCTS_DIR, EVENTS_DIR]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }
  rmSync(AUDIT_FILE, { force: true });
  saveProduct(mkProduct('giacca'));
});

describe('products and events routes', () => {
  it('reject a request without an admin session (401) or with an unknown role (403)', async () => {
    const r401 = await deleteProductRoute(ctx({ params: { slug: 'giacca' } }));
    expect(r401.status).toBe(401);
    const r403 = await deleteProductRoute(ctx({ params: { slug: 'giacca' }, locals: { admin: { user: 'x', role: 'ospite' } } }));
    expect(r403.status).toBe(403);
    expect(getAnyProduct('giacca')).toBeTruthy();
    for (const route of [saveProductRoute, saveEventRoute]) {
      expect((await route(ctx({}))).status).toBe(401);
      expect((await route(ctx({ locals: { admin: { user: 'x', role: 'ospite' } } }))).status).toBe(403);
    }
    expect((await deleteEventRoute(ctx({ params: { slug: 'serata' } }))).status).toBe(401);
  });

  it('delete a product and record who did it', async () => {
    const res = await deleteProductRoute(ctx({ params: { slug: 'giacca' }, locals: { admin: OWNER } }));
    expect(res.status).toBe(200);
    expect(getAnyProduct('giacca')).toBeUndefined();
    expect(auditLines()).toContainEqual(expect.objectContaining({ event: 'product_delete', user: 'anna', slug: 'giacca' }));
  });

  it('delete an event and record who did it', async () => {
    saveEvent({ slug: 'serata', title: 'Serata', start: '2026-12-01T19:00', end: null, location: 'LQ', description: '', poster: null, registration: 'none', registrationUrl: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } as never);
    const res = await deleteEventRoute(ctx({ params: { slug: 'serata' }, locals: { admin: OWNER } }));
    expect(res.status).toBe(200);
    expect(getEvent('serata')).toBeUndefined();
    expect(auditLines()).toContainEqual(expect.objectContaining({ event: 'event_delete', user: 'anna', slug: 'serata' }));
  });

  it('a 404 on an unknown slug writes no audit entry', async () => {
    const res = await deleteProductRoute(ctx({ params: { slug: 'non-esiste' }, locals: { admin: OWNER } }));
    expect(res.status).toBe(404);
    expect(auditLines()).toHaveLength(0);
  });
});

describe('login route', () => {
  const login = (body: BodyInit, ip: string, headers: Record<string, string> = {}) => {
    let redirected = '';
    return loginRoute({
      request: new Request('http://x/api/admin/login', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers } }),
      cookies: { set() {}, get() { return undefined; } } as unknown as AstroCookies,
      clientAddress: ip,
      url: new URL('http://x/api/admin/login'),
      redirect: (to: string, status: number) => { redirected = to; return new Response(null, { status, headers: { location: to } }); },
    } as never).then((r: Response) => ({ r, redirected }));
  };

  it('answers 413 to an oversized body instead of buffering it', async () => {
    const { r } = await login('user=a&password=' + 'x'.repeat(64 * 1024), '10.0.0.1');
    expect(r.status).toBe(413);
  });

  it('applies the limiter before reading the body', async () => {
    while (!tooManyAttempts('10.0.0.2')) noteFailure('10.0.0.2');
    // even an oversized body is answered by the limiter, without being read
    const { r, redirected } = await login('user=a&password=' + 'x'.repeat(64 * 1024), '10.0.0.2');
    expect(r.status).toBe(303);
    expect(redirected).toBe('/admin/login?e=wait');
  });

  it('a normal wrong password is a plain failure', async () => {
    writeUsers([]);
    const { redirected } = await login('user=anna&password=sbagliata&next=%2Fadmin', '10.0.0.3');
    expect(redirected).toBe('/admin/login?e=1&next=%2Fadmin');
  });
});

describe.skipIf(process.platform === 'win32')('secret files are owner-only', () => {
  it('users.json and its directory are not readable by group or others', () => {
    const old = process.umask(0o022);
    try {
      rmSync(dirname(USERS_FILE), { recursive: true, force: true });
      writeUsers([]);
      expect(statSync(USERS_FILE).mode & 0o077).toBe(0);
      expect(statSync(dirname(USERS_FILE)).mode & 0o077).toBe(0);
    } finally { process.umask(old); }
  });
});
