// Generates the assets for the rotating 3D product view from ordinary photos.
//
// For every product in src/content/products it picks a front and a back shot
// on a light, plain background (or uses `model3d.front` / `model3d.back` from
// the entry), cuts the garment out, and derives a depth map from the
// silhouette (distance to the edge -> a soft "pillow" volume). The viewer
// (src/scripts/garment-viewer.js) displaces two meshes with these maps.
//
// Output: public/3d/<slug>/{front,back}.webp, {front,back}-depth.png, meta.json
// Runs automatically before `npm run build` and `npm run dev`; only products
// whose source images changed are regenerated.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url))); // run from anywhere
import { parse as parseYaml } from 'yaml';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';

const CONTENT = 'src/content/products';
const OUT = 'public/3d';
const TEX = 1024; // texture long edge
const DEPTH = 256; // depth map long edge
const ANALYSE = 400; // analysis resolution

const force = process.argv.includes('--force');

function frontmatter(file) {
  const src = readFileSync(file, 'utf8');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? parseYaml(m[1]) : {};
}

function isBg(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return min > 212 && max - min < 28;
}

async function analyse(path) {
  const { data, info } = await sharp(path).resize(ANALYSE, ANALYSE, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let white = 0, total = 0;
  const px = (x, y) => (y * w + x) * 3;
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) { const i = px(x, y); total++; if (isBg(data[i], data[i + 1], data[i + 2])) white++; }
  for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) { const i = px(x, y); total++; if (isBg(data[i], data[i + 1], data[i + 2])) white++; }
  return { score: white / total, w, h };
}

// Background = light pixels connected to the image border (so white details
// inside the garment survive).
function cutMask(data, w, h) {
  const bg = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const k = y * w + x;
    if (bg[k]) return;
    const i = k * 3;
    if (!isBg(data[i], data[i + 1], data[i + 2])) return;
    bg[k] = 1; stack.push(k);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const k = stack.pop(), x = k % w, y = (k / w) | 0;
    if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
  }
  // keep the largest foreground component
  const mask = new Uint8Array(w * h);
  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, cur = 0;
  for (let s = 0; s < w * h; s++) {
    if (bg[s] || label[s] !== -1) continue;
    let size = 0; stack.push(s); label[s] = cur;
    while (stack.length) {
      const k = stack.pop(); size++;
      const x = k % w, y = (k / w) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (!bg[n] && label[n] === -1) { label[n] = cur; stack.push(n); }
      }
    }
    if (size > bestSize) { bestSize = size; best = cur; }
    cur++;
  }
  for (let k = 0; k < w * h; k++) mask[k] = label[k] === best ? 1 : 0;
  return { mask, area: bestSize / (w * h) };
}

// Two-pass chamfer distance to the nearest background pixel.
function distance(mask, w, h) {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) d[k] = mask[k] ? INF : 0;
  const a = 1, b = Math.SQRT2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x; if (!d[k]) continue;
    let v = d[k];
    if (x > 0) v = Math.min(v, d[k - 1] + a); else v = Math.min(v, a);
    if (y > 0) v = Math.min(v, d[k - w] + a); else v = Math.min(v, a);
    if (x > 0 && y > 0) v = Math.min(v, d[k - w - 1] + b);
    if (x < w - 1 && y > 0) v = Math.min(v, d[k - w + 1] + b);
    d[k] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const k = y * w + x; if (!d[k]) continue;
    let v = d[k];
    if (x < w - 1) v = Math.min(v, d[k + 1] + a); else v = Math.min(v, a);
    if (y < h - 1) v = Math.min(v, d[k + w] + a); else v = Math.min(v, a);
    if (x < w - 1 && y < h - 1) v = Math.min(v, d[k + w + 1] + b);
    if (x > 0 && y < h - 1) v = Math.min(v, d[k + w - 1] + b);
    d[k] = v;
  }
  return d;
}

function bbox(mask, w, h) {
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

// Cut one photo to a square-padded RGBA texture + depth map, framed by `frame`
// (a bbox in normalised 0..1 units shared by front and back so they align).
async function side(path, mirror) {
  const meta = await sharp(path).metadata();
  const scale = 1400 / Math.max(meta.width, meta.height);
  const W = Math.round(meta.width * scale), H = Math.round(meta.height * scale);
  let img = sharp(path).resize(W, H).removeAlpha();
  if (mirror) img = img.flop();
  const { data } = await img.raw().toBuffer({ resolveWithObject: true });
  const { mask, area } = cutMask(data, W, H);
  const box = bbox(mask, W, H);
  return { data, mask, W, H, box, area };
}

async function render(s, frame, outBase) {
  // frame: { cx, cy (garment centre), size (square side in px of this image) }
  const { data, mask, W, H } = s;
  const half = frame.size / 2;
  const left = Math.round(s.cx - half), top = Math.round(s.cy - half), size = Math.round(frame.size);
  const rgba = Buffer.alloc(size * size * 4);
  const m = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = x + left, sy = y + top, o = (y * size + x) * 4;
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    const k = sy * W + sx, i = k * 3;
    rgba[o] = data[i]; rgba[o + 1] = data[i + 1]; rgba[o + 2] = data[i + 2];
    rgba[o + 3] = mask[k] ? 255 : 0; m[y * size + x] = mask[k];
  }
  // soften the cut edge by one pixel
  const tex = await sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
    .resize(TEX, TEX).webp({ quality: 88, alphaQuality: 90 }).toBuffer();
  writeFileSync(outBase + '.webp', tex);

  // depth on a reduced grid
  const dm = await sharp(Buffer.from(m.map((v) => v * 255)), { raw: { width: size, height: size, channels: 1 } })
    .resize(DEPTH, DEPTH).extractChannel(0).raw().toBuffer();
  const small = new Uint8Array(DEPTH * DEPTH);
  for (let k = 0; k < small.length; k++) small[k] = dm[k] > 127 ? 1 : 0;
  const dist = distance(small, DEPTH, DEPTH);
  let max = 0; for (const v of dist) if (v > max) max = v;
  const cap = Math.max(4, max * 0.55); // flatten wide torsos into a plateau
  const out = Buffer.alloc(DEPTH * DEPTH);
  for (let k = 0; k < out.length; k++) {
    const t = Math.min(1, Math.max(0, dist[k] - 1) / cap); // 0 on the silhouette edge: front and back meet
    out[k] = Math.round(255 * Math.sqrt(1 - (1 - t) * (1 - t))); // circular pillow profile
  }
  const depth = await sharp(out, { raw: { width: DEPTH, height: DEPTH, channels: 1 } }).blur(1.6).png().toBuffer();
  writeFileSync(outBase + '-depth.png', depth);
}

const files = readdirSync(CONTENT).filter((f) => f.endsWith('.md'));
let built = 0, skipped = 0;
const report = [];
for (const f of files) {
  const file = join(CONTENT, f);
  const fm = frontmatter(file);
  const slug = fm.slug ?? basename(f, '.md');
  if (fm.model3d?.disabled) { report.push(`${slug}: disabled`); continue; }
  const images = (fm.images ?? []).map((p) => resolve(dirname(file), p));
  if (!images.length) continue;

  let front = fm.model3d?.front ? resolve(dirname(file), fm.model3d.front) : null;
  let back = fm.model3d?.back ? resolve(dirname(file), fm.model3d.back) : null;
  if (!front || !back) {
    const scored = [];
    for (const p of images) scored.push({ p, ...(await analyse(p)) });
    const plain = scored.filter((s) => s.score > 0.85 && s.h >= s.w * 0.9);
    front ??= plain[0]?.p;
    back ??= plain.find((s) => s.p !== front)?.p ?? null;
  }
  if (!front) { report.push(`${slug}: no plain-background photo, 3D skipped`); continue; }

  const dir = join(OUT, slug);
  const metaFile = join(dir, 'meta.json');
  const stamp = [front, back].filter(Boolean).map((p) => `${basename(p)}@${statSync(p).mtimeMs}`).join('|');
  if (!force && existsSync(metaFile) && JSON.parse(readFileSync(metaFile, 'utf8')).stamp === stamp) { skipped++; continue; }
  mkdirSync(dir, { recursive: true });

  const F = await side(front, false);
  const B = back ? await side(back, false) : null;
  // centre each garment on its own bbox; size so the taller garment fits with 6% margin
  for (const s of [F, B].filter(Boolean)) {
    s.cx = (s.box.x0 + s.box.x1) / 2; s.cy = (s.box.y0 + s.box.y1) / 2;
    s.extent = Math.max(s.box.x1 - s.box.x0, s.box.y1 - s.box.y0);
  }
  // scale the back so its silhouette height matches the front
  await render(F, { size: F.extent * 1.06 }, join(dir, 'front'));
  if (B) await render(B, { size: B.extent * 1.06 }, join(dir, 'back'));

  writeFileSync(metaFile, JSON.stringify({ stamp, front: basename(front), back: back ? basename(back) : null, hasBack: !!B }, null, 2));
  built++;
  report.push(`${slug}: front=${basename(front).slice(7, 15)} back=${back ? basename(back).slice(7, 15) : '—'} area=${F.area.toFixed(2)}`);
}
console.log(report.join('\n'));
console.log(`3D assets: ${built} built, ${skipped} up to date`);
