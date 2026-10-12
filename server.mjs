// Production entry: run from anywhere, serves the built site + admin.
//   npm run build && npm start      (PORT / HOST env vars, default 4321)
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
if (existsSync('.env')) process.loadEnvFile('.env');
process.env.LQ_PROJECT_ROOT ??= process.cwd();
process.env.HOST ??= '0.0.0.0';
process.env.PORT ??= '4321';
await import('./dist/server/entry.mjs');
