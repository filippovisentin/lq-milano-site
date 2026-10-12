// Creates (or rotates) the admin account.
//   npm run admin:create                -> user "lqmilano", random password
//   npm run admin:create -- nome        -> custom user name
//   npm run admin:create -- nome pass   -> custom password (min 12 chars)
// Writes ADMIN_USER, ADMIN_PASSWORD_HASH, SESSION_SECRET into .env (keeps
// other lines) and the plain credentials into ADMIN-CREDENZIALI.txt, both
// git-ignored. Restart the server afterwards.
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { scryptSync, randomBytes, randomInt } from 'node:crypto';

const user = process.argv[2] ?? 'lqmilano';
let pw = process.argv[3];
if (!pw) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const pick = (n) => Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join('');
  pw = `${pick(5)}-${pick(5)}-${pick(5)}`;
}
if (pw.length < 12) { console.error('La password deve avere almeno 12 caratteri.'); process.exit(1); }

const salt = randomBytes(16).toString('hex');
const hash = `scrypt$${salt}$${scryptSync(pw, salt, 64).toString('hex')}`;
const lines = existsSync('.env') ? readFileSync('.env', 'utf8').split(/\r?\n/) : [];
const keep = lines.filter((l) => l && !/^(ADMIN_USER|ADMIN_PASSWORD_HASH|SESSION_SECRET)=/.test(l));
keep.push(`ADMIN_USER=${user}`, `ADMIN_PASSWORD_HASH=${hash}`, `SESSION_SECRET=${randomBytes(48).toString('base64url')}`);
writeFileSync('.env', keep.join('\n') + '\n');
writeFileSync('ADMIN-CREDENZIALI.txt', [
  'Accesso amministratore LQ Milano',
  '',
  `Indirizzo:  <sito>/admin   (in locale: http://localhost:4321/admin)`,
  `Utente:     ${user}`,
  `Password:   ${pw}`,
  '',
  'Tienila riservata. Per cambiarla: npm run admin:create -- <utente> <nuova-password>',
  'Questo file non viene caricato su GitHub (.gitignore).',
  '',
].join('\n'));
console.log(`Amministratore "${user}" creato. Credenziali in ADMIN-CREDENZIALI.txt`);
