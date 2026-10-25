import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AstroCookies } from 'astro';
import {
  PRODUCTS_DIR, UPLOADS_DIR, MODELS_DIR, deleteProduct, findByMisuraId, getAnyProduct, getProduct, isDraft,
  listAllProducts, listProducts, saveProduct, type Product,
} from './catalog';
import { saveProductFromForm } from './admin-ops';
import { GET } from '../pages/media/[...path]';
import { createSession } from './auth';
import { writeUsers, type AdminUser } from './users';
// @ts-expect-error plain .mjs helper without types
import { publicProductIds } from '../../scripts/lib/public-ids.mjs';

const mk = (slug: string, over: Partial<Product> = {}): Product => ({
  slug, title: slug, price: 50, size: 'M', category: 'Altro', available: true, quantity: 1, featured: false, order: 1,
  description: '', details: { misure: [], materiale: [], stato: null, anni: null },
  images: [{ id: 'aaaaaaaaaaaa', w: 800, h: 1000 }],
  model3d: { front: 0, back: null, tolerance: 22, disabled: true, version: null, hasBack: false },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});
const DRAFT = { source: 'misura' as const, misuraId: 'm-1', createdBy: 'anna', createdAt: '2026-02-01T00:00:00.000Z' };

beforeAll(() => { process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-0123456789'; });
beforeEach(() => {
  for (const f of [PRODUCTS_DIR, join(UPLOADS_DIR, 'products'), MODELS_DIR]) { rmSync(f, { recursive: true, force: true }); mkdirSync(f, { recursive: true }); }
  saveProduct(mk('giacca'));
  saveProduct(mk('bozza-x', { draft: DRAFT, available: true }));
});

describe('draft visibility', () => {
  it('hides drafts from the public functions', () => {
    expect(listProducts().map((p) => p.slug)).toEqual(['giacca']);
    expect(getProduct('bozza-x')).toBeUndefined();
    expect(getProduct('giacca')).toBeDefined();
  });
  it('keeps drafts for the admin functions', () => {
    expect(listAllProducts().map((p) => p.slug).sort()).toEqual(['bozza-x', 'giacca']);
    expect(getAnyProduct('bozza-x')?.draft?.misuraId).toBe('m-1');
    expect(isDraft(getAnyProduct('bozza-x')!)).toBe(true);
    expect(isDraft(getAnyProduct('giacca')!)).toBe(false);
  });
  it('finds a product by Misura id (draft or published origin)', () => {
    expect(findByMisuraId('m-1')?.slug).toBe('bozza-x');
    saveProduct(mk('pubblicato', { origin: { source: 'misura', misuraId: 'm-2', confirmed: { madeIn: true, composition: true } } }));
    expect(findByMisuraId('m-2')?.slug).toBe('pubblicato');
    expect(findByMisuraId('nope')).toBeUndefined();
  });
});

describe('media route', () => {
  const photo = (area: 'uploads/products' | '3d', slug: string) => {
    const root = area === '3d' ? MODELS_DIR : join(UPLOADS_DIR, 'products');
    mkdirSync(join(root, slug), { recursive: true });
    writeFileSync(join(root, slug, 'aaaaaaaaaaaa-480.webp'), 'x');
  };
  const call = (path: string, cookie?: string) => GET({
    params: { path }, url: new URL(`http://x/media/${path}`),
    cookies: { get: (k: string) => (k === 'lq_admin' && cookie ? { value: cookie } : undefined) } as unknown as AstroCookies,
  } as never) as Promise<Response>;

  it('404s a draft photo without a session, serves a published one publicly cached', async () => {
    photo('uploads/products', 'bozza-x'); photo('uploads/products', 'giacca'); photo('3d', 'bozza-x');
    expect((await call('uploads/products/bozza-x/aaaaaaaaaaaa-480.webp')).status).toBe(404);
    expect((await call('3d/bozza-x/aaaaaaaaaaaa-480.webp')).status).toBe(404);
    // traversal and case tricks must not reach a draft either
    expect((await call('uploads/products/giacca/../bozza-x/aaaaaaaaaaaa-480.webp')).status).toBe(404);
    expect((await call('uploads/products/BOZZA-X/aaaaaaaaaaaa-480.webp')).status).toBe(404);
    const ok = await call('uploads/products/giacca/aaaaaaaaaaaa-480.webp');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toContain('public');
  });
  it('lets a logged-in admin see a draft photo, never cached', async () => {
    const u: AdminUser = {
      user: 'anna', role: 'proprietario', passwordHash: 'x', totpSecret: 'JBSWY3DPEHPK3PXP', lastTotpStep: 0, sessionVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    writeUsers([u]);
    let value = '';
    createSession({ set: (_k: string, v: string) => { value = v; } } as unknown as AstroCookies, u);
    photo('uploads/products', 'bozza-x');
    const res = await call('uploads/products/bozza-x/aaaaaaaaaaaa-480.webp', value);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

describe('saveProductFromForm', () => {
  it('keeps draft and origin of the existing product', async () => {
    const origin = { source: 'misura' as const, misuraId: 'm-1', confirmed: { madeIn: false, composition: true } };
    saveProduct(mk('bozza-y', { draft: DRAFT, origin }));
    const f = new FormData();
    f.set('slug', 'bozza-y'); f.set('title', 'Nuovo titolo'); f.set('price', '60'); f.set('category', 'Altro');
    f.set('order', JSON.stringify(['id:aaaaaaaaaaaa'])); f.set('disable3d', 'on');
    const { product } = await saveProductFromForm(f);
    expect(product.title).toBe('Nuovo titolo');
    expect(product.draft).toEqual(DRAFT);
    expect(product.origin).toEqual(origin);
    expect(getAnyProduct('bozza-y')?.draft).toEqual(DRAFT);
  });
});

describe('static export list', () => {
  it('publicProductIds skips drafts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lq-ids-'));
    mkdirSync(join(dir, 'products'));
    writeFileSync(join(dir, 'products', 'a.json'), JSON.stringify(mk('a')));
    writeFileSync(join(dir, 'products', 'b.json'), JSON.stringify(mk('b', { draft: DRAFT })));
    expect(publicProductIds(dir)).toEqual(['a']);
    expect(publicProductIds(join(dir, 'missing'))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
