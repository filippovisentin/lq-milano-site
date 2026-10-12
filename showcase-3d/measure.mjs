import sharp from 'sharp';
const img = process.argv[2];
const { data, info } = await sharp(img).resize(400).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const fg = (x, y) => { const i = (y * W + x) * 3; return (765 - data[i] - data[i + 1] - data[i + 2]) > 60; };
let y0 = H, y1 = 0, x0 = W, x1 = 0;
const rows = [];
for (let y = 0; y < H; y++) {
  const runs = []; let s = -1;
  for (let x = 0; x <= W; x++) { const on = x < W && fg(x, y); if (on && s < 0) s = x; if (!on && s >= 0) { if (x - s > 2) runs.push([s, x - 1]); s = -1; } }
  rows.push(runs);
  if (runs.length) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, runs[0][0]); x1 = Math.max(x1, runs.at(-1)[1]); }
}
const Hc = y1 - y0, cx = (x0 + x1) / 2;
console.log(JSON.stringify({ W, H, bbox: [x0, y0, x1, y1], heightPx: Hc, widthPx: x1 - x0 }));
// normalised: height 1 = top..hem, x relative to centre, units of garment height
for (let f = 0; f <= 1.0001; f += 0.04) {
  const y = Math.round(y0 + f * Hc);
  const r = rows[y].map(([a, b]) => [((a - cx) / Hc).toFixed(3), ((b - cx) / Hc).toFixed(3)]);
  console.log(f.toFixed(2), JSON.stringify(r));
}
