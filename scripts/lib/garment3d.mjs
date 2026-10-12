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

// Neck opening: the valley in the upper outline between the two collar points
// ("rain water" filling of the top envelope). Only shallow valleys in the top
// part of the garment count, so gaps between legs or panels are never closed.
function neckFill(mask, S) {
  const top = new Int32Array(S).fill(S);
  for (let x = 0; x < S; x++) for (let y = 0; y < S; y++) if (mask[y * S + x]) { top[x] = y; break; }
  const b = bbox(mask, S, S);
  const maxDepth = b.h * 0.5; // deep V of a blazer included
  const hl = new Int32Array(S), hr = new Int32Array(S);
  let m = S; for (let x = 0; x < S; x++) { m = Math.min(m, top[x]); hl[x] = m; }
  m = S; for (let x = S - 1; x >= 0; x--) { m = Math.min(m, top[x]); hr[x] = m; }
  const fill = new Uint8Array(S * S);
  let n = 0;
  const level = (x) => Math.max(hl[x], hr[x]);
  // each valley (run of columns below the water line) is filled when it is
  // shallow (a neckline) or narrow (the slit between two lapels)
  for (let x = b.x0; x <= b.x1; x++) {
    if (top[x] <= level(x)) continue;
    let e = x; while (e + 1 <= b.x1 && top[e + 1] > level(e + 1)) e++;
    let deep = 0;
    for (let c = x; c <= e; c++) deep = Math.max(deep, top[c] - level(c));
    const narrow = e - x + 1 <= b.w * 0.07;
    if ((deep <= maxDepth || (narrow && deep <= b.h * 0.65)) && level(x) <= b.y0 + b.h * 0.25) {
      for (let c = x; c <= e; c++) for (let y = level(c); y < Math.min(top[c], S); y++) { fill[y * S + c] = 1; n++; }
    }
    x = e;
  }
  return { fill, n };
}

// Runs of foreground along one row, ignoring specks narrower than `min`.
function runs(mask, W, y, min = 3) {
  const out = [];
  let s = -1;
  for (let x = 0; x <= W; x++) {
    const on = x < W && mask[y * W + x];
    if (on && s < 0) s = x;
    if (!on && s >= 0) { if (x - s >= min) out.push([s, x - 1]); s = -1; }
  }
  return out;
}

// Outer contour of the largest shape (Moore-neighbour tracing), clockwise in
// image coordinates, as [x, y] points.
function contour(mask, W, H) {
  let s = -1;
  for (let k = 0; k < W * H && s < 0; k++) if (mask[k]) s = k;
  if (s < 0) return [];
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
  const pts = [];
  let x = s % W, y = (s / W) | 0, d = 6; // came from above
  const sx = x, sy = y;
  for (let guard = 0; guard < W * H * 4; guard++) {
    pts.push([x, y]);
    let found = false;
    for (let i = 0; i < 8; i++) {
      const nd = (d + 6 + i) % 8; // start looking back-left of the last move
      const nx = x + dirs[nd][0], ny = y + dirs[nd][1];
      if (on(nx, ny)) { x = nx; y = ny; d = nd; found = true; break; }
    }
    if (!found || (x === sx && y === sy)) break;
  }
  return pts;
}

// Thin-plate spline through control points src[i] -> dst[i] (2D), smoothed by
// `lambda`. Returns f(x, y) -> [x', y'].
function tps(src, dst, lambda = 1e-3) {
  const n = src.length, M = n + 3;
  const U = (r2) => (r2 > 0 ? r2 * Math.log(r2) * 0.5 : 0);
  // normalise coordinates for conditioning
  let mx = 0, my = 0, sc = 0;
  for (const [x, y] of src) { mx += x; my += y; }
  mx /= n; my /= n;
  for (const [x, y] of src) sc = Math.max(sc, Math.abs(x - mx), Math.abs(y - my));
  sc = sc || 1;
  const P = src.map(([x, y]) => [(x - mx) / sc, (y - my) / sc]);
  const A = Array.from({ length: M }, () => new Float64Array(M));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = U((P[i][0] - P[j][0]) ** 2 + (P[i][1] - P[j][1]) ** 2);
    A[i][i] += lambda;
    A[i][n] = A[n][i] = 1;
    A[i][n + 1] = A[n + 1][i] = P[i][0];
    A[i][n + 2] = A[n + 2][i] = P[i][1];
  }
  const solve = (b) => {
    // Gaussian elimination with partial pivoting
    const a = A.map((r) => Float64Array.from(r)), v = Float64Array.from(b);
    for (let c = 0; c < M; c++) {
      let p = c;
      for (let r = c + 1; r < M; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      [a[c], a[p]] = [a[p], a[c]]; [v[c], v[p]] = [v[p], v[c]];
      const d = a[c][c] || 1e-12;
      for (let r = c + 1; r < M; r++) {
        const f = a[r][c] / d;
        if (!f) continue;
        for (let k = c; k < M; k++) a[r][k] -= f * a[c][k];
        v[r] -= f * v[c];
      }
    }
    const x = new Float64Array(M);
    for (let r = M - 1; r >= 0; r--) {
      let s = v[r];
      for (let k = r + 1; k < M; k++) s -= a[r][k] * x[k];
      x[r] = s / (a[r][r] || 1e-12);
    }
    return x;
  };
  const wx = solve([...dst.map((d) => d[0]), 0, 0, 0]);
  const wy = solve([...dst.map((d) => d[1]), 0, 0, 0]);
  return (x, y) => {
    const qx = (x - mx) / sc, qy = (y - my) / sc;
    let ox = wx[n] + wx[n + 1] * qx + wx[n + 2] * qy, oy = wy[n] + wy[n + 1] * qx + wy[n + 2] * qy;
    for (let i = 0; i < n; i++) {
      const u = U((qx - P[i][0]) ** 2 + (qy - P[i][1]) ** 2);
      ox += wx[i] * u; oy += wy[i] * u;
    }
    return [ox, oy];
  };
}

// Corresponding points along two outlines: both split at the same four
// landmarks (top centre, right-most, bottom centre, left-most) and resampled
// per quarter, so a longer sleeve on one photo does not drag everything else.
function landmarks(pts, b) {
  const near = (tx, ty) => { let i0 = 0, best = Infinity; pts.forEach(([x, y], i) => { const d = (x - tx) ** 2 + (y - ty) ** 2; if (d < best) { best = d; i0 = i; } }); return i0; };
  const cx = (b.x0 + b.x1) / 2;
  return [near(cx, b.y0), near(b.x1, (b.y0 + b.y1) / 2), near(cx, b.y1), near(b.x0, (b.y0 + b.y1) / 2)];
}
function correspond(pts, b, per) {
  const idx = landmarks(pts, b), out = [];
  for (let q = 0; q < 4; q++) {
    const a = idx[q], z = idx[(q + 1) % 4];
    const seg = a <= z ? pts.slice(a, z + 1) : [...pts.slice(a), ...pts.slice(0, z + 1)];
    if (seg.length < 2) { for (let i = 0; i < per; i++) out.push(pts[a]); continue; }
    const cum = [0];
    for (let i = 1; i < seg.length; i++) cum.push(cum[i - 1] + Math.hypot(seg[i][0] - seg[i - 1][0], seg[i][1] - seg[i - 1][1]));
    const L = cum[cum.length - 1];
    let j = 0;
    for (let i = 0; i < per; i++) {
      const t = (L * i) / per;
      while (j < cum.length - 2 && cum[j + 1] < t) j++;
      const f = (t - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
      out.push([seg[j][0] + f * (seg[j + 1][0] - seg[j][0]), seg[j][1] + f * (seg[j + 1][1] - seg[j][1])]);
    }
  }
  return out;
}

// Back photo -> target silhouette (S x S RGBA, alpha = source foreground).
// Two strategies, best one kept:
//  - thin-plate spline: outlines matched point by point, every pixel carried
//    by one smooth 2D map (no seams). Tried from loose to stiff; a map that
//    folds over itself or misses the garment is rejected.
//  - row warp (fallback): each target row takes the matching back-photo row,
//    edge to edge, spans median-smoothed. Never folds, may show steps.
function warpBack(B, bs, bb, backMask, S) {
  const px = (x, y, c) => B.data[(y * B.W + x) * 3 + c];
  const render = (mapAt) => {
    const rgba = Buffer.alloc(S * S * 4);
    let n = 0, hit = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (!backMask[y * S + x]) continue;
      n++;
      const [fx, fy] = mapAt(x, y);
      if (!(fx >= 0 && fy >= 0 && fx <= B.W - 1 && fy <= B.H - 1)) continue;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(B.W - 1, x0 + 1), y1 = Math.min(B.H - 1, y0 + 1);
      const wx = fx - x0, wy = fy - y0, o = (y * S + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = px(x0, y0, c) * (1 - wx) + px(x1, y0, c) * wx;
        const bot = px(x0, y1, c) * (1 - wx) + px(x1, y1, c) * wx;
        rgba[o + c] = Math.round(top * (1 - wy) + bot * wy);
      }
      if (bs.mask[Math.round(fy) * B.W + Math.round(fx)]) { rgba[o + 3] = 255; hit++; }
    }
    return { rgba, coverage: n ? hit / n : 0 };
  };

  // --- row warp
  const tb = bbox(backMask, S, S);
  const srcRuns = Array.from({ length: B.H }, (_, sy) => runs(bs.mask, B.W, sy));
  const span = srcRuns.map((r) => (r.length ? [r[0][0], r[r.length - 1][1]] : null));
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  const smooth = span.map((s, sy) => {
    if (!s) return null;
    const ls = [], rs = [];
    for (let d = -4; d <= 4; d++) { const t = span[sy + d]; if (t) { ls.push(t[0]); rs.push(t[1]); } }
    return [med(ls), med(rs)];
  });
  const nearestRow = (sy) => {
    for (let d = 0; d < B.H; d++) {
      if (sy - d >= 0 && span[sy - d]) return sy - d;
      if (sy + d < B.H && span[sy + d]) return sy + d;
    }
    return -1;
  };
  const rowSpan = Array.from({ length: S }, (_, y) => { const r = runs(backMask, S, y, 2); return r.length ? [r[0][0], r[r.length - 1][1]] : null; });
  const rows = render((x, y) => {
    const t = rowSpan[y];
    const fy = bb.y0 + Math.min(1, Math.max(0, (y - tb.y0) / Math.max(1, tb.h - 1))) * (bb.h - 1);
    const sy = nearestRow(Math.round(fy));
    if (!t || sy < 0) return [-1, -1];
    const [sl, sr] = smooth[sy];
    const u = t[1] > t[0] ? (x - t[0]) / (t[1] - t[0]) : 0.5;
    return [sl + u * (sr - sl), fy];
  });

  // --- thin-plate spline, loose -> stiff
  const per = 40;
  const tPts = correspond(contour(backMask, S, S), tb, per);
  const sPts = correspond(contour(bs.mask, B.W, B.H), bb, per);
  const G = 4, GW = Math.ceil(S / G) + 1;
  let best = null;
  for (const lambda of [3e-3, 3e-2, 0.3, 3]) {
    const f = tps(tPts, sPts, lambda);
    const gx = new Float32Array(GW * GW), gy = new Float32Array(GW * GW);
    for (let j = 0; j < GW; j++) for (let i = 0; i < GW; i++) { const [a, b] = f(i * G, j * G); gx[j * GW + i] = a; gy[j * GW + i] = b; }
    // folds: grid cells inside the garment whose orientation flips
    let cells = 0, folds = 0;
    for (let j = 0; j < GW - 1; j++) for (let i = 0; i < GW - 1; i++) {
      const X = Math.min(S - 1, i * G), Y = Math.min(S - 1, j * G);
      if (!backMask[Y * S + X]) continue;
      cells++;
      const k = j * GW + i;
      const det = (gx[k + 1] - gx[k]) * (gy[k + GW] - gy[k]) - (gy[k + 1] - gy[k]) * (gx[k + GW] - gx[k]);
      if (det <= 0) folds++;
    }
    if (folds > cells * 0.002) continue;
    const r = render((x, y) => {
      const i = Math.min(GW - 2, (x / G) | 0), j = Math.min(GW - 2, (y / G) | 0);
      const u = x / G - i, v = y / G - j, k = j * GW + i;
      return [
        (gx[k] * (1 - u) + gx[k + 1] * u) * (1 - v) + (gx[k + GW] * (1 - u) + gx[k + GW + 1] * u) * v,
        (gy[k] * (1 - u) + gy[k + 1] * u) * (1 - v) + (gy[k + GW] * (1 - u) + gy[k + GW + 1] * u) * v,
      ];
    });
    if (!best || r.coverage > best.coverage + 0.005) best = { ...r, lambda };
    if (r.coverage > 0.97) break;
  }
  const useTps = best && best.coverage >= Math.max(0.94, rows.coverage - 0.01);
  return { rgba: useTps ? best.rgba : rows.rgba, method: useTps ? `tps(${best.lambda})` : 'rows', coverage: useTps ? best.coverage : rows.coverage };
}

// Height field of an "inflated" silhouette: every part gets a round cross
// section sized by its own local half-width (sleeves become tubes, collars
// thin, the torso a soft dome), softly capped so wide parts stay garment-flat.
function inflate(m, W, H, cap) {
  const dist = distance(m, W, H);
  const R = new Float32Array(W * H);
  // medial pixels (local ridge of the distance) stamp their radius onto their disk
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const k = y * W + x, d = dist[k];
    if (!d) continue;
    let ridge = true;
    for (const [dx, dy, st] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, -1, 1.414], [1, -1, 1.414], [-1, 1, 1.414]]) {
      if (dist[k + dy * W + dx] - d >= st * 0.85) { ridge = false; break; }
    }
    if (!ridge) continue;
    const r = Math.ceil(d), r2 = d * d;
    for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) {
      if ((xx - x) ** 2 + (yy - y) ** 2 > r2) continue;
      const j = yy * W + xx;
      if (m[j] && R[j] < d) R[j] = d;
    }
  }
  const h = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    if (!m[k]) continue;
    const r = Math.max(R[k], dist[k], 1), d = Math.min(dist[k], r);
    const circ = Math.sqrt(Math.max(0, d * (2 * r - d)));
    h[k] = cap * (1 - Math.exp(-circ / cap)); // soft cap
  }
  return h;
}

// Near the outline the shell turns to the side, so the last pixels of the
// photo get stretched across the whole flank (halo, background, specks ->
// stripes). The rim band therefore takes the garment's own texture from
// further inside: each rim pixel walks inward along the distance field and
// copies the colour it finds there, fading back to the photo deeper in.
async function pullInward(rgba, mask, S, band = 18) {
  const d = distance(mask, S, S);
  const out = Buffer.from(rgba);
  const nb = [-1, 1, -S, S, -S - 1, -S + 1, S - 1, S + 1];
  for (let k = 0; k < S * S; k++) {
    if (!mask[k] || d[k] >= band) continue;
    let j = k;
    for (let step = 0; step < band * 2 && d[j] < band; step++) {
      let best = j;
      for (const o of nb) { const n = j + o; if (n >= 0 && n < S * S && d[n] > d[best]) best = n; }
      if (best === j) break;
      j = best;
    }
    const w = Math.min(1, (1 - d[k] / band) * 1.6);
    for (let c = 0; c < 3; c++) out[k * 4 + c] = Math.round(rgba[k * 4 + c] * (1 - w) + rgba[j * 4 + c] * w);
  }
  // copied pixels come in blocks (neighbours reach the same inner pixel):
  // blur the band so the flank reads as continuous fabric
  const soft = await sharp(out, { raw: { width: S, height: S, channels: 4 } }).blur(4).raw().toBuffer();
  for (let k = 0; k < S * S; k++) {
    if (!mask[k] || d[k] >= band) continue;
    const w = Math.min(1, (1 - d[k] / band) * 1.4);
    for (let c = 0; c < 3; c++) out[k * 4 + c] = Math.round(out[k * 4 + c] * (1 - w) + soft[k * 4 + c] * w);
  }
  // re-bleed outside the outline from the cleaned rim, keep the hard alpha
  for (let k = 0; k < S * S; k++) out[k * 4 + 3] = mask[k] ? 255 : 0;
  const bled = bleed(out, S);
  for (let k = 0; k < S * S; k++) bled[k * 4 + 3] = mask[k] ? 255 : 0;
  return bled;
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
  // shared silhouette = front outline with the neck opening closed (the back
  // of a garment has no V-neck); on the front that patch reads as the inside
  // of the collar, so it gets a shaded version of the surrounding colour
  const hard = new Uint8Array(S * S);
  for (let k = 0; k < S * S; k++) hard[k] = frontRGBA[k * 4 + 3] ? 1 : 0;
  const neck = neckFill(hard, S);
  const shared = new Uint8Array(S * S);
  for (let k = 0; k < S * S; k++) shared[k] = hard[k] | neck.fill[k];

  // bleed colours past the edge (no white fringe from texture filtering), keep the hard alpha
  const fBled = bleed(frontRGBA, S);
  for (let k = 0; k < S * S; k++) {
    if (neck.fill[k]) for (let c = 0; c < 3; c++) fBled[k * 4 + c] = Math.round(fBled[k * 4 + c] * 0.42 + 6);
    fBled[k * 4 + 3] = shared[k] ? 255 : 0;
  }
  await sharp(await pullInward(fBled, shared, S), { raw: { width: S, height: S, channels: 4 } }).webp({ quality: 90, alphaQuality: 100 }).toFile(join(outDir, 'front.webp'));

  // back: the back photo is warped into the MIRRORED shared silhouette
  let hasBack = false, warp = null;
  {
    const backMask = new Uint8Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) backMask[y * S + x] = shared[y * S + (S - 1 - x)];
    let backRGB;
    if (back) {
      const B = await load(back);
      const bs = segment(B, tolerance);
      if (bs.area >= 0.04) {
        hasBack = true;
        const bb = bbox(bs.mask, B.W, B.H);
        const w = warpBack(B, bs, bb, backMask, S);
        warp = { method: w.method, coverage: Number(w.coverage.toFixed(3)) };
        backRGB = bleed(w.rgba, S);
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
    await sharp(await pullInward(smooth, backMask, S), { raw: { width: S, height: S, channels: 4 } }).webp({ quality: 88, alphaQuality: 100 }).toFile(join(outDir, 'back.webp'));
  }

  // depth (front orientation; the viewer mirrors it for the back): inflated
  // shared silhouette, normalised: 255 = THICK in the viewer.
  const small = await sharp(Buffer.from(shared.map((v) => v * 255)), { raw: { width: S, height: S, channels: 1 } })
    .resize(DEPTH, DEPTH).extractChannel(0).raw().toBuffer();
  const m = new Uint8Array(DEPTH * DEPTH);
  for (let k = 0; k < m.length; k++) m[k] = small[k] > 127 ? 1 : 0;
  const h = inflate(m, DEPTH, DEPTH, 0.22 * DEPTH);
  let hmax = 1; for (const v of h) if (v > hmax) hmax = v;
  const out = Buffer.alloc(DEPTH * DEPTH);
  for (let k = 0; k < out.length; k++) out[k] = Math.round(255 * h[k] / hmax);
  await sharp(out, { raw: { width: DEPTH, height: DEPTH, channels: 1 } }).blur(2).png().toFile(join(outDir, 'depth.png'));

  const meta = { version: Date.now(), algo: 2, hasBack, warp, tolerance, area: Number(fs.area.toFixed(3)) };
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
