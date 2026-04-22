#!/usr/bin/env node
// Generates 3 composite "review screenshot" images for App Store Connect IAPs.
// Each shows a category with its price and a grid of the actual cosmetic
// thumbnails. Output: 1242x2208 PNG (iPhone 6.5" canonical size, >Apple min).
//
// Usage:
//   node scripts/generate-review-screenshots.mjs
//
// Outputs:
//   assets/iap-review-shot-emblems-colors.png   (price €0.99)
//   assets/iap-review-shot-helmets-suits.png    (price €1.99)
//   assets/iap-review-shot-liveries.png         (price €2.99)

import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// 1290×2796 = iPhone 6.7" (14/15 Pro Max). This is the current canonical
// dimension Apple requires for IAP review screenshots; the older 1242×2208
// iPhone 6.5" size produces MISSING_METADATA on all 38 cosmetic IAPs even
// when every other field is correctly set. Confirmed via ASC API diagnostic
// 2026-04-22 — the only Ready-to-Submit IAP (Premium Season) had a
// 1290×2796 shot while all 38 MISSING_METADATA ones had 1242×2208.
const WIDTH = 1290;
const HEIGHT = 2796;
const OUT_DIR = 'assets';

mkdirSync(OUT_DIR, { recursive: true });

// Colours match the app's slate/amber palette
const BG = { r: 15, g: 23, b: 42, alpha: 1 };       // slate-900
const ACCENT = '#FBBF24';                              // amber-400
const TEXT_WHITE = '#F8FAFC';
const TEXT_MUTED = '#94A3B8';

async function svgToBuffer(svg) {
  return Buffer.from(svg);
}

function readCosmeticPng(productId, size = 256) {
  return readFileSync(`web/public/cosmetics/${productId}@${size}.png`);
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

function textSvg(title, subtitle, price) {
  return `
    <svg width="${WIDTH}" height="600" viewBox="0 0 ${WIDTH} 600" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="110" font-family="Helvetica, Arial, sans-serif" font-size="56" font-weight="bold"
            fill="${TEXT_WHITE}" text-anchor="middle">Fanta F1</text>
      <text x="50%" y="200" font-family="Helvetica, Arial, sans-serif" font-size="84" font-weight="bold"
            fill="${TEXT_WHITE}" text-anchor="middle">${esc(title)}</text>
      <text x="50%" y="280" font-family="Helvetica, Arial, sans-serif" font-size="42"
            fill="${TEXT_MUTED}" text-anchor="middle">${esc(subtitle)}</text>
      <rect x="${WIDTH / 2 - 180}" y="330" width="360" height="110" rx="22" fill="${ACCENT}" />
      <text x="50%" y="405" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="bold"
            fill="#0F172A" text-anchor="middle">${esc(price)}</text>
    </svg>
  `;
}

function footerSvg() {
  return `
    <svg width="${WIDTH}" height="120" viewBox="0 0 ${WIDTH} 120" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="60" font-family="Helvetica, Arial, sans-serif" font-size="36"
            fill="${TEXT_MUTED}" text-anchor="middle">Season 2026 — Fantasy Formula 1</text>
      <text x="50%" y="100" font-family="Helvetica, Arial, sans-serif" font-size="28"
            fill="${TEXT_MUTED}" text-anchor="middle">Tap any item in the Customize screen to purchase</text>
    </svg>
  `;
}

async function composeShot({ title, subtitle, price, items, itemsPerRow, tileSize, outName }) {
  const base = sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 4, background: BG },
  }).png();

  const composites = [];

  // Title block
  composites.push({ input: await svgToBuffer(textSvg(title, subtitle, price)), top: 140, left: 0 });

  // Grid of cosmetic tiles — centered
  const gridTop = 800;
  const gap = 40;
  const rowWidth = itemsPerRow * tileSize + (itemsPerRow - 1) * gap;
  const gridLeft = Math.floor((WIDTH - rowWidth) / 2);

  for (let i = 0; i < items.length; i += 1) {
    const col = i % itemsPerRow;
    const row = Math.floor(i / itemsPerRow);
    const x = gridLeft + col * (tileSize + gap);
    const y = gridTop + row * (tileSize + gap);
    let input;
    if (items[i].swatchHex) {
      // Render a solid-colour disc for "color" cosmetics via SVG
      const hex = items[i].swatchHex;
      input = await svgToBuffer(`
        <svg width="${tileSize}" height="${tileSize}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${tileSize / 2}" cy="${tileSize / 2}" r="${tileSize / 2 - 4}" fill="${hex}" stroke="#1E293B" stroke-width="4"/>
        </svg>
      `);
    } else {
      input = await sharp(readCosmeticPng(items[i].productId, 256))
        .resize(tileSize, tileSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    }
    composites.push({ input, top: y, left: x });
  }

  // Footer
  composites.push({ input: await svgToBuffer(footerSvg()), top: HEIGHT - 180, left: 0 });

  const outPath = join(OUT_DIR, outName);
  await base.composite(composites).toFile(outPath);
  console.log(`✓ ${outPath}`);
  return outPath;
}

// --- Shot definitions ---

await composeShot({
  title: 'Emblems & Colors',
  subtitle: 'Team badges + accent colors',
  price: '€0.99 each',
  items: [
    { productId: 'fantaf1.cosmetic.emblem.lightning' },
    { productId: 'fantaf1.cosmetic.emblem.flame' },
    { productId: 'fantaf1.cosmetic.emblem.compass' },
    { productId: 'fantaf1.cosmetic.emblem.wolf' },
    { swatchHex: '#00B7FF' },
    { swatchHex: '#00A676' },
    { swatchHex: '#6A1B9A' },
    { swatchHex: '#FF6A00' },
  ],
  itemsPerRow: 4,
  tileSize: 230,
  outName: 'iap-review-shot-emblems-colors.png',
});

await composeShot({
  title: 'Helmets & Suits',
  subtitle: 'Driver gear — 10 helmets + 6 suits',
  price: '€1.99 each',
  items: [
    { productId: 'fantaf1.cosmetic.helmet.chrome' },
    { productId: 'fantaf1.cosmetic.helmet.gold' },
    { productId: 'fantaf1.cosmetic.helmet.fire' },
    { productId: 'fantaf1.cosmetic.helmet.rainbow' },
    { productId: 'fantaf1.cosmetic.suit.monochrome' },
    { productId: 'fantaf1.cosmetic.suit.retro70' },
    { productId: 'fantaf1.cosmetic.suit.mosaic' },
    { productId: 'fantaf1.cosmetic.suit.sunrise' },
  ],
  itemsPerRow: 4,
  tileSize: 230,
  outName: 'iap-review-shot-helmets-suits.png',
});

await composeShot({
  title: 'Car Liveries',
  subtitle: 'Paint schemes for your car',
  price: '€2.99 each',
  items: [
    { productId: 'fantaf1.cosmetic.livery.classic' },
    { productId: 'fantaf1.cosmetic.livery.stealth' },
    { productId: 'fantaf1.cosmetic.livery.racing' },
    { productId: 'fantaf1.cosmetic.livery.rainbow' },
    { productId: 'fantaf1.cosmetic.livery.carbon' },
    { productId: 'fantaf1.cosmetic.livery.neon' },
  ],
  itemsPerRow: 3,
  tileSize: 310,
  outName: 'iap-review-shot-liveries.png',
});

console.log('\nDone. Upload these 3 PNGs as review screenshots in ASC:');
console.log('  - iap-review-shot-emblems-colors.png → for all €0.99 IAPs');
console.log('  - iap-review-shot-helmets-suits.png  → for all €1.99 IAPs');
console.log('  - iap-review-shot-liveries.png       → for all €2.99 IAPs');
