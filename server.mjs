// Production entry: run from anywhere, serves the built site + admin.
//   npm run build && npm start      (PORT / HOST env vars, default 4321)
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { securityHeaders } from './security-headers.mjs';

process.chdir(fileURLToPath(new URL('.', import.meta.url)));
if (existsSync('.env')) process.loadEnvFile('.env');
process.env.LQ_PROJECT_ROOT ??= process.cwd();
process.env.HOST ??= '0.0.0.0';
process.env.PORT ??= '4321';

// Every response — pages, static files, media, API — leaves with the security
// headers. Astro's middleware only sees rendered routes; static files are
// served before it, so the headers are applied here, around the whole server.
// HTTPS-only headers (HSTS, upgrade-insecure-requests) only when the request
// really came over HTTPS (directly or via the host's proxy), so a local
// http://localhost run keeps working.
const secureHeaders = securityHeaders(process.env, true);
const plainHeaders = securityHeaders(process.env, false);
const isSecure = (req) => req.socket?.encrypted || String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
for (const mod of [http, https]) {
  const create = mod.createServer;
  mod.createServer = (...args) => {
    const i = args.findIndex((a) => typeof a === 'function');
    if (i >= 0) {
      const listener = args[i];
      args[i] = (req, res) => {
        for (const [k, v] of isSecure(req) ? secureHeaders : plainHeaders) res.setHeader(k, v);
        return listener(req, res);
      };
    }
    return create.apply(mod, args);
  };
}

await import('./dist/server/entry.mjs');
