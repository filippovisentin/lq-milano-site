// Runtime catalogue: products and events live as JSON files in data/, photos
// and 3D assets in data/uploads and data/3d (served by /media/...). The admin
// panel writes here; public pages read here on every request (cached by mtime),
// so a change is live immediately, no rebuild needed.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, rmSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROJECT_ROOT } from './root';

export const DATA_DIR = resolve(process.env.LQ_DATA_DIR ?? join(PROJECT_ROOT, 'data'));
export const PRODUCTS_DIR = join(DATA_DIR, 'products');
export const EVENTS_DIR = join(DATA_DIR, 'events');
export const UPLOADS_DIR = join(DATA_DIR, 'uploads');
export const MODELS_DIR = join(DATA_DIR, '3d');

export const CATEGORIES = ['Capispalla', 'Maglieria e polo', 'Camicie', 'Pantaloni e gonne', 'Accessori', 'Altro'] as const;
export const CONDITIONS = ['Nuovo con cartellino', 'Ottimo', 'Molto buono', 'Buono', 'Discreto'] as const;
export const IMAGE_WIDTHS = [480, 960, 1600] as const;

export interface ProductImage { id: string; w: number; h: number }
export interface Product {
  slug: string;
  title: string;
  price: number;
  size: string | null;
  category: (typeof CATEGORIES)[number];
  available: boolean;
  quantity: number;
  featured: boolean;
  order: number;
  description: string; // paragraphs separated by blank lines
  details: { misure: string[]; materiale: string[]; stato: string | null; anni: string | null };
  images: ProductImage[];
  model3d: { front: number; back: number | null; tolerance: number; disabled: boolean; version: number | null; hasBack: boolean };
  seoDescription?: string;
  // Set while a product created by Misura is waiting to be published: hidden from the public site.
  draft?: { source: 'misura'; misuraId: string; createdBy: string; createdAt: string };
  // Provenance of a product that came from Misura (kept after publishing).
  origin?: { source: 'misura'; misuraId: string; madeIn?: string; publishedBy?: string; confirmed: { madeIn: boolean; composition: boolean } };
  createdAt: string;
  updatedAt: string;
}
export interface LqEvent {
  slug: string;
  title: string;
  start: string; // ISO with offset
  end: string | null;
  poster: ProductImage | null;
  venue: string;
  registration: 'aperta' | 'chiusa' | 'esaurita';
  registrationUrl: string | null;
  tagline: string | null;
  description: string;
  createdAt: string;
  updatedAt: string;
}

for (const d of [PRODUCTS_DIR, EVENTS_DIR, UPLOADS_DIR, MODELS_DIR]) mkdirSync(d, { recursive: true });

// ---------- generic JSON store with mtime cache ----------
const cache = new Map<string, { stamp: string; items: any[] }>();
function readAll<T>(dir: string): T[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const stamp = files.map((f) => `${f}:${statSync(join(dir, f)).mtimeMs}`).join('|');
  const hit = cache.get(dir);
  if (hit && hit.stamp === stamp) return hit.items as T[];
  const items = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T);
  cache.set(dir, { stamp, items });
  return items;
}
function writeAtomic(path: string, data: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

// ---------- products ----------
export const isDraft = (p: Product) => !!p.draft;
// Admin only: every product, drafts included.
export function listAllProducts(): Product[] {
  return [...readAll<Product>(PRODUCTS_DIR)].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'it'));
}
export const getAnyProduct = (slug: string) => listAllProducts().find((p) => p.slug === slug);
export const findByMisuraId = (id: string) =>
  listAllProducts().find((p) => p.draft?.misuraId === id || p.origin?.misuraId === id);
// Public: drafts never show up.
export const listProducts = () => listAllProducts().filter((p) => !isDraft(p));
export const getProduct = (slug: string) => listProducts().find((p) => p.slug === slug);
export const inStock = (p: Product) => p.available && p.quantity > 0;
export const has3d = (p: Product) => !p.model3d.disabled && !!p.model3d.version && existsSync(join(MODELS_DIR, p.slug, 'front.webp'));
// Public 3D view (product viewer, "3D" badge). Off by client choice 2026-10-18;
// models are still generated in /admin, so turning this back on is one line.
export const SHOW_3D = false;
export const show3d = (p: Product) => SHOW_3D && has3d(p);
export function saveProduct(p: Product) { writeAtomic(join(PRODUCTS_DIR, `${p.slug}.json`), p); }
export function deleteProduct(slug: string) {
  rmSync(join(PRODUCTS_DIR, `${slug}.json`), { force: true });
  rmSync(join(UPLOADS_DIR, 'products', slug), { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  rmSync(join(MODELS_DIR, slug), { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}

// ---------- events ----------
export function listEvents(): LqEvent[] {
  return [...readAll<LqEvent>(EVENTS_DIR)].sort((a, b) => +new Date(b.start) - +new Date(a.start));
}
export const getEvent = (slug: string) => listEvents().find((e) => e.slug === slug);
export function saveEvent(e: LqEvent) { writeAtomic(join(EVENTS_DIR, `${e.slug}.json`), e); }
export function deleteEvent(slug: string) {
  rmSync(join(EVENTS_DIR, `${slug}.json`), { force: true });
  rmSync(join(UPLOADS_DIR, 'events', slug), { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}
export const eventEnd = (e: LqEvent) => (e.end ? new Date(e.end) : new Date(new Date(e.start).getTime() + 3 * 3600_000));
export const isPast = (e: LqEvent) => eventEnd(e).getTime() < Date.now();

// ---------- urls ----------
export const productUrl = (slug: string) => `/product-page/${encodeURIComponent(slug)}`;
export const eventUrl = (slug: string) => `/event-details/${encodeURIComponent(slug)}`;
export const imgUrl = (kind: 'products' | 'events', slug: string, img: ProductImage, w: number) =>
  `/media/uploads/${kind}/${encodeURIComponent(slug)}/${img.id}-${w}.webp`;
export const srcset = (kind: 'products' | 'events', slug: string, img: ProductImage) =>
  IMAGE_WIDTHS.filter((w, i) => i === 0 || w <= img.w * 1.05).map((w) => `${imgUrl(kind, slug, img, w)} ${Math.min(w, img.w)}w`).join(', ');
export const modelBase = (p: Product) => `/media/3d/${encodeURIComponent(p.slug)}`;

export function slugify(s: string) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'capo';
}
export function uniqueSlug(base: string, taken: (s: string) => boolean) {
  let s = base, n = 1;
  while (taken(s)) s = `${base}-${n++}`;
  return s;
}

// ---------- formatting ----------
export const euro = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
const rome = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', ...opts });
export const fmtDate = (d: Date) => rome({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
export const fmtDay = (d: Date) => rome({ day: 'numeric' }).format(d);
export const fmtMonth = (d: Date) => rome({ month: 'short' }).format(d).replace('.', '');
export const fmtYear = (d: Date) => rome({ year: 'numeric' }).format(d);
export const fmtTime = (d: Date) => rome({ hour: '2-digit', minute: '2-digit' }).format(d);
export const era = (anni: string | null) => anni?.replace(/^'/, '’') ?? null;
export const paragraphs = (s: string) => s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
