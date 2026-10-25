import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AstroCookies } from 'astro';
import { COOKIE, MFA_COOKIE, checkPassword, clearPending, createPending, createSession, hashPassword, readPending, readSession } from './auth';
import { USERS_FILE, bumpSessionVersion, readUsers, writeUsers, type AdminUser } from './users';
import { AUDIT_FILE, audit, pruneAudit } from './audit';

const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const DAY = 86_400_000;

beforeAll(() => { process.env.SESSION_SECRET = SECRET; });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-01T10:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

const mk = (user = 'anna', over: Partial<AdminUser> = {}): AdminUser => ({
  user, role: 'proprietario', passwordHash: hashPassword('correct-horse-battery'), totpSecret: 'JBSWY3DPEHPK3PXP',
  lastTotpStep: 0, sessionVersion: 3, createdAt: '2026-01-01T00:00:00.000Z', ...over,
});

function jar(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  const cookies = {
    get: (k: string) => (m.has(k) ? { value: m.get(k)! } : undefined),
    set: (k: string, v: string) => { m.set(k, v); },
    delete: (k: string) => { m.delete(k); },
  };
  return { cookies: cookies as unknown as AstroCookies, m };
}
const sign = (payload: string) => createHmac('sha256', SECRET).update(payload).digest('base64url');
const forge = (obj: unknown) => {
  const p = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${p}.${sign(p)}`;
};
const now = () => Math.floor(Date.now() / 1000);

describe('session', () => {
  it('reads a valid session', () => {
    const u = mk();
    writeUsers([u]);
    const { cookies } = jar();
    createSession(cookies, u, false);
    expect(readSession(cookies)).toEqual({ user: 'anna', role: 'proprietario' });
  });

  it('rejects a removed user', () => {
    const u = mk();
    writeUsers([u]);
    const { cookies } = jar();
    createSession(cookies, u, false);
    writeUsers([mk('bruno')]);
    expect(readSession(cookies)).toBeNull();
  });

  it('is revoked by bumpSessionVersion', () => {
    const u = mk();
    writeUsers([u]);
    const { cookies } = jar();
    createSession(cookies, u, false);
    bumpSessionVersion('anna');
    expect(readSession(cookies)).toBeNull();
  });

  it('takes the role from the users file, not the cookie', () => {
    const u = mk('anna', { role: 'proprietario' });
    writeUsers([u]);
    const { cookies } = jar();
    createSession(cookies, u, false);
    writeUsers([{ ...u, role: 'sviluppatore' }]);
    expect(readSession(cookies)).toEqual({ user: 'anna', role: 'sviluppatore' });
  });

  it('rejects a signed payload without mfa', () => {
    writeUsers([mk()]);
    const noMfa = jar({ [COOKIE]: forge({ u: 'anna', role: 'proprietario', v: 3, exp: now() + 600 }) });
    expect(readSession(noMfa.cookies)).toBeNull();
    const falseMfa = jar({ [COOKIE]: forge({ u: 'anna', role: 'proprietario', v: 3, mfa: false, exp: now() + 600 }) });
    expect(readSession(falseMfa.cookies)).toBeNull();
    const ok = jar({ [COOKIE]: forge({ u: 'anna', role: 'proprietario', v: 3, mfa: true, exp: now() + 600 }) });
    expect(readSession(ok.cookies)).toEqual({ user: 'anna', role: 'proprietario' });
  });

  it('rejects a pending cookie used as a session', () => {
    const u = mk();
    writeUsers([u]);
    const { cookies, m } = jar();
    createPending(cookies, 'anna', false);
    const pending = m.get(MFA_COOKIE)!;
    expect(readSession(jar({ [COOKIE]: pending }).cookies)).toBeNull();
  });

  it('rejects a tampered signature or payload', () => {
    const u = mk();
    writeUsers([u]);
    const { cookies, m } = jar();
    createSession(cookies, u, false);
    const [p, s] = m.get(COOKIE)!.split('.');
    const flipped = s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A');
    expect(readSession(jar({ [COOKIE]: `${p}.${flipped}` }).cookies)).toBeNull();
    const evil = Buffer.from(JSON.stringify({ u: 'anna', role: 'proprietario', v: 3, mfa: true, exp: now() + 99999 })).toString('base64url');
    expect(readSession(jar({ [COOKIE]: `${evil}.${s}` }).cookies)).toBeNull();
    expect(readSession(jar({ [COOKIE]: 'garbage' }).cookies)).toBeNull();
    expect(readSession(jar().cookies)).toBeNull();
  });

  it('expires after 12 hours', () => {
    const u = mk();
    writeUsers([u]);
    const { cookies } = jar();
    createSession(cookies, u, false);
    vi.setSystemTime(Date.now() + 11 * 3600_000);
    expect(readSession(cookies)).not.toBeNull();
    vi.setSystemTime(Date.now() + 2 * 3600_000);
    expect(readSession(cookies)).toBeNull();
  });
});

describe('pending (step 1 of login)', () => {
  it('is readable, then expires after 5 minutes', () => {
    const { cookies } = jar();
    createPending(cookies, 'anna', false);
    expect(readPending(cookies)).toEqual({ user: 'anna' });
    vi.setSystemTime(Date.now() + 4 * 60_000);
    expect(readPending(cookies)).toEqual({ user: 'anna' });
    vi.setSystemTime(Date.now() + 61_000);
    expect(readPending(cookies)).toBeNull();
  });

  it('rejects a session cookie used as pending, and clearPending removes it', () => {
    const u = mk();
    writeUsers([u]);
    const a = jar();
    createSession(a.cookies, u, false);
    expect(readPending(jar({ [MFA_COOKIE]: a.m.get(COOKIE)! }).cookies)).toBeNull();
    const b = jar();
    createPending(b.cookies, 'anna', false);
    clearPending(b.cookies);
    expect(readPending(b.cookies)).toBeNull();
  });
});

describe('checkPassword', () => {
  it('returns the user only for the right password', () => {
    writeUsers([mk()]);
    expect(checkPassword('anna', 'correct-horse-battery')?.user).toBe('anna');
    expect(checkPassword('anna', 'wrong')).toBeNull();
    expect(checkPassword('nobody', 'correct-horse-battery')).toBeNull();
  });
});

describe('fail closed when users.json is unreadable', () => {
  it('treats a corrupt file as no users', () => {
    const u = mk();
    writeUsers([u]);
    const { cookies } = jar();
    createSession(cookies, u, false);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mkdirSync(dirname(USERS_FILE), { recursive: true });
    writeFileSync(USERS_FILE, '{ not json');
    expect(readSession(cookies)).toBeNull();
    expect(checkPassword('anna', 'correct-horse-battery')).toBeNull();
    writeFileSync(USERS_FILE, '{"user":"anna"}'); // valid JSON but not an array
    expect(readSession(cookies)).toBeNull();
    expect(checkPassword('anna', 'correct-horse-battery')).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('readUsers throws a clear error for corrupt content', () => {
    mkdirSync(dirname(USERS_FILE), { recursive: true });
    writeFileSync(USERS_FILE, '{ not json');
    expect(() => readUsers()).toThrow(/users\.json/);
    writeFileSync(USERS_FILE, '{"a":1}');
    expect(() => readUsers()).toThrow(/users\.json/);
  });
});

describe('audit', () => {
  const lineAt = (ageDays: number) => JSON.stringify({ t: new Date(Date.now() - ageDays * DAY).toISOString(), event: `e${ageDays}` });

  it('appends one json line with an ISO timestamp, and data cannot override t', () => {
    if (existsSync(AUDIT_FILE)) writeFileSync(AUDIT_FILE, '');
    audit('login', { user: 'anna', ip: '1.2.3.4', t: 'forged' });
    const [line] = readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').slice(-1);
    const row = JSON.parse(line);
    expect(row).toMatchObject({ event: 'login', user: 'anna', ip: '1.2.3.4' });
    expect(row.t).toBe(new Date().toISOString());
  });

  it('pruneAudit drops 366-day lines and keeps 364-day lines', () => {
    mkdirSync(dirname(AUDIT_FILE), { recursive: true });
    writeFileSync(AUDIT_FILE, [lineAt(366), lineAt(364), lineAt(1), 'not json'].join('\n') + '\n');
    pruneAudit(Date.now());
    const kept = readFileSync(AUDIT_FILE, 'utf8').trim().split('\n');
    expect(kept).toContain(lineAt(364));
    expect(kept).toContain(lineAt(1));
    expect(kept).not.toContain(lineAt(366));
  });
});
