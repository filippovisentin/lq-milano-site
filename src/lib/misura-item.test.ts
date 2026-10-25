import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { PRODUCTS_DIR, UPLOADS_DIR, MODELS_DIR, getAnyProduct, listAllProducts, type Product } from './catalog';
import { InputError } from './admin-ops';
import { parsePayload, publishBlockers, toProduct, saveMisuraItem, publishProduct } from './misura-item';

const ID = '3f2b8c1e-5d4a-4e7b-9c10-2a6f8d9e0b11';
const ID2 = '9a1c7e55-0b3d-4f26-8e41-7c5d2b6a9f30';
const base = (over: Record<string, unknown> = {}) => ({
  action: 'draft', misuraId: ID, title: 'Giacca di lana', price: 85, category: 'Capispalla', size: 'M',
  composition: '100% lana', madeIn: 'Italia', condition: 'Ottimo',
  description: 'Giacca vintage in lana pesante, ben conservata.',
  measures: [{ label: 'Petto', cm: 50.5 }, { label: 'Lunghezza', cm: 70 }],
  confirmed: { madeIn: true, composition: true }, ...over,
});
const payload = (over: Record<string, unknown> = {}) => parsePayload(base(over));

const jpeg = (withGps = false) => {
  let s = sharp({ create: { width: 200, height: 300, channels: 3, background: '#808080' } }).jpeg();
  if (withGps) {
    s = s.withMetadata({
      exif: {
        IFD0: { Copyright: 'x' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 28/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '9/1 11/1 0/1' },
      },
    });
  }
  return s.toBuffer();
};
const photo = async (name = 'a.jpg', gps = false) => new File([await jpeg(gps)], name, { type: 'image/jpeg' });
const form = async (p: unknown, photos?: File[]) => {
  const f = new FormData();
  f.set('payload', JSON.stringify(p));
  for (const ph of photos ?? [await photo()]) f.append('photos', ph);
  return f;
};
const files = () => readdirSync(PRODUCTS_DIR).filter((f) => f.endsWith('.json'));

beforeEach(() => {
  for (const f of [PRODUCTS_DIR, join(UPLOADS_DIR, 'products'), MODELS_DIR]) { rmSync(f, { recursive: true, force: true }); mkdirSync(f, { recursive: true }); }
});

describe('parsePayload', () => {
  it('accepts a valid payload', () => {
    const p = payload();
    expect(p.title).toBe('Giacca di lana');
    expect(p.measures).toHaveLength(2);
  });
  it.each([
    ['unknown field', { extra: 1 }, /extra/],
    ['title of 121 chars', { title: 'a'.repeat(121) }, /title/],
    ['13 measures', { measures: Array.from({ length: 13 }, (_, i) => ({ label: `m${i}`, cm: 10 })) }, /measures/],
    ['measure of 301 cm', { measures: [{ label: 'Petto', cm: 301 }] }, /measures/],
    ['price 100001', { price: 100001 }, /price/],
    ['other action', { action: 'delete' }, /action/],
    ['misuraId not a UUID', { misuraId: 'm-1' }, /misuraId/],
    ['unknown category', { category: 'Scarpe' }, /category/],
    ['unknown condition', { condition: 'Rotto' }, /condition/],
  ])('rejects %s', (_n, over, re) => {
    expect(() => parsePayload(base(over))).toThrowError(InputError);
    expect(() => parsePayload(base(over))).toThrowError(re);
  });
  it('rejects non-objects', () => {
    expect(() => parsePayload(null)).toThrowError(InputError);
    expect(() => parsePayload([])).toThrowError(InputError);
  });
});

describe('toProduct', () => {
  const imgs = [{ id: 'aaaaaaaaaaaa', w: 200, h: 300 }];
  it('builds measures with decimal comma and the footnote', () => {
    const p = toProduct(payload(), imgs, 'anna');
    expect(p.details.misure).toEqual(['Petto: 50,5 cm', 'Lunghezza: 70 cm', 'Misure indicative, capo steso in piano']);
    expect(p.model3d.disabled).toBe(true);
    expect(p.draft).toMatchObject({ source: 'misura', misuraId: ID, createdBy: 'anna' });
    expect(p.origin).toMatchObject({ source: 'misura', misuraId: ID, madeIn: 'Italia', confirmed: { madeIn: true, composition: true } });
  });
  it('adds the made-in line only when confirmed', () => {
    expect(toProduct(payload(), imgs, 'anna').details.materiale).toEqual(['100% lana', 'Indicazione in etichetta: Made in Italia']);
    const un = toProduct(payload({ confirmed: { madeIn: false, composition: true } }), imgs, 'anna');
    expect(un.details.materiale).toEqual(['100% lana']);
    expect(un.origin?.madeIn).toBe('Italia');
  });
  it('publishes: no draft, publishedBy set, old data kept', () => {
    const old = toProduct(payload(), imgs, 'anna');
    old.order = 7; old.createdAt = '2026-01-01T00:00:00.000Z';
    const pub = toProduct(payload({ action: 'publish' }), imgs, 'bea', old);
    expect(pub.draft).toBeUndefined();
    expect(pub.origin?.publishedBy).toBe('bea');
    expect(pub.slug).toBe(old.slug);
    expect(pub.order).toBe(7);
    expect(pub.createdAt).toBe(old.createdAt);
  });
});

describe('publishBlockers', () => {
  const full = (): Product => toProduct(payload({ action: 'publish' }), [{ id: 'aaaaaaaaaaaa', w: 1, h: 1 }], 'a');
  it('is empty for a complete product', () => expect(publishBlockers(full())).toEqual([]));
  const cases: [string, (p: Product) => void][] = [
    ['Manca il nome', (p) => { p.title = ' '; }],
    ['Manca il prezzo', (p) => { p.price = 0; }],
    ['Manca la categoria', (p) => { (p as any).category = ''; }],
    ['Aggiungi almeno una foto', (p) => { p.images = []; }],
    ['Scrivi una descrizione (almeno 20 caratteri)', (p) => { p.description = 'troppo corta'; }],
    ['Conferma il made in', (p) => { p.origin!.confirmed.madeIn = false; }],
    ['Conferma la composizione', (p) => { p.origin!.confirmed.composition = false; }],
  ];
  it.each(cases)('flags: %s (alone)', (msg, mutate) => {
    const p = full(); mutate(p);
    expect(publishBlockers(p)).toEqual([msg]);
  });
  it('ignores label confirmations for products without origin', () => {
    const p = full(); delete p.origin;
    expect(publishBlockers(p)).toEqual([]);
  });
  it('does not require a made-in confirmation when none was given', () => {
    const p = full(); p.origin!.madeIn = ''; p.origin!.confirmed.madeIn = false;
    expect(publishBlockers(p)).toEqual([]);
  });
});

describe('saveMisuraItem', () => {
  it('creates a draft with processed photos', async () => {
    const r = await saveMisuraItem(await form(base()), 'anna');
    expect(r.published).toBe(false);
    const p = getAnyProduct(r.slug)!;
    expect(p.draft).toBeDefined();
    expect(existsSync(join(UPLOADS_DIR, 'products', r.slug, `${p.images[0].id}.webp`))).toBe(true);
  });
  it('refuses to publish an incomplete item and writes nothing', async () => {
    const err = await saveMisuraItem(await form(base({ action: 'publish', description: 'breve' })), 'anna').catch((e) => e);
    expect(err).toBeInstanceOf(InputError);
    expect(err.blockers).toEqual(['Scrivi una descrizione (almeno 20 caratteri)']);
    expect(files()).toEqual([]);
    expect(readdirSync(join(UPLOADS_DIR, 'products'))).toEqual([]);
  });
  it('is idempotent per misuraId, even in parallel', async () => {
    await Promise.all([saveMisuraItem(await form(base()), 'anna'), saveMisuraItem(await form(base()), 'anna')]);
    expect(listAllProducts()).toHaveLength(1);
    await saveMisuraItem(await form(base({ title: 'Altro titolo' })), 'anna');
    expect(listAllProducts()).toHaveLength(1);
    await saveMisuraItem(await form(base({ misuraId: ID2 })), 'anna');
    expect(listAllProducts()).toHaveLength(2);
  });
  it('replaces old photos on update and keeps the slug', async () => {
    const a = await saveMisuraItem(await form(base()), 'anna');
    const oldId = getAnyProduct(a.slug)!.images[0].id;
    const b = await saveMisuraItem(await form(base()), 'anna');
    expect(b.slug).toBe(a.slug);
    const dir = join(UPLOADS_DIR, 'products', a.slug);
    const newId = getAnyProduct(a.slug)!.images[0].id;
    expect(newId).not.toBe(oldId);
    expect(existsSync(join(dir, `${oldId}.webp`))).toBe(false);
    expect(readdirSync(dir).filter((f) => !f.startsWith(newId))).toEqual([]);
  });
  it('draft then publish with the same misuraId', async () => {
    const a = await saveMisuraItem(await form(base()), 'anna');
    const b = await saveMisuraItem(await form(base({ action: 'publish' })), 'bea');
    expect(b).toEqual({ slug: a.slug, published: true });
    const p = getAnyProduct(a.slug)!;
    expect(p.draft).toBeUndefined();
    expect(p.origin?.publishedBy).toBe('bea');
  });
  it('rejects a non-image upload', async () => {
    const bad = new File(['not an image'], 'x.jpg', { type: 'image/jpeg' });
    await expect(saveMisuraItem(await form(base(), [bad]), 'anna')).rejects.toBeInstanceOf(InputError);
    expect(files()).toEqual([]);
  });
  it('rejects 0 and 9 photos', async () => {
    await expect(saveMisuraItem(await form(base(), []), 'anna')).rejects.toBeInstanceOf(InputError);
    const nine = await Promise.all(Array.from({ length: 9 }, (_, i) => photo(`p${i}.jpg`)));
    await expect(saveMisuraItem(await form(base(), nine), 'anna')).rejects.toBeInstanceOf(InputError);
  });
  it('rejects a missing or malformed payload', async () => {
    const f = new FormData(); f.set('payload', '{nope');
    await expect(saveMisuraItem(f, 'anna')).rejects.toBeInstanceOf(InputError);
    await expect(saveMisuraItem(new FormData(), 'anna')).rejects.toBeInstanceOf(InputError);
  });
  it('strips EXIF (GPS) from stored photos', async () => {
    const src = await photo('gps.jpg', true);
    expect((await sharp(Buffer.from(await src.arrayBuffer())).metadata()).exif).toBeDefined();
    const r = await saveMisuraItem(await form(base(), [src]), 'anna');
    const dir = join(UPLOADS_DIR, 'products', r.slug);
    const stored = readdirSync(dir);
    expect(stored.length).toBeGreaterThan(0);
    for (const f of stored) expect((await sharp(join(dir, f)).metadata()).exif).toBeUndefined();
  });
  it('keeps the photo order of the upload', async () => {
    const mk = async (c: string) => new File([await sharp({ create: { width: 100, height: 100, channels: 3, background: c } }).jpeg().toBuffer()], `${c}.jpg`, { type: 'image/jpeg' });
    const r = await saveMisuraItem(await form(base(), [await mk('#ff0000'), await mk('#0000ff')]), 'anna');
    const p = getAnyProduct(r.slug)!;
    const red = async (id: string) => (await sharp(join(UPLOADS_DIR, 'products', r.slug, `${id}.webp`)).removeAlpha().raw().toBuffer())[0];
    expect(await red(p.images[0].id)).toBeGreaterThan(200);
    expect(await red(p.images[1].id)).toBeLessThan(60);
  });
});

describe('publishProduct', () => {
  const mkDraft = async (over = {}) => (await saveMisuraItem(await form(base(over)), 'anna')).slug;
  it('publishes a complete draft', async () => {
    const slug = await mkDraft();
    const p = publishProduct(slug, 'bea', {});
    expect(p.draft).toBeUndefined();
    expect(p.origin?.publishedBy).toBe('bea');
  });
  it('blocks until label data is confirmed, then publishes with the made-in line', async () => {
    const slug = await mkDraft({ confirmed: { madeIn: false, composition: false } });
    let err: any;
    try { publishProduct(slug, 'bea', {}); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(InputError);
    expect(err.blockers).toEqual(['Conferma il made in', 'Conferma la composizione']);
    expect(getAnyProduct(slug)!.draft).toBeDefined();
    const p = publishProduct(slug, 'bea', { confirmMadeIn: true, confirmComposition: true });
    expect(p.draft).toBeUndefined();
    expect(p.origin?.confirmed).toEqual({ madeIn: true, composition: true });
    expect(p.details.materiale).toContain('Indicazione in etichetta: Made in Italia');
    expect(getAnyProduct(slug)!.draft).toBeUndefined();
  });
  it('unknown slug is an InputError', () => {
    expect(() => publishProduct('nope', 'bea', {})).toThrowError(InputError);
  });
});
