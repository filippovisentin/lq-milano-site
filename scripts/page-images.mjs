// Pre-renders the page imagery (src/assets/media) to public/img/<stem>-<w>.webp
// so on-demand pages (home, events) serve static files instead of resizing
// photos on every request. Skips files that are already up to date.
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
import sharp from 'sharp';
import { readdirSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, parse } from 'node:path';

const SRC = 'src/assets/media', OUT = 'public/img';
export const WIDTHS = [480, 760, 1100, 1600];
mkdirSync(OUT, { recursive: true });
let n = 0;
for (const f of readdirSync(SRC)) {
  const { name } = parse(f);
  const src = join(SRC, f);
  const meta = await sharp(src).metadata();
  for (const w of WIDTHS) {
    const out = join(OUT, `${name}-${w}.webp`);
    if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue;
    await sharp(src).resize({ width: Math.min(w, meta.width) }).webp({ quality: w >= 1100 ? 80 : 78 }).toFile(out);
    n++;
  }
}
console.log(`page images: ${n} written`);
