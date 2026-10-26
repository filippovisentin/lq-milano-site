// Shared helpers for create-admin / remove-admin: users.json access
// (same file and shape as src/lib/users.ts) and base32 for TOTP keys.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const ROLES = ['proprietario', 'sviluppatore'];
export const DATA_DIR = resolve(process.env.LQ_DATA_DIR ?? 'data');
export const USERS_FILE = join(DATA_DIR, 'private', 'users.json');

export function readUsersFile() {
  if (!existsSync(USERS_FILE)) return null;
  let parsed;
  try { parsed = JSON.parse(readFileSync(USERS_FILE, 'utf8')); } catch {
    throw new Error(`${USERS_FILE} non è un JSON valido: correggilo prima di continuare.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${USERS_FILE} non contiene un elenco di utenti.`);
  return parsed;
}

export function writeUsersFile(users) {
  // password hashes and TOTP keys: owner-only, whatever the umask
  mkdirSync(dirname(USERS_FILE), { recursive: true, mode: 0o700 });
  chmodSync(dirname(USERS_FILE), 0o700);
  const tmp = `${USERS_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, USERS_FILE);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
