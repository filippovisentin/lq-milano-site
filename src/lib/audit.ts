// Append-only audit trail: one JSON object per line, kept for 365 days.
// Logging must never break a request, so every failure is swallowed (and logged).
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from './catalog';

export const AUDIT_FILE = join(DATA_DIR, 'private', 'audit.log');
const KEEP_MS = 365 * 86_400_000;

export function audit(event: string, data: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(AUDIT_FILE), { recursive: true });
    // t and event come last so callers cannot override them.
    appendFileSync(AUDIT_FILE, JSON.stringify({ ...data, t: new Date().toISOString(), event }) + '\n');
  } catch (err) {
    console.error('audit: scrittura non riuscita', err);
  }
}

export function pruneAudit(now = Date.now()): void {
  try {
    if (!existsSync(AUDIT_FILE)) return;
    const cutoff = now - KEEP_MS;
    const lines = readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean);
    const kept = lines.filter((line) => {
      try {
        const t = Date.parse(JSON.parse(line).t);
        return Number.isNaN(t) || t >= cutoff; // keep what we cannot date
      } catch { return true; }
    });
    if (kept.length === lines.length) return;
    const tmp = `${AUDIT_FILE}.tmp`;
    writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '');
    renameSync(tmp, AUDIT_FILE);
  } catch (err) {
    console.error('audit: pulizia non riuscita', err);
  }
}
