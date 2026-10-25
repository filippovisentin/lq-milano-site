// Removes an admin account (its sessions stop working immediately).
//   npm run admin:remove -- <nome>
// Refuses to remove the last "proprietario".
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
import { readUsersFile, writeUsersFile } from './admin-store.mjs';

const name = process.argv[2];
const fail = (msg) => { console.error(msg); process.exit(1); };
if (!name) fail('Uso: npm run admin:remove -- <nome>');
let users;
try { users = readUsersFile(); } catch (e) { fail(e.message); }
const target = users?.find((u) => u.user === name);
if (!target) fail(`Utente "${name}" non trovato.`);
if (target.role === 'proprietario' && users.filter((u) => u.role === 'proprietario').length <= 1) {
  fail("Non si può rimuovere l'ultimo proprietario.");
}
writeUsersFile(users.filter((u) => u.user !== name));
console.log(`Utente "${name}" rimosso.`);
