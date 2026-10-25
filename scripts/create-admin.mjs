// Creates or rotates an admin account.
//   npm run admin:create -- <nome> <proprietario|sviluppatore> [password]
// New user: random password (or the one given, min 12 chars) + new TOTP key.
// Existing user: rotation = new password, new TOTP key, sessions revoked.
// First run with no users.json and an old ADMIN_USER in .env: that account is
// migrated as "proprietario" keeping its password hash (a new TOTP key is made).
// Writes data/private/users.json, removes ADMIN_USER / ADMIN_PASSWORD_HASH from
// .env (SESSION_SECRET is kept or created) and the credentials, TOTP key and
// otpauth:// link into ADMIN-CREDENZIALI.txt (git-ignored). Restart the server.
// LQ_ENV_FILE overrides the .env path (credentials file goes next to it).
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { scryptSync, randomBytes, randomInt } from 'node:crypto';
import { ROLES, USERS_FILE, base32Encode, readUsersFile, writeUsersFile } from './admin-store.mjs';

const [name, role, givenPw] = process.argv.slice(2);
const fail = (msg) => { console.error(msg); process.exit(1); };
if (!name || !/^[A-Za-z0-9._-]{2,32}$/.test(name)) fail('Uso: npm run admin:create -- <nome> <proprietario|sviluppatore> [password]\nIl nome: 2-32 caratteri tra lettere, numeri, . _ -');
if (!ROLES.includes(role)) fail(`Ruolo obbligatorio: ${ROLES.join(' | ')}.`);
if (givenPw !== undefined && givenPw.length < 12) fail('La password deve avere almeno 12 caratteri.');

const envFile = resolve(process.env.LQ_ENV_FILE ?? '.env');
const credFile = join(dirname(envFile), 'ADMIN-CREDENZIALI.txt');
const envLines = existsSync(envFile) ? readFileSync(envFile, 'utf8').split(/\r?\n/) : [];
const envGet = (key) => envLines.find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1).trim();

const hashPw = (pw) => {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(pw, salt, 64).toString('hex')}`;
};
const randomPw = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const pick = (n) => Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join('');
  return `${pick(5)}-${pick(5)}-${pick(5)}`;
};
const newTotp = () => base32Encode(randomBytes(20));

let users;
try { users = readUsersFile(); } catch (e) { fail(e.message); }
const created = []; // blocks for the credentials file
const now = new Date().toISOString();
let migrated = null;

// Migration of the old single-owner account.
if (users === null) {
  users = [];
  const legacyUser = envGet('ADMIN_USER'), legacyHash = envGet('ADMIN_PASSWORD_HASH');
  if (legacyUser && legacyHash) {
    if (legacyUser === name && role !== 'proprietario') fail(`L'utente "${name}" esiste già come proprietario: usa il ruolo proprietario.`);
    migrated = { user: legacyUser, role: 'proprietario', passwordHash: legacyHash, totpSecret: newTotp(), lastTotpStep: 0, sessionVersion: 0, createdAt: now };
    users.push(migrated);
    created.push({ user: migrated.user, role: migrated.role, password: null, totpSecret: migrated.totpSecret, note: 'migrato dal vecchio accesso: la password non cambia' });
  }
}

if (!(migrated && migrated.user === name)) {
  const pw = givenPw ?? randomPw();
  const existing = users.find((u) => u.user === name);
  // Never demote the last proprietario.
  if (existing?.role === 'proprietario' && role !== 'proprietario' && users.filter((u) => u.role === 'proprietario').length <= 1) fail("Non si può declassare l'ultimo proprietario.");
  const fields = { role, passwordHash: hashPw(pw), totpSecret: newTotp(), lastTotpStep: 0 };
  if (existing) {
    Object.assign(existing, fields, { sessionVersion: (existing.sessionVersion ?? 0) + 1 });
  } else {
    users.push({ user: name, ...fields, sessionVersion: 0, createdAt: now });
  }
  const u = users.find((x) => x.user === name);
  created.push({ user: name, role, password: pw, totpSecret: u.totpSecret, note: existing ? 'ruotato: nuova password e nuova chiave, sessioni chiuse' : 'nuovo utente' });
}

writeUsersFile(users);

// .env: drop the old single-owner keys, keep/create SESSION_SECRET.
const keep = envLines.filter((l) => l && !/^(ADMIN_USER|ADMIN_PASSWORD_HASH)=/.test(l));
const sec = envGet('SESSION_SECRET');
if (!sec || sec.length < 32) {
  const i = keep.findIndex((l) => l.startsWith('SESSION_SECRET='));
  if (i >= 0) keep.splice(i, 1);
  keep.push(`SESSION_SECRET=${randomBytes(48).toString('base64url')}`);
}
writeFileSync(envFile, keep.join('\n') + '\n');

const uri = (user, key) => `otpauth://totp/${encodeURIComponent('LQ Milano')}:${encodeURIComponent(user)}?secret=${key}&issuer=${encodeURIComponent('LQ Milano')}&algorithm=SHA1&digits=6&period=30`;
const out = ['Accesso amministratore LQ Milano', '', 'Indirizzo:  <sito>/admin   (in locale: http://localhost:4321/admin)', ''];
for (const c of created) {
  out.push(`Utente:     ${c.user}  (${c.role}) - ${c.note}`);
  out.push(`Password:   ${c.password ?? '(invariata)'}`);
  out.push(`Chiave TOTP (base32): ${c.totpSecret}`);
  out.push(`Link app:   ${uri(c.user, c.totpSecret)}`, '');
}
out.push("Aggiungi la chiave in un'app di autenticazione (Google Authenticator, Authy, 1Password...).");
out.push('Per ruotare: npm run admin:create -- <utente> <ruolo>');
out.push('Tienila riservata. Questo file non viene caricato su GitHub (.gitignore).', '');
writeFileSync(credFile, out.join('\n'));
console.log(`Fatto: ${created.map((c) => c.user).join(', ')}. Dati in ${USERS_FILE}, credenziali in ${credFile}. Riavvia il server.`);
