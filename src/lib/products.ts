import { getCollection, type CollectionEntry } from 'astro:content';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from './root';

export type Product = CollectionEntry<'products'>;
export type Event = CollectionEntry<'events'>;

export const productUrl = (id: string) => `/product-page/${id}`;
export const eventUrl = (id: string) => `/event-details/${id}`;

export async function getProducts() {
  const all = await getCollection('products');
  return all.sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title, 'it'));
}

export const inStock = (p: Product) => p.data.available && p.data.quantity > 0;

/** True when scripts/build-3d.mjs produced a rotating model for this product. */
export function has3d(p: Product) {
  if (p.data.model3d?.disabled) return false;
  return existsSync(join(PROJECT_ROOT, 'public', '3d', p.id, 'front.webp'));
}

export async function getEvents() {
  const all = await getCollection('events');
  return all.sort((a, b) => b.data.start.getTime() - a.data.start.getTime());
}

const rome = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', ...opts });
export const fmtDate = (d: Date) => rome({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
export const fmtDay = (d: Date) => rome({ day: 'numeric' }).format(d);
export const fmtMonth = (d: Date) => rome({ month: 'short' }).format(d).replace('.', '');
export const fmtYear = (d: Date) => rome({ year: 'numeric' }).format(d);
export const fmtTime = (d: Date) => rome({ hour: '2-digit', minute: '2-digit' }).format(d);
export const eventEnd = (e: Event) => e.data.end ?? new Date(e.data.start.getTime() + 3 * 3600_000);
