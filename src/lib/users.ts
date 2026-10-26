import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from './catalog';

export type Role = 'proprietario' | 'sviluppatore';

export type AdminUser = {
  user: string;
  role: Role;
  passwordHash: string;
  totpSecret: string;
  lastTotpStep: number;
  sessionVersion: number;
  createdAt: string;
};

export const USERS_FILE = join(DATA_DIR, 'private', 'users.json');

// Cache keyed on mtime+size (mtime alone can miss two quick writes).
let cache: { key: string; users: AdminUser[] } | null = null;

export function readUsers(): AdminUser[] {
  if (!existsSync(USERS_FILE)) return [];
  const st = statSync(USERS_FILE);
  const key = `${st.mtimeMs}:${st.size}`;
  if (cache && cache.key === key) return cache.users;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(USERS_FILE, 'utf8'));
  } catch {
    throw new Error('users.json non leggibile (JSON non valido)');
  }
  if (!Array.isArray(parsed)) throw new Error('users.json non valido (atteso un elenco)');
  const users = parsed as AdminUser[];
  cache = { key, users };
  return users;
}

export function getUser(name: string): AdminUser | undefined {
  return readUsers().find((u) => u.user === name);
}

export function writeUsers(users: AdminUser[]): void {
  // password hashes and TOTP keys: owner-only, whatever the umask
  mkdirSync(dirname(USERS_FILE), { recursive: true, mode: 0o700 });
  chmodSync(dirname(USERS_FILE), 0o700);
  const tmp = `${USERS_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, USERS_FILE);
  cache = null;
}

export function bumpSessionVersion(name: string): void {
  const users = readUsers().map((u) => (u.user === name ? { ...u, sessionVersion: u.sessionVersion + 1 } : u));
  writeUsers(users);
}

export function setLastTotpStep(name: string, step: number): void {
  writeUsers(readUsers().map((u) => (u.user === name ? { ...u, lastTotpStep: step } : u)));
}
