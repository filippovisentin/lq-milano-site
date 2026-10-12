// Garment 3D builder: two ordinary photos (front + back) -> assets for the
// rotating viewer (src/scripts/garment-viewer.ts).
//
// Pipeline
//  1. Background: estimated from the photo border (works on white, grey,
//     cream...), removed by flood-fill from the edges so light details inside
//     the garment survive. `tolerance` tunes how aggressive this is.
//  2. Mask clean-up: largest component, holes filled, 1px erosion against the
//     white halo, smoothed outline.
//  3. ONE silhouette for both sides: the front outline is used for the back as
//     well (mirrored), and the back photo is fitted into it. Front and back
//     therefore meet exactly on the edge -> a closed volume, no slivers.
//  4. Depth from the silhouette (distance to the edge, rounded "pillow"
//     profile + gentle dome), zero on the outline.
//
// Output in outDir: front.webp, back.webp (RGBA, TEX px square),
// depth.png (grey, DEPTH px), meta.json.
import sharp from 'sharp';
// no file-handle cache: on Windows it keeps photos locked and blocks deleting them
sharp.cache(false);
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEX = 1024;
const DEPTH = 256;
const WORK = 900; // working resolution for segmentation

async function load(path) {
  const img = sharp(path, { limitInputPixels: false }).rotate();
  const meta = await img.metadata();
  const s = WORK / Math.max(meta.width, meta.height);
  const W = Math.max(1, Math.round(meta.width * s)), H = Math.max(1, Math.round(meta.height * s));
  const { data } = await sharp(path, { limitInputPixels: false }).rotate().resize(W, H).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W, H };
}

function borderColour(data, W, H) {
  const rs = [], gs = [], bs = [];
  const add = (x, y) => { const i = (y * W + x) * 3; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); };
  for (let x = 0; x < W; x += 2) { add(x, 0); add(x, 1); add(x, H - 1); add(x, H - 2); }
  for (let y = 0; y < H; y += 2) { add(0, y); add(1, y); add(W - 1, y); add(W - 2, y); }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

/** How "plain" the background is (0..1): share of border pixels close to the border median. */
export async function plainness(path) {
  const { data, W, H } = await load(path);
  const bg = borderColour(data, W, H);
  let ok = 0, n = 0;
  const test = (x, y) => { const i = (y * W + x) * 3; n++; if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < 60) ok++; };
  for (let x = 0; x < W; x += 3) { test(x, 0); test(x, H - 1); }
  for (let y = 0; y < H; y += 3) { test(0, y); test(W - 1, y); }
  const lum = (bg[0] + bg[1] + bg[2]) / 3;
  return { score: ok / n, lum, portrait: H >= W * 0.9 };
}

function segment({ data, W, H }, tolerance) {
  const bg = borderColour(data, W, H);
  const tol = tolerance * 3;
  const isBg = (k) => {
    const i = k * 3;
    return Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < tol;
  };
  const N = W * H;
  const back = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const push = (k) => { if (!back[k] && isBg(k)) { back[k] = 1; stack[sp++] = k; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) {
    const k = stack[--sp], x = k % W;
    if (x > 0) push(k - 1);
    if (x < W - 1) push(k + 1);
    if (k >= W) push(k - W);
    if (k < N - W) push(k + W);
  }
  // largest foreground component
  const label = new Int32Array(N).fill(-1);
  let best = -1, bestSize = 0, cur = 0;
  for (let s = 0; s < N; s++) {
    if (back[s] || label[s] !== -1) continue;
    let size = 0; sp = 0; stack[sp++] = s; label[s] = cur;
    while (sp) {
      const k = stack[--sp]; size++;
      const x = k % W;
      const nb = [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, k >= W ? k - W : -1, k < N - W ? k + W : -1];
      for (const n of nb) if (n >= 0 && !back[n] && label[n] === -1) { label[n] = cur; stack[sp++] = n; }
    }
    if (size > bestSize) { bestSize = size; best = cur; }
    cur++;
  }
  const mask = new Uint8Array(N);
  for (let k = 0; k < N; k++) mask[k] = label[k] === best ? 1 : 0;
  // fill holes: background regions not connected to the border are garment
  // (already true: only border-connected pixels were removed)
  // erode 1px against the halo
  const er = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const k = y * W + x;
    er[k] = mask[k] && mask[k - 1] && mask[k + 1] && mask[k - W] && mask[k + W] ? 1 : 0;
  }
  return { mask: er, area: bestSize / N };
}

function bbox(mask, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function distance(mask, W, H) {
  const INF = 1e9, d = new Float32Array(W * H), a = 1, b = Math.SQRT2;
  for (let k = 0; k < W * H; k++) d[k] = mask[k] ? INF : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x; if (!d[k]) continue;
    let v = d[k];
    v = Math.min(v, x > 0 ? d[k - 1] + a : a, y > 0 ? d[k - W] + a : a);
    if (x > 0 && y > 0) v = Math.min(v, d[k - W - 1] + b);
    if (x < W - 1 && y > 0) v = Math.min(v, d[k - W + 1] + b);
    d[k] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const k = y * W + x; if (!d[k]) continue;
    let v = d[k];
    v = Math.min(v, x < W - 1 ? d[k + 1] + a : a, y < H - 1 ? d[k + W] + a : a);
    if (x < W - 1 && y < H - 1) v = Math.min(v, d[k + W + 1] + b);
    if (x > 0 && y < H - 1) v = Math.min(v, d[k + W - 1] + b);
    d[k] = v;
  }
  return d;
}

// Fill transparent pixels with colours bled from the nearest opaque ones
// (so the back photo never shows background inside the shared silhouette).
function bleed(rgba, S, passes = 14) {
  const out = Buffer.from(rgba);
  let known = new Uint8Array(S * S);
  let mr = 0, mg = 0, mb = 0, mn = 0;
  for (let k = 0; k < S * S; k++) {
    known[k] = rgba[k * 4 + 3] > 0 ? 1 : 0;
    if (known[k]) { mr += rgba[k * 4]; mg += rgba[k * 4 + 1]; mb += rgba[k * 4 + 2]; mn++; }
  }
  for (let pass = 0; pass < passes; pass++) {
    const next = known.slice();
    let changed = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const k = y * S + x; if (known[k]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const j = ny * S + nx;
        if (known[j]) { r += out[j * 4]; g += out[j * 4 + 1]; b += out[j * 4 + 2]; n++; }
      }
      if (n) { out[k * 4] = r / n; out[k * 4 + 1] = g / n; out[k * 4 + 2] = b / n; next[k] = 1; changed++; }
    }
    known = next;
    if (!changed) break;
  }
  // anything still unknown (far from the garment) gets the mean colour
  if (mn) for (let k = 0; k < S * S; k++) if (!known[k]) { out[k * 4] = mr / mn; out[k * 4 + 1] = mg / mn; out[k * 4 + 2] = mb / mn; }
  return out;
}

/**
 * @param {{ front: string, back?: string|null, outDir: string, tolerance?: number }} o
 */
export async function buildGarment3D({ front, back = null, outDir, tolerance = 22 }) {
  mkdirSync(outDir, { recursive: true });
  const F = await load(front);
  const fs = segment(F, tolerance);
  if (fs.area < 0.04) throw new Error('Sagoma non trovata: usa una foto con sfondo uniforme o alza la sensibilità.');
  const fb = bbox(fs.mask, F.W, F.H);

  // square frame around the front garment, 5% margin
  const side = Math.round(Math.max(fb.w, fb.h) * 1.1);
  const ox = Math.round((fb.x0 + fb.x1) / 2 - side / 2), oy = Math.round((fb.y0 + fb.y1) / 2 - side / 2);
  const S = TEX;
  const sc = side / S;

  // front texture + shared mask on the TEX grid (nearest sampling of the mask,
  // bilinear colour via a resized crop)
  const ext = { left: ox, top: oy, width: side, height: side };
  const pad = (img, W, H) => {
    const left = Math.max(0, -ext.left), top = Math.max(0, -ext.top);
    const right = Math.max(0, ext.left + side - W), bottom = Math.max(0, ext.top + side - H);
    // two passes: sharp would otherwise apply extract before extend
    return sharp(img, { raw: { width: W, height: H, channels: 3 } })
      .extend({ left, top, right, bottom, background: '#ffffff' })
      .raw().toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
        .extract({ left: ext.left + left, top: ext.top + top, width: side, height: side })
        .resize(S, S).removeAlpha().raw().toBuffer());
  };
  const fRGB = await pad(F.data, F.W, F.H);
  const mask = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const sx = Math.floor(ox + (x + 0.5) * sc), sy = Math.floor(oy + (y + 0.5) * sc);
    mask[y * S + x] = sx >= 0 && sy >= 0 && sx < F.W && sy < F.H ? fs.mask[sy * F.W + sx] : 0;
  }
  // smooth the outline a touch
  const soft = await sharp(Buffer.from(mask.map((v) => v * 255)), { raw: { width: S, height: S, channels: 1 } }).blur(1.2).extractChannel(0).raw().toBuffer();
  const frontRGBA = Buffer.alloc(S * S * 4);
  for (let k = 0; k < S * S; k++) {
    frontRGBA[k * 4] = fRGB[k * 3]; frontRGBA[k * 4 + 1] = fRGB[k * 3 + 1]; frontRGBA[k * 4 + 2] = fRGB[k * 3 + 2];
    frontRGBA[k * 4 + 3] = soft[k] > 127 ? 255 : 0;
  }
  // bleed colours past the edge (no white fringe from texture filtering), keep the hard alpha
  const fBled = bleed(frontRGBA, S);
  for (let k = 0; k < S * S; k++) fBled[k * 4 + 3] = frontRGBA[k * 4 + 3];
  await sharp(fBled, { raw: { width: S, height: S, channels: 4 } }).webp({ quality: 90, alphaQuality: 100 }).toFile(join(outDir, 'front.webp'));

  // back: fit the back garment's bbox onto the MIRRORED front bbox, alpha = mirrored front mask
  let hasBack = false;
  {
    const backMask = new Uint8Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) backMask[y * S + x] = frontRGBA[(y * S + (S - 1 - x)) * 4 + 3] ? 1 : 0;
    let backRGB;
    if (back) {
      const B = await load(back);
      const bs = segment(B, tolerance);
      if (bs.area >= 0.04) {
        hasBack = true;
        const bb = bbox(bs.mask, B.W, B.H);
        // Row-wise warp: each row of the target silhouette (mirrored front)
        // takes the matching row of the back photo, stretched edge to edge,
        // so shoulders, sleeves and hem line up with the outline.
        const ty0 = (fb.y0 - oy) / sc, ty1 = (fb.y1 - oy) / sc;
        const srcRow = (sy) => {
          let l = -1, r = -1;
          for (let x = 0; x < B.W; x++) if (bs.mask[sy * B.W + x]) { if (l < 0) l = x; r = x; }
          return [l, r];
        };
        const rows = Array.from({ length: B.H }, (_, sy) => srcRow(sy));
        const nearestRow = (sy) => {
          for (let d = 0; d < B.H; d++) {
            if (sy - d >= 0 && rows[sy - d][0] >= 0) return sy - d;
            if (sy + d < B.H && rows[sy + d][0] >= 0) return sy + d;
          }
          return -1;
        };
        const rgba = Buffer.alloc(S * S * 4);
        for (let y = 0; y < S; y++) {
          let L = -1, R = -1;
          for (let x = 0; x < S; x++) if (backMask[y * S + x]) { if (L < 0) L = x; R = x; }
          if (L < 0) continue;
          const v = Math.min(1, Math.max(0, (y - ty0) / Math.max(1, ty1 - ty0)));
          const sy = nearestRow(Math.round(bb.y0 + v * (bb.h - 1)));
          if (sy < 0) continue;
          const [sl, sr] = rows[sy];
          for (let x = L; x <= R; x++) {
            if (!backMask[y * S + x]) continue;
            const u = R > L ? (x - L) / (R - L) : 0.5;
            const sx = Math.round(sl + u * (sr - sl));
            const k = sy * B.W + sx;
            const o = (y * S + x) * 4, i = k * 3;
            rgba[o] = B.data[i]; rgba[o + 1] = B.data[i + 1]; rgba[o + 2] = B.data[i + 2]; rgba[o + 3] = bs.mask[k] ? 255 : 0;
          }
        }
        backRGB = bleed(rgba, S);
      }
    }
    if (!backRGB) {
      // no usable back photo: mirrored front, slightly darker
      backRGB = Buffer.alloc(S * S * 4);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const o = (y * S + x) * 4, i = (y * S + (S - 1 - x)) * 4;
        backRGB[o] = frontRGBA[i] * 0.82; backRGB[o + 1] = frontRGBA[i + 1] * 0.82; backRGB[o + 2] = frontRGBA[i + 2] * 0.82;
      }
    }
    for (let k = 0; k < S * S; k++) backRGB[k * 4 + 3] = backMask[k] ? 255 : 0;
    // light smoothing of the nearest-neighbour fit
    const smooth = await sharp(backRGB, { raw: { width: S, height: S, channels: 4 } }).blur(0.6).raw().toBuffer();
    for (let k = 0; k < S * S; k++) smooth[k * 4 + 3] = backMask[k] ? 255 : 0;
    await sharp(smooth, { raw: { width: S, height: S, channels: 4 } }).webp({ quality: 88, alphaQuality: 100 }).toFile(join(outDir, 'back.webp'));
  }

  // depth (front orientation; the viewer mirrors it for the back)
  const small = await sharp(Buffer.from(Array.from({ length: S * S }, (_, k) => frontRGBA[k * 4 + 3])), { raw: { width: S, height: S, channels: 1 } })
    .resize(DEPTH, DEPTH).extractChannel(0).raw().toBuffer();
  const m = new Uint8Array(DEPTH * DEPTH);
  for (let k = 0; k < m.length; k++) m[k] = small[k] > 127 ? 1 : 0;
  const dist = distance(m, DEPTH, DEPTH);
  let max = 0; for (const v of dist) if (v > max) max = v;
  const r = Math.max(3, max * 0.8);
  // global dome so the torso is never a flat slab
  const db = bbox(m, DEPTH, DEPTH);
  const cx = (db.x0 + db.x1) / 2, cy = (db.y0 + db.y1) / 2, rx = db.w / 2 || 1, ry = db.h / 2 || 1;
  const out = Buffer.alloc(DEPTH * DEPTH);
  for (let y = 0; y < DEPTH; y++) for (let x = 0; x < DEPTH; x++) {
    const k = y * DEPTH + x;
    if (!m[k]) { out[k] = 0; continue; }
    const t = Math.min(1, Math.max(0, dist[k] - 0.5) / r);
    const pillow = Math.sqrt(1 - (1 - t) * (1 - t));
    const dd = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    const dome = Math.max(0, 1 - dd) ** 0.5;
    out[k] = Math.round(255 * Math.min(1, pillow * (0.72 + 0.28 * dome)));
  }
  await sharp(out, { raw: { width: DEPTH, height: DEPTH, channels: 1 } }).blur(1.4).png().toFile(join(outDir, 'depth.png'));

  const meta = { version: Date.now(), hasBack, tolerance, area: Number(fs.area.toFixed(3)) };
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

/** Pick front/back among a product's photos: the first two with a plain background. */
export async function pickPair(paths) {
  const scored = [];
  for (const p of paths) scored.push({ p, ...(await plainness(p)) });
  const plain = scored.filter((s) => s.score > 0.8 && s.portrait);
  return { front: plain[0]?.p ?? paths[0], back: plain[1]?.p ?? null };
}
