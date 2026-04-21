#!/usr/bin/env node
// Makes a circular area of an image transparent.
// Use case: erase the AI-drawn helmet at the top of driver.png so the
// user's own helmet PNG can be overlaid cleanly without a show-through.
//
// Usage:
//   node scripts/erase-circle.mjs <file.png> <cxPct> <cyPct> <rPct>
//   all coordinates are percentages of the image dimensions.
//
// Example (erase a head-sized circle at the top-center, r ≈ 15% of width):
//   node scripts/erase-circle.mjs web/public/scene/driver.png 50 10 14

import sharp from 'sharp';

const [, , file, cxPctStr, cyPctStr, rPctStr] = process.argv;
if (!file || !cxPctStr || !cyPctStr || !rPctStr) {
  console.error('Usage: node scripts/erase-circle.mjs <file.png> <cxPct> <cyPct> <rPct>');
  process.exit(1);
}
const cxPct = Number(cxPctStr);
const cyPct = Number(cyPctStr);
const rPct = Number(rPctStr);

const image = sharp(file);
const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;

const cx = (cxPct / 100) * width;
const cy = (cyPct / 100) * height;
const r = (rPct / 100) * Math.min(width, height);
const r2 = r * r;

let cleared = 0;
for (let y = 0; y < height; y += 1) {
  const dy = y - cy;
  for (let x = 0; x < width; x += 1) {
    const dx = x - cx;
    if (dx * dx + dy * dy <= r2) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] !== 0) {
        data[idx + 3] = 0;
        cleared += 1;
      }
    }
  }
}

await sharp(data, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(file);

console.log(`✓ ${file} — erased ${cleared} px in circle @ (${cxPct}%, ${cyPct}%) r=${rPct}%`);
