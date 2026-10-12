// Converts the downloaded Wix masters (../media-masters) into high-quality
// working masters in src/assets/media (max 2400px long edge, WebP q90).
// Astro then derives responsive srcset variants from these at build time.
// Run from site/:  node scripts/normalize-media.mjs
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url))); // run from anywhere
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, parse } from 'node:path';

const SRC = '../media-masters';
const DEST = 'src/assets/media';
mkdirSync(DEST, { recursive: true });

const files = readdirSync(SRC);
let done = 0;
for (const f of files) {
  const out = join(DEST, parse(f).name + '.webp');
  if (existsSync(out)) continue;
  const img = sharp(join(SRC, f), { limitInputPixels: false }).rotate();
  const meta = await img.metadata();
  const long = Math.max(meta.width, meta.height);
  await img
    .resize(long > 2400 ? { width: meta.width >= meta.height ? 2400 : undefined, height: meta.height > meta.width ? 2400 : undefined } : undefined)
    .webp({ quality: 90, alphaQuality: 100, effort: 5 })
    .toFile(out);
  done++;
}
console.log(`${done} converted, ${files.length} masters`);
