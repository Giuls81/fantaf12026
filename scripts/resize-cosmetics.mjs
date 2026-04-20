#!/usr/bin/env node
// Resizes cosmetic source PNGs into the 3 sizes the app expects.
//
// Reads:  assets/cosmetics-source/*.png  (any size — 1024 × 1024 recommended)
// Writes: web/public/cosmetics/{basename}@{64|128|256}.png
//
// Usage:
//   node scripts/resize-cosmetics.mjs
//
// Safe to re-run: overwrites outputs. Skips files that can't be parsed as PNG
// and logs the reason.
//
// Dependency: sharp (already in node_modules).

import { readdir, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import sharp from 'sharp';

const SRC_DIR = 'assets/cosmetics-source';
const OUT_DIR = 'web/public/cosmetics';
const SIZES = [64, 128, 256];

await mkdir(OUT_DIR, { recursive: true });

let files;
try {
  files = await readdir(SRC_DIR);
} catch (e) {
  console.error(`✖ Source folder missing: ${SRC_DIR}`);
  console.error(`  Create it and drop your *.png files inside (name them like fantaf1.cosmetic.emblem.lightning.png).`);
  process.exit(1);
}

const sources = files.filter((f) => extname(f).toLowerCase() === '.png');

if (sources.length === 0) {
  console.log(`No *.png found in ${SRC_DIR}. Add your source PNGs and run again.`);
  process.exit(0);
}

console.log(`Found ${sources.length} source file(s) in ${SRC_DIR}.\n`);

let okCount = 0;
let failCount = 0;

for (const source of sources) {
  const srcPath = join(SRC_DIR, source);
  const stem = basename(source, '.png'); // e.g. fantaf1.cosmetic.emblem.lightning

  // Livery sources are often portrait (AI keeps generating them rectangular).
  // Use `cover` so the square output is edge-to-edge without transparent
  // margins — we lose some top/bottom content but livery patterns are
  // repetitive enough that center-cropping looks fine. All other categories
  // (emblem/helmet/suit) keep `contain` so the subject stays centered and
  // unclipped against a transparent background.
  const isLivery = stem.startsWith('fantaf1.cosmetic.livery.');
  const fit = isLivery ? 'cover' : 'contain';

  for (const size of SIZES) {
    const outPath = join(OUT_DIR, `${stem}@${size}.png`);
    try {
      await sharp(srcPath)
        .resize(size, size, {
          fit,
          position: 'center',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toFile(outPath);
      console.log(`✓ ${stem}@${size}.png`);
      okCount += 1;
    } catch (e) {
      console.error(`✖ ${stem}@${size}.png — ${e.message}`);
      failCount += 1;
    }
  }
}

console.log(`\nDone. ${okCount} ok, ${failCount} failed.`);
console.log(`Output: ${OUT_DIR}`);
