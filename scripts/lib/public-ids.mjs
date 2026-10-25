// Ids of the products that may appear on the public static copy: drafts are skipped.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function publicProductIds(dataDir) {
  const dir = join(dataDir, 'products');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !JSON.parse(readFileSync(join(dir, f), 'utf8')).draft)
    .map((f) => f.slice(0, -5));
}

// Ids of the drafts, whose photos and 3D files must not be copied either.
export function draftProductIds(dataDir) {
  const pub = new Set(publicProductIds(dataDir));
  const dir = join(dataDir, 'products');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => !pub.has(id));
}
