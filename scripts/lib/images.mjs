// Photo pipeline shared by the admin panel and the scripts: one upload ->
// master (max 2400px, kept for the 3D builder) + responsive WebP renditions.
import sharp from 'sharp';
// no file-handle cache: on Windows it keeps photos locked and blocks deleting them
sharp.cache(false);
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const WIDTHS = [480, 960, 1600];

/** @returns {Promise<{id:string,w:number,h:number}>} */
export async function processImage(input, dir) {
  mkdirSync(dir, { recursive: true });
  const id = randomBytes(6).toString('hex');
  const base = sharp(input, { limitInputPixels: 120_000_000 }).rotate();
  const meta = await base.metadata();
  const portrait = (meta.height ?? 1) > (meta.width ?? 1);
  // master
  const master = await sharp(input, { limitInputPixels: 120_000_000 }).rotate()
    .resize({ width: portrait ? undefined : 2400, height: portrait ? 2400 : undefined, withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
  await sharp(master.data).toFile(join(dir, `${id}.webp`));
  const { width: w, height: h } = master.info;
  for (const W of WIDTHS) {
    await sharp(master.data).resize({ width: Math.min(W, w) }).webp({ quality: W >= 1600 ? 84 : 80 }).toFile(join(dir, `${id}-${W}.webp`));
  }
  return { id, w, h };
}
