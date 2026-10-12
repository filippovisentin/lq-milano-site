// Client-side cart state. Persists in localStorage, broadcasts `cart:change`.
// Prices here are display copies only: the commerce provider recalculates
// totals, stock and shipping at checkout (see ./provider.ts).

export interface CartItem {
  id: string; // product slug (provider product id once integrated)
  title: string;
  price: number;
  size?: string | null;
  image: string;
  url: string;
  max: number; // vintage pieces are usually unique: max = stock
  qty: number;
}

export interface CartState { items: CartItem[]; note: string; coupon: string }

const KEY = 'lq-cart-v1';
const empty = (): CartState => ({ items: [], note: '', coupon: '' });

function read(): CartState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const s = JSON.parse(raw);
    return { ...empty(), ...s, items: Array.isArray(s.items) ? s.items : [] };
  } catch {
    return empty();
  }
}

let state: CartState = typeof window === 'undefined' ? empty() : read();

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: cart lives for this page view */ }
  window.dispatchEvent(new CustomEvent('cart:change', { detail: get() }));
}

export const get = (): CartState => structuredClone(state);
export const count = () => state.items.reduce((n, i) => n + i.qty, 0);
export const subtotal = () => state.items.reduce((n, i) => n + i.qty * i.price, 0);
export const has = (id: string) => state.items.some((i) => i.id === id);

export type AddResult = { ok: true } | { ok: false; reason: 'max' | 'unavailable' };

export function add(item: Omit<CartItem, 'qty'>, qty = 1): AddResult {
  if (item.max <= 0) return { ok: false, reason: 'unavailable' };
  const line = state.items.find((i) => i.id === item.id);
  if (line) {
    if (line.qty >= line.max) return { ok: false, reason: 'max' };
    line.qty = Math.min(line.max, line.qty + qty);
  } else {
    state.items.push({ ...item, qty: Math.min(item.max, qty) });
  }
  write();
  return { ok: true };
}

export function setQty(id: string, qty: number) {
  const line = state.items.find((i) => i.id === id);
  if (!line) return;
  if (qty <= 0) return remove(id);
  line.qty = Math.min(line.max, qty);
  write();
}

let lastRemoved: { item: CartItem; index: number } | null = null;
export function remove(id: string) {
  const index = state.items.findIndex((i) => i.id === id);
  if (index < 0) return;
  lastRemoved = { item: state.items[index], index };
  state.items.splice(index, 1);
  write();
}
export function undoRemove() {
  if (!lastRemoved) return;
  state.items.splice(lastRemoved.index, 0, lastRemoved.item);
  lastRemoved = null;
  write();
}

export function setNote(note: string) { state.note = note.slice(0, 500); write(); }
export function setCoupon(code: string) { state.coupon = code.trim().toUpperCase().slice(0, 40); write(); }
export function clear() { state = empty(); write(); }

// keep tabs in sync
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { state = read(); window.dispatchEvent(new CustomEvent('cart:change', { detail: get() })); }
  });
}

export const euro = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
