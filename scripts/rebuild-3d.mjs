// Rebuilds every product's 3D model from data/ (after changing the algorithm).
// Run from site/: npm run 3d:all
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGarment3D } from './lib/garment3d.mjs';
for (const f of readdirSync('data/products').filter((f) => f.endsWith('.json'))) {
  const p = JSON.parse(readFileSync(join('data/products', f), 'utf8'));
  if (p.model3d.disabled) continue;
  const img = (i) => (i === null || i === undefined ? null : join('data/uploads/products', p.slug, `${p.images[i].id}.webp`));
  const meta = await buildGarment3D({ front: img(p.model3d.front), back: img(p.model3d.back), outDir: join('data/3d', p.slug), tolerance: p.model3d.tolerance });
  Object.assign(p.model3d, { version: meta.version, hasBack: meta.hasBack });
  writeFileSync(join('data/products', f), JSON.stringify(p, null, 2));
  console.log('3d', p.slug);
}
