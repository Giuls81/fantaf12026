#!/usr/bin/env node
// Flood-fill transparency remover: makes exterior white pixels transparent
// while PRESERVING interior white pixels (e.g. fillable panels inside a
// silhouette). Works by BFS flood-filling from each of the 4 corners,
// only marking pixels as transparent if they are reachable from the
// outside through a chain of near-white pixels.
//
// Usage:
//   node scripts/remove-exterior-bg.mjs <file1.png> [file2.png ...]
//
// Overwrites inputs in place.

import sharp from 'sharp';

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error('Usage: node scripts/remove-exterior-bg.mjs <file1.png> [file2.png ...]');
  process.exit(1);
}

// Pixels with luminance above this threshold are considered "background-ish"
// and eligible to be cleared by the flood fill.
const WHITE_THRESHOLD = 235;

for (const input of inputs) {
  try {
    const image = sharp(input);
    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = info;
    const isNearWhite = (idx) => {
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      return l > WHITE_THRESHOLD;
    };

    const visited = new Uint8Array(width * height);
    const queue = [];

    // Seed the BFS with every pixel on the 4 edges that is near-white.
    const tryEnqueue = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const p = y * width + x;
      if (visited[p]) return;
      const idx = p * 4;
      if (!isNearWhite(idx)) return;
      visited[p] = 1;
      queue.push(p);
    };

    for (let x = 0; x < width; x += 1) {
      tryEnqueue(x, 0);
      tryEnqueue(x, height - 1);
    }
    for (let y = 0; y < height; y += 1) {
      tryEnqueue(0, y);
      tryEnqueue(width - 1, y);
    }

    let stripped = 0;
    // BFS: spread through connected near-white exterior
    while (queue.length > 0) {
      const p = queue.shift();
      const idx = p * 4;
      data[idx + 3] = 0; // make transparent
      stripped += 1;
      const x = p % width;
      const y = (p - x) / width;
      tryEnqueue(x - 1, y);
      tryEnqueue(x + 1, y);
      tryEnqueue(x, y - 1);
      tryEnqueue(x, y + 1);
    }

    await sharp(data, {
      raw: { width, height, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toFile(input);

    const total = width * height;
    console.log(`✓ ${input} — ${stripped}/${total} (${((stripped / total) * 100).toFixed(1)}%) exterior pixels cleared`);
  } catch (e) {
    console.error(`✖ ${input} — ${e.message}`);
  }
}
