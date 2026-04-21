#!/usr/bin/env node
// Generates a "body-only" mask from an image: makes dark pixels (below a
// luminance threshold) transparent, in addition to already-transparent ones.
// The resulting PNG is meant to be used as mask-image for a pattern overlay
// so that dark details (tyres, exhausts, helmets visor, gloves) are
// EXCLUDED from the painted area.
//
// The original image is left untouched; the output is saved with a
// `-bodymask.png` suffix next to it.
//
// Usage:
//   node scripts/make-body-mask.mjs <file1.png> [file2.png ...]

import sharp from 'sharp';
import { dirname, basename, join, extname } from 'node:path';

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error('Usage: node scripts/make-body-mask.mjs <file1.png> [file2.png ...]');
  process.exit(1);
}

// Pixels darker than this luminance are removed from the mask.
// Most F1 tyres, helmet visors and boots sit around 20–60 luminance,
// so 90 is a reasonable default — catches the dark details without
// over-eroding grey/silver body paint.
const DARK_THRESHOLD = 90;

// Pixels that are strongly chromatic (not close to neutral gray) are also
// removed, so skin, hair and colourful details don't get painted by the
// suit/livery pattern. Deltas below 30 are usually "near-gray" and stay in.
const CHROMA_THRESHOLD = 30;

for (const input of inputs) {
  try {
    const image = sharp(input);
    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let clearedDark = 0;
    let clearedChroma = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue; // already transparent
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luminance < DARK_THRESHOLD) {
        data[i + 3] = 0;
        clearedDark += 1;
        continue;
      }
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (chroma > CHROMA_THRESHOLD) {
        data[i + 3] = 0;
        clearedChroma += 1;
      }
    }

    const dir = dirname(input);
    const stem = basename(input, extname(input));
    const out = join(dir, `${stem}-bodymask.png`);
    await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toFile(out);

    console.log(`✓ ${out} — ${clearedDark} dark + ${clearedChroma} chromatic pixels removed`);
  } catch (e) {
    console.error(`✖ ${input} — ${e.message}`);
  }
}
