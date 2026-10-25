// Misura -> catalogue: validation of the payload, product mapping, publishing rules.
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import sharp from 'sharp';
// shared with the CLI scripts
import { processImage } from '../../scripts/lib/images.mjs';
import {
  UPLOADS_DIR, CATEGORIES, CONDITIONS, IMAGE_WIDTHS, findByMisuraId, getAnyProduct, listAllProducts, saveProduct,
  slugify, uniqueSlug, type Product, type ProductImage,
} from './catalog';
import { InputError } from './admin-ops';

type Category = (typeof CATEGORIES)[number];
type Condition = (typeof CONDITIONS)[number];

export type MisuraPayload = {
  action: 'draft' | 'publish';
  misuraId: string;
  title: string;
  price: number;
  category: Category;
  size: string;
  composition: string;
  madeIn: string;
  condition: Condition | '';
  description: string;
  measures: { label: string; cm: number }[];
  confirmed: { madeIn: boolean; composition: boolean };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = ['action', 'misuraId', 'title', 'price', 'category', 'size', 'composition', 'madeIn', 'condition', 'description', 'measures', 'confirmed'];
const MIN_DESCRIPTION = 20;
const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_PHOTO_PIXELS = 60_000_000;
const PHOTO_FORMATS = ['jpeg', 'png', 'webp', 'heif', 'avif'];
export const MADE_IN_PREFIX = 'Indicazione in etichetta: Made in ';
export const MEASURES_NOTE = 'Misure indicative, capo steso in piano';

const bad = (field: string, why = 'non valido') => new InputError(`Campo ${field} ${why}.`);

function text(o: Record<string, unknown>, k: string, max: number): string {
  const v = o[k];
  if (typeof v !== 'string') throw bad(k, 'mancante o non testuale');
  const t = v.trim();
  if (t.length > max) throw bad(k, `troppo lungo (max ${max} caratteri)`);
  return t;
}

export function parsePayload(json: unknown): MisuraPayload {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new InputError('Dati non validi.');
  const o = json as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) throw new InputError(`Campo sconosciuto: ${k}.`);

  if (o.action !== 'draft' && o.action !== 'publish') throw bad('action');
  const misuraId = text(o, 'misuraId', 36);
  if (!UUID.test(misuraId)) throw bad('misuraId', 'non è un UUID');
  const title = text(o, 'title', 120);
  const price = o.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 100_000) throw bad('price', 'fuori intervallo (0–100000)');
  const category = text(o, 'category', 40);
  if (!(CATEGORIES as readonly string[]).includes(category)) throw bad('category');
  const condition = text(o, 'condition', 40);
  if (condition && !(CONDITIONS as readonly string[]).includes(condition)) throw bad('condition');

  const ms = o.measures;
  if (!Array.isArray(ms) || ms.length > 12) throw bad('measures', 'non valido (max 12 misure)');
  const measures = ms.map((m) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw bad('measures');
    const r = m as Record<string, unknown>;
    if (Object.keys(r).some((k) => k !== 'label' && k !== 'cm')) throw bad('measures');
    if (typeof r.label !== 'string' || !r.label.trim() || r.label.trim().length > 40) throw bad('measures', 'ha un nome non valido');
    if (typeof r.cm !== 'number' || !Number.isFinite(r.cm) || r.cm <= 0 || r.cm > 300) throw bad('measures', 'ha una misura fuori intervallo (0–300 cm)');
    return { label: r.label.trim(), cm: r.cm };
  });

  const c = o.confirmed as Record<string, unknown> | null;
  if (!c || typeof c !== 'object' || Array.isArray(c) || typeof c.madeIn !== 'boolean' || typeof c.composition !== 'boolean'
    || Object.keys(c).some((k) => k !== 'madeIn' && k !== 'composition')) throw bad('confirmed');

  return {
    action: o.action, misuraId, title, price: Math.round(price * 100) / 100, category: category as Category,
    size: text(o, 'size', 20), composition: text(o, 'composition', 300), madeIn: text(o, 'madeIn', 60),
    condition: condition as Condition | '', description: text(o, 'description', 6000), measures,
    confirmed: { madeIn: c.madeIn, composition: c.composition },
  };
}

const fmtCm = (n: number) => String(n).replace('.', ',');
const madeInLine = (madeIn: string) => `${MADE_IN_PREFIX}${madeIn}`;
const isMadeInLine = (l: string) => l.startsWith(MADE_IN_PREFIX);

// Why a product cannot go live yet (empty = publishable).
export function publishBlockers(p: Product): string[] {
  const out: string[] = [];
  if (!p.title.trim()) out.push('Manca il nome');
  if (!(p.price > 0)) out.push('Manca il prezzo');
  if (!(CATEGORIES as readonly string[]).includes(p.category)) out.push('Manca la categoria');
  if (!p.images.length) out.push('Aggiungi almeno una foto');
  if (p.description.trim().length < MIN_DESCRIPTION) out.push(`Scrivi una descrizione (almeno ${MIN_DESCRIPTION} caratteri)`);
  // label data is checked only for products that came from Misura
  if (p.origin) {
    if (p.origin.madeIn && !p.origin.confirmed.madeIn) out.push('Conferma il made in');
    if (p.details.materiale.some((l) => !isMadeInLine(l)) && !p.origin.confirmed.composition) out.push('Conferma la composizione');
  }
  return out;
}

export function toProduct(payload: MisuraPayload, images: ProductImage[], user: string, old?: Product, slug?: string): Product {
  const now = new Date().toISOString();
  const publish = payload.action === 'publish';
  const materiale = payload.composition.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (payload.madeIn && payload.confirmed.madeIn) materiale.push(madeInLine(payload.madeIn));
  const misure = payload.measures.map((m) => `${m.label}: ${fmtCm(m.cm)} cm`);
  if (misure.length) misure.push(MEASURES_NOTE);
  return {
    slug: old?.slug ?? slug ?? uniqueSlug(slugify(payload.title), (s) => !!getAnyProduct(s)),
    title: payload.title, price: payload.price, size: payload.size || null, category: payload.category,
    available: old?.available ?? true, quantity: old?.quantity ?? 1, featured: old?.featured ?? false,
    order: old?.order ?? listAllProducts().length + 1,
    description: payload.description,
    details: { misure, materiale, stato: payload.condition || null, anni: old?.details.anni ?? null },
    images,
    model3d: { front: 0, back: null, tolerance: 22, disabled: true, version: null, hasBack: false },
    ...(old?.seoDescription ? { seoDescription: old.seoDescription } : {}),
    ...(publish ? {} : { draft: old?.draft ?? { source: 'misura' as const, misuraId: payload.misuraId, createdBy: user, createdAt: now } }),
    origin: {
      source: 'misura', misuraId: payload.misuraId, madeIn: payload.madeIn,
      ...(publish ? { publishedBy: user } : {}),
      confirmed: { ...payload.confirmed },
    },
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
  };
}

// ---------- photos ----------
function dropImage(dir: string, img: ProductImage) {
  rmSync(join(dir, `${img.id}.webp`), { force: true });
  for (const w of IMAGE_WIDTHS) rmSync(join(dir, `${img.id}-${w}.webp`), { force: true });
}

async function readPhoto(file: File): Promise<Buffer> {
  if (file.size > MAX_PHOTO_BYTES) throw new InputError(`"${file.name}" supera 15 MB.`);
  const buf = Buffer.from(await file.arrayBuffer());
  let meta;
  try { meta = await sharp(buf).metadata(); } catch { throw new InputError(`"${file.name}" non è un’immagine valida.`); }
  if (!meta.format || !PHOTO_FORMATS.includes(meta.format)) throw new InputError(`"${file.name}" non è un’immagine supportata (JPG, PNG, WebP, HEIC).`);
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_PHOTO_PIXELS) throw new InputError(`"${file.name}" è troppo grande (oltre 60 megapixel).`);
  return buf;
}

// ---------- save ----------
// Single Node process: a per-misuraId in-memory queue is enough to make retries idempotent.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  try { return await run; } finally { if (locks.get(key) === tail) locks.delete(key); }
}
// Slugs handed out to items whose photos are still being processed.
const reserved = new Set<string>();

export async function saveMisuraItem(form: FormData, user: string): Promise<{ slug: string; published: boolean }> {
  const raw = form.get('payload');
  if (typeof raw !== 'string' || raw.length > 50_000) throw new InputError('Dati dell’articolo mancanti.');
  let json: unknown;
  try { json = JSON.parse(raw); } catch { throw new InputError('Dati dell’articolo non leggibili.'); }
  const payload = parsePayload(json);
  const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length < 1 || files.length > MAX_PHOTOS) throw new InputError(`Carica da 1 a ${MAX_PHOTOS} foto.`);

  return withLock(payload.misuraId, async () => {
    const buffers: Buffer[] = [];
    for (const f of files) buffers.push(await readPhoto(f));

    // Check the publishing rules before touching the disk, with placeholder images.
    const probe = Array.from(buffers, (_, i): ProductImage => ({ id: `p${i}`, w: 1, h: 1 }));
    const existing = findByMisuraId(payload.misuraId);
    const slug = existing?.slug ?? uniqueSlug(slugify(payload.title), (s) => !!getAnyProduct(s) || reserved.has(s));
    if (payload.action === 'publish') {
      const blockers = publishBlockers(toProduct(payload, probe, user, existing, slug));
      if (blockers.length) throw new InputError('Il capo non è ancora pubblicabile.', blockers);
    }

    reserved.add(slug);
    const dir = join(UPLOADS_DIR, 'products', slug);
    const created: ProductImage[] = [];
    try {
      for (const b of buffers) {
        try { created.push(await processImage(b, dir)); } catch { throw new InputError('Non riesco a elaborare una delle foto.'); }
      }
      const product = toProduct(payload, created, user, existing, slug);
      saveProduct(product);
      for (const im of existing?.images ?? []) dropImage(dir, im);
      return { slug, published: !product.draft };
    } catch (e) {
      for (const im of created) dropImage(dir, im);
      throw e;
    } finally {
      reserved.delete(slug);
    }
  });
}

// ---------- publish an existing draft (admin) ----------
export type Confirmations = { confirmMadeIn?: boolean; confirmComposition?: boolean };

export function publishProduct(slug: string, user: string, c: Confirmations): Product {
  const old = getAnyProduct(slug);
  if (!old) throw new InputError('Prodotto non trovato.');
  if (!old.draft) return old; // already live
  const p: Product = structuredClone(old);
  if (p.origin) {
    if (c.confirmMadeIn && p.origin.madeIn && !p.origin.confirmed.madeIn) {
      p.origin.confirmed.madeIn = true;
      const line = madeInLine(p.origin.madeIn);
      if (!p.details.materiale.includes(line)) p.details.materiale.push(line);
    }
    if (c.confirmComposition) p.origin.confirmed.composition = true;
  }
  const blockers = publishBlockers(p);
  if (blockers.length) throw new InputError('Il capo non è ancora pubblicabile.', blockers);
  delete p.draft;
  if (p.origin) p.origin.publishedBy = user;
  p.updatedAt = new Date().toISOString();
  saveProduct(p);
  return p;
}
