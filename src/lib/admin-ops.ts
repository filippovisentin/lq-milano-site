// Server-side operations behind the admin panel.
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// shared with the CLI scripts
import { processImage } from '../../scripts/lib/images.mjs';
import { buildGarment3D, plainness } from '../../scripts/lib/garment3d.mjs';
import {
  UPLOADS_DIR, MODELS_DIR, CATEGORIES, CONDITIONS, listAllProducts, getAnyProduct, saveProduct, slugify, uniqueSlug,
  listEvents, getEvent, saveEvent, IMAGE_WIDTHS, type Product, type ProductImage, type LqEvent,
} from './catalog';

const MAX_FILE = 25 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'];

export class InputError extends Error {
  constructor(message: string, public blockers?: string[]) { super(message); }
}

const str = (f: FormData, k: string, max = 300) => String(f.get(k) ?? '').trim().slice(0, max);
const lines = (f: FormData, k: string) => str(f, k, 4000).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30);
const bool = (f: FormData, k: string) => f.get(k) === 'on' || f.get(k) === 'true' || f.get(k) === '1';

async function storeFile(file: File, dir: string): Promise<ProductImage> {
  if (!IMAGE_TYPES.includes(file.type) && !/\.(jpe?g|png|webp|avif|heic)$/i.test(file.name)) throw new InputError(`"${file.name}" non è un’immagine supportata (JPG, PNG, WebP, HEIC).`);
  if (file.size > MAX_FILE) throw new InputError(`"${file.name}" supera 25 MB.`);
  try {
    return await processImage(Buffer.from(await file.arrayBuffer()), dir);
  } catch {
    throw new InputError(`Non riesco a leggere "${file.name}". Prova a esportarla in JPG.`);
  }
}
function dropImage(dir: string, img: ProductImage) {
  rmSync(join(dir, `${img.id}.webp`), { force: true });
  for (const w of IMAGE_WIDTHS) rmSync(join(dir, `${img.id}-${w}.webp`), { force: true });
}

export async function saveProductFromForm(form: FormData): Promise<{ product: Product; built3d: boolean; warning?: string }> {
  const existingSlug = str(form, 'slug', 120);
  const old = existingSlug ? getAnyProduct(existingSlug) : undefined;
  if (existingSlug && !old) throw new InputError('Prodotto non trovato.');

  const title = str(form, 'title', 120);
  if (!title) throw new InputError('Inserisci il nome del capo.');
  const price = Number(str(form, 'price', 20).replace(',', '.'));
  if (!Number.isFinite(price) || price < 0) throw new InputError('Il prezzo deve essere un numero, es. 85 oppure 85,50.');
  const category = str(form, 'category', 40) as Product['category'];
  if (!CATEGORIES.includes(category)) throw new InputError('Scegli una categoria.');
  const stato = str(form, 'stato', 40) || null;
  if (stato && !(CONDITIONS as readonly string[]).includes(stato)) throw new InputError('Stato non valido.');
  const quantity = Math.max(0, Math.min(99, Math.round(Number(str(form, 'quantity', 4) || '1'))));

  const slug = old?.slug ?? uniqueSlug(slugify(title), (s) => !!getAnyProduct(s));
  const dir = join(UPLOADS_DIR, 'products', slug);

  // photos: "order" is a JSON list of refs: "id:<existing id>" or "new:<file index>"
  let order: string[] = [];
  try { order = JSON.parse(str(form, 'order', 4000) || '[]'); } catch { throw new InputError('Ordine delle foto non valido.'); }
  const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
  const created = new Map<number, ProductImage>();
  for (const [i, f] of files.entries()) if (order.includes(`new:${i}`)) created.set(i, await storeFile(f, dir));
  const byId = new Map((old?.images ?? []).map((im) => [im.id, im]));
  const images: ProductImage[] = [];
  for (const ref of order) {
    if (ref.startsWith('id:') && byId.has(ref.slice(3))) images.push(byId.get(ref.slice(3))!);
    else if (ref.startsWith('new:') && created.has(Number(ref.slice(4)))) images.push(created.get(Number(ref.slice(4)))!);
  }
  if (!images.length) throw new InputError('Aggiungi almeno una foto.');
  for (const im of old?.images ?? []) if (!images.includes(im)) dropImage(dir, im);

  const refIndex = (k: string) => {
    const ref = str(form, k, 60);
    if (!ref) return null;
    const target = ref.startsWith('id:') ? byId.get(ref.slice(3)) : created.get(Number(ref.slice(4)));
    const i = target ? images.indexOf(target) : -1;
    return i >= 0 ? i : null;
  };
  const front = refIndex('front3d') ?? 0;
  let back = refIndex('back3d');
  if (back === front) back = null;
  const tolerance = Math.max(8, Math.min(60, Number(str(form, 'tolerance', 4)) || 22));
  const disabled = bool(form, 'disable3d');

  const now = new Date().toISOString();
  const product: Product = {
    slug, title, price: Math.round(price * 100) / 100, size: str(form, 'size', 20) || null, category,
    available: bool(form, 'available'), quantity, featured: bool(form, 'featured'),
    order: Number(str(form, 'order_n', 6)) || old?.order || listAllProducts().length + 1,
    description: str(form, 'description', 6000),
    details: { misure: lines(form, 'misure'), materiale: lines(form, 'materiale'), stato, anni: str(form, 'anni', 40) || null },
    images,
    model3d: { front, back, tolerance, disabled, version: old?.model3d.version ?? null, hasBack: old?.model3d.hasBack ?? false },
    seoDescription: str(form, 'seoDescription', 300) || undefined,
    // carried over: the form never edits draft state or Misura provenance
    ...(old?.draft ? { draft: old.draft } : {}),
    ...(old?.origin ? { origin: old.origin } : {}),
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
  };

  // (re)build the 3D model when its inputs changed
  const prev = old?.model3d;
  const frontId = images[front]?.id, backId = back !== null ? images[back]?.id : null;
  const prevFront = old && prev ? old.images[prev.front]?.id : null;
  const prevBack = old && prev && prev.back !== null ? old.images[prev.back]?.id : null;
  const needs3d = !disabled && (bool(form, 'regen3d') || !prev?.version || frontId !== prevFront || backId !== prevBack || tolerance !== prev.tolerance || !existsSync(join(MODELS_DIR, slug, 'front.webp')));
  let built3d = false, warning: string | undefined;
  if (needs3d) {
    try {
      const plain = await plainness(join(dir, `${frontId}.webp`));
      if (plain.score < 0.6) warning = 'La foto del fronte non ha uno sfondo uniforme: il ritaglio 3D potrebbe essere impreciso.';
      const meta = await buildGarment3D({
        front: join(dir, `${frontId}.webp`),
        back: backId ? join(dir, `${backId}.webp`) : null,
        outDir: join(MODELS_DIR, slug),
        tolerance,
      });
      product.model3d.version = meta.version;
      product.model3d.hasBack = meta.hasBack;
      built3d = true;
    } catch (e) {
      warning = `Vista 3D non generata: ${(e as Error).message}`;
    }
  }
  saveProduct(product);
  return { product, built3d, warning };
}

export async function saveEventFromForm(form: FormData): Promise<LqEvent> {
  const existingSlug = str(form, 'slug', 120);
  const old = existingSlug ? getEvent(existingSlug) : undefined;
  if (existingSlug && !old) throw new InputError('Evento non trovato.');
  const title = str(form, 'title', 120);
  if (!title) throw new InputError('Inserisci il titolo.');
  const toIso = (k: string, required: boolean) => {
    const v = str(form, k, 30);
    if (!v) { if (required) throw new InputError('Inserisci data e ora di inizio.'); return null; }
    // <input type="datetime-local"> is Milan wall-clock time: attach Rome's offset for that date
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) throw new InputError('Data non valida.');
    const probe = new Date(`${v}:00Z`);
    const tz = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Rome', timeZoneName: 'longOffset' })
      .formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value.replace('GMT', '') || '+01:00';
    return `${v}:00${tz}`;
  };
  const start = toIso('start', true)!;
  const end = toIso('end', false);
  if (end && new Date(end) <= new Date(start)) throw new InputError('La fine deve essere dopo l’inizio.');
  const registration = str(form, 'registration', 20) as LqEvent['registration'];
  if (!['aperta', 'chiusa', 'esaurita'].includes(registration)) throw new InputError('Stato iscrizioni non valido.');
  const registrationUrl = str(form, 'registrationUrl', 500) || null;
  if (registrationUrl && !/^https?:\/\//.test(registrationUrl)) throw new InputError('Il link per iscriversi deve iniziare con https://');

  const slug = old?.slug ?? uniqueSlug(slugify(title), (s) => !!getEvent(s));
  const dir = join(UPLOADS_DIR, 'events', slug);
  let poster = old?.poster ?? null;
  const file = form.get('poster');
  if (file instanceof File && file.size > 0) {
    const np = await storeFile(file, dir);
    if (poster) dropImage(dir, poster);
    poster = np;
  }
  if (!poster) throw new InputError('Carica la locandina.');
  const now = new Date().toISOString();
  const ev: LqEvent = {
    slug, title, start, end, poster, venue: str(form, 'venue', 160) || 'Via Giulio e Corrado Venini, 54',
    registration, registrationUrl, tagline: str(form, 'tagline', 160) || null, description: str(form, 'description', 6000),
    createdAt: old?.createdAt ?? now, updatedAt: now,
  };
  saveEvent(ev);
  return ev;
}

export { listEvents };
