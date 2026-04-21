#!/usr/bin/env node
// Converts near-white pixels (luminance > 240/255) to transparent in a PNG.
// Useful when AI-generated illustrations come with a solid white background
// and we want to mask/compose them over other layers.
//
// Usage:
//   node scripts/remove-white-bg.mjs <path/to/image.png> [<path/to/another.png> ...]
//
// Overwrites the input file in place. Make a backup if the original matters.

import sharp from 'sharp';

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error('Usage: node scripts/remove-white-bg.mjs <file1.png> [file2.png ...]');
  process.exit(1);
}

const WHITE_THRESHOLD = 240;

for (const input of inputs) {
  try {
    const image = sharp(input);
    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let stripped = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Weighted luminance (ITU-R BT.601). Near-white pixels become transparent.
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luminance > WHITE_THRESHOLD) {
        data[i + 3] = 0; // fully transparent
        stripped += 1;
      }
    }

    await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toFile(input);

    const pct = ((stripped / (data.length / 4)) * 100).toFixed(1);
    console.log(`✓ ${input} — ${stripped} px made transparent (${pct}%)`);
  } catch (e) {
    console.error(`✖ ${input} — ${e.message}`);
  }
}
