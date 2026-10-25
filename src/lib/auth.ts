// Per-user admin authentication: password (step 1) + TOTP code (step 2).
// Accounts live in data/private/users.json (see users.ts); only SESSION_SECRET
// (min 32 chars) stays in .env. Create/rotate users with: npm run admin:create
import { scryptSync, timingSafeEqual, createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AstroCookies } from 'astro';
import { PROJECT_ROOT } from './root';
import { getUser, type AdminUser, type Role } from './users';

const envFile = join(PROJECT_ROOT, '.env');
if (existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch { /* already loaded */ }
}

export const COOKIE = 'lq_admin';
export const MFA_COOKIE = 'lq_mfa';
const MAX_AGE = 60 * 60 * 12; // 12h session
const PENDING_AGE = 5 * 60; // 5 min between password and code

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

// Unreadable users file = no users: every check fails closed.
function lookup(name: string): AdminUser | undefined {
  try { return getUser(name); } catch (err) {
    console.error('auth: elenco utenti non leggibile', err);
    return undefined;
  }
}

// Verify signature + expiry, return the payload object or null.
function open(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const good = Buffer.from(sign(payload)), got = Buffer.from(sig);
  if (good.length !== got.length || !timingSafeEqual(good, got)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data || typeof data !== 'object' || typeof data.exp !== 'number' || data.exp < Date.now() / 1000) return null;
    return data;
  } catch { return null; }
}
const seal = (data: Record<string, unknown>) => {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${payload}.${sign(payload)}`;
};
const nowSec = () => Math.floor(Date.now() / 1000);

// Step 1 done (password ok): short-lived cookie that only allows the code page.
export function createPending(cookies: AstroCookies, user: string, secure: boolean) {
  cookies.set(MFA_COOKIE, seal({ k: 'pending', u: user, exp: nowSec() + PENDING_AGE }), { path: '/', httpOnly: true, sameSite: 'strict', secure, maxAge: PENDING_AGE });
}
export function readPending(cookies: AstroCookies): { user: string } | null {
  const d = open(cookies.get(MFA_COOKIE)?.value);
  if (!d || d.k !== 'pending' || typeof d.u !== 'string') return null;
  return { user: d.u };
}
export const clearPending = (cookies: AstroCookies) => cookies.delete(MFA_COOKIE, { path: '/' });

export function createSession(cookies: AstroCookies, user: AdminUser, secure: boolean) {
  const data = { u: user.user, role: user.role, v: user.sessionVersion, mfa: true, exp: nowSec() + MAX_AGE };
  cookies.set(COOKIE, seal(data), { path: '/', httpOnly: true, sameSite: 'strict', secure, maxAge: MAX_AGE });
}
// Valid only if the user still exists, the session version matches (so
// "log out everywhere" revokes it) and the code step was completed.
export function readSession(cookies: AstroCookies): { user: string; role: Role } | null {
  const d = open(cookies.get(COOKIE)?.value);
  if (!d || d.mfa !== true || typeof d.u !== 'string' || typeof d.v !== 'number') return null;
  const u = lookup(d.u);
  if (!u || u.sessionVersion !== d.v) return null;
  return { user: u.user, role: u.role }; // role always from the file, never the cookie
}
export const clearSession = (cookies: AstroCookies) => cookies.delete(COOKIE, { path: '/' });

// Only same-site admin paths are valid redirect targets.
export function safeNext(raw: unknown): string {
  const n = typeof raw === 'string' ? raw : '';
  return /^\/admin(?:[/?#].*)?$/.test(n) && !n.includes('\\') ? n : '/admin';
}

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

// Runs a scrypt verification even for unknown users so timing does not reveal them.
let dummyHash: string | null = null;
export function checkPassword(user: string, pw: string): AdminUser | null {
  const u = lookup(user);
  dummyHash ??= hashPassword('dummy');
  const ok = verifyPassword(pw, u ? u.passwordHash : dummyHash);
  return u && ok ? u : null;
}
