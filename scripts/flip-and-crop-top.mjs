#!/usr/bin/env node
// Horizontally mirrors an image and makes the top N% transparent.
// Useful when an AI-generated subject ends up facing the wrong way
// and/or includes an unwanted neck/chin stub that needs cropping out.
//
// Usage:
//   node scripts/flip-and-crop-top.mjs <src> <dst> <cropTopPct>
// Example:
//   node scripts/flip-and-crop-top.mjs assets/.../driver.png web/public/scene/driver.png 10

import sharp from 'sharp';

const [, , src, dst, cropPctStr] = process.argv;
if (!src || !dst || !cropPctStr) {
  console.error('Usage: node scripts/flip-and-crop-top.mjs <src> <dst> <cropTopPct>');
  process.exit(1);
}
const cropPct = Number(cropPctStr);

const { data, info } = await sharp(src)
  .flop() // horizontal mirror
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width, height } = info;
const topCut = Math.floor(height * (cropPct / 100));
let cleared = 0;
for (let y = 0; y < topCut; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const idx = (y * width + x) * 4;
    if (data[idx + 3] !== 0) {
      data[idx + 3] = 0;
      cleared += 1;
    }
  }
}

await sharp(data, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(dst);

console.log(`✓ ${dst} — flipped horizontally, top ${cropPct}% cropped (${cleared} px cleared)`);
