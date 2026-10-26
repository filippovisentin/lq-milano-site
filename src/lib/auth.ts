// Single-owner admin authentication.
// Credentials live in .env (never in git): ADMIN_USER, ADMIN_PASSWORD_HASH
// (scrypt), SESSION_SECRET. Create/rotate them with: npm run admin:create
import { scryptSync, timingSafeEqual, createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AstroCookies } from 'astro';
import { PROJECT_ROOT } from './root';

const envFile = join(PROJECT_ROOT, '.env');
if (existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch { /* already loaded */ }
}

export const COOKIE = 'lq_admin';
const MAX_AGE = 60 * 60 * 12; // 12h

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET mancante: esegui npm run admin:create');
  return s;
};

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string | undefined) {
  if (!stored) return false;
  const [algo, salt, hex] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hex) return false;
  const a = scryptSync(pw, salt, 64), b = Buffer.from(hex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function createSession(cookies: AstroCookies, user: string, secure: boolean) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = Buffer.from(JSON.stringify({ u: user, exp })).toString('base64url');
  cookies.set(COOKIE, `${payload}.${sign(payload)}`, { path: '/', httpOnly: true, sameSite: 'strict', secure, maxAge: MAX_AGE });
}
export function readSession(cookies: AstroCookies): { user: string } | null {
  const v = cookies.get(COOKIE)?.value;
  if (!v) return null;
  const [payload, sig] = v.split('.');
  if (!payload || !sig) return null;
  const good = Buffer.from(sign(payload)), got = Buffer.from(sig);
  if (good.length !== got.length || !timingSafeEqual(good, got)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof exp !== 'number' || exp < Date.now() / 1000) return null;
    if (u !== process.env.ADMIN_USER) return null;
    return { user: u };
  } catch { return null; }
}
export const clearSession = (cookies: AstroCookies) => cookies.delete(COOKIE, { path: '/' });

// Cookies get `Secure` when the request URL is https (directly, or through a
// proxy listed in LQ_ALLOWED_DOMAINS at build time) or when LQ_COOKIE_SECURE=1,
// for a TLS proxy whose scheme the app cannot see.
export const secureCookies = (url: URL) => url.protocol === 'https:' || process.env.LQ_COOKIE_SECURE === '1';

// naive in-memory brute-force brake: 8 failures per IP per 15 minutes
const fails = new Map<string, { n: number; t: number }>();
export function tooManyAttempts(ip: string) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.t > 15 * 60_000) return false;
  return f.n >= 8;
}
export function noteFailure(ip: string) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.t > 15 * 60_000) fails.set(ip, { n: 1, t: Date.now() });
  else f.n++;
}
export const clearFailures = (ip: string) => fails.delete(ip);

export function checkLogin(user: string, pw: string) {
  const u = process.env.ADMIN_USER ?? '';
  const sameUser = u.length > 0 && u.length === user.length && timingSafeEqual(Buffer.from(u), Buffer.from(user));
  const okPw = verifyPassword(pw, process.env.ADMIN_PASSWORD_HASH);
  return sameUser && okPw;
}
