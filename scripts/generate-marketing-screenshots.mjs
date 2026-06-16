#!/usr/bin/env node
// Builds App Store / Play Store *marketing* screenshots (1290x2796) from the
// raw in-app captures: a branded FantaGP background, a big headline, the
// red->orange accent bar, and the app screenshot framed with rounded corners
// and a drop shadow. This is the DreamGP-style polished look that converts
// far better than raw captures and that Apple favours for inline search
// display.
//
// Source captures live in assets/store_upload/iphone69_final_1290 (FantaGP
// branded, 1290x2796). We crop the top ~96px to drop the iOS status bar
// (removes the "TestFlight" marker), then scale the capture into the lower
// portion of the canvas.
//
// Run:  node scripts/generate-marketing-screenshots.mjs
// Out:  assets/store_upload/marketing/<n>_<key>.png   (1290x2796)

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'assets/store_upload/iphone69_final_1290');
const OUT = path.join(root, 'assets/store_upload/marketing');
mkdirSync(OUT, { recursive: true });

const W = 1290, H = 2796;

// Ordered for App Store impact — first 3 matter most.
const SHOTS = [
  { file: 'screenshot_03_lineup.png',    line1: 'Build your',     line2: 'dream team' },
  { file: 'screenshot_04_market.png',    line1: 'Sign the grid’s', line2: 'best drivers' },
  { file: 'screenshot_05_standings.png', line1: 'Race your',      line2: 'friends' },
  { file: 'screenshot_02_shop.png',      line1: 'Make it',        line2: 'yours' },
  { file: 'screenshot_06_style.png',     line1: 'Show your',      line2: 'racing style' },
];

const SUBTITLES = {
  'screenshot_03_lineup.png':    'Captain scores 2× · reserve covers DNFs',
  'screenshot_04_market.png':    '22 drivers · one budget · smart picks',
  'screenshot_05_standings.png': 'Private leagues, full 24-race season',
  'screenshot_02_shop.png':      'Emblems, helmets, liveries & more',
  'screenshot_06_style.png':     'Your driver, your car, your colours',
};

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function backgroundSvg(line1, line2, subtitle) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b1220"/>
      <stop offset="55%" stop-color="#111a2b"/>
      <stop offset="100%" stop-color="#1a0a14"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff3355"/>
      <stop offset="100%" stop-color="#ffb347"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- checkered corner motif, subtle -->
  <g opacity="0.08" fill="#ffffff">
    <rect x="60"   y="60"  width="60" height="60"/>
    <rect x="180"  y="60"  width="60" height="60"/>
    <rect x="120"  y="120" width="60" height="60"/>
    <rect x="60"   y="180" width="60" height="60"/>
    <rect x="180"  y="180" width="60" height="60"/>
    <rect x="1050" y="60"  width="60" height="60"/>
    <rect x="1170" y="60"  width="60" height="60"/>
    <rect x="1110" y="120" width="60" height="60"/>
  </g>

  <!-- small FantaGP wordmark top-center -->
  <text x="${W/2}" y="250" font-family="Impact, 'Arial Black', sans-serif" font-size="58"
        font-weight="900" letter-spacing="6" text-anchor="middle" fill="#e6edf7" opacity="0.85">FANTAGP</text>

  <!-- headline -->
  <text x="${W/2}" y="470" font-family="Impact, 'Arial Black', sans-serif" font-size="120"
        font-weight="900" text-anchor="middle" fill="#ffffff">${escapeXml(line1)}</text>
  <text x="${W/2}" y="600" font-family="Impact, 'Arial Black', sans-serif" font-size="120"
        font-weight="900" text-anchor="middle" fill="#ffffff">${escapeXml(line2)}</text>

  <!-- accent bar -->
  <rect x="${W/2 - 160}" y="660" width="320" height="12" rx="6" fill="url(#accent)"/>

  <!-- subtitle -->
  <text x="${W/2}" y="745" font-family="Arial, Helvetica, sans-serif" font-size="40"
        font-weight="600" text-anchor="middle" fill="#a9b6cc">${escapeXml(subtitle)}</text>
</svg>`;
}

// Rounded-corner mask for the device capture.
function roundedMask(w, h, r) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
  );
}

async function build(shot, index) {
  const srcPath = path.join(SRC, shot.file);

  // Crop top 180px off the 1290x2796 source. TestFlight builds stack two
  // rows at the top — the iOS status bar (time/signal) plus a "◀ TestFlight"
  // banner — so 180px clears both while keeping the app's own FantaGP header.
  const CROP_TOP = 180;
  const cropped = await sharp(srcPath)
    .extract({ left: 0, top: CROP_TOP, width: W, height: H - CROP_TOP })
    .toBuffer();

  // Scale the capture to sit in the lower portion of the canvas.
  const FRAME_W = 1000;
  const meta = await sharp(cropped).metadata();
  const FRAME_H = Math.round(FRAME_W * (meta.height / meta.width));
  const radius = 56;

  const scaled = await sharp(cropped).resize(FRAME_W, FRAME_H).toBuffer();
  const rounded = await sharp(scaled)
    .composite([{ input: roundedMask(FRAME_W, FRAME_H, radius), blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Drop shadow: a blurred dark rounded rect behind the capture.
  const shadow = await sharp({
    create: { width: FRAME_W + 80, height: FRAME_H + 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_W + 80}" height="${FRAME_H + 80}"><rect x="40" y="40" width="${FRAME_W}" height="${FRAME_H}" rx="${radius}" ry="${radius}" fill="#000"/></svg>`),
    }])
    .blur(30)
    .png()
    .toBuffer();

  const frameX = Math.round((W - FRAME_W) / 2);
  const frameY = 900; // below the headline block

  const bg = await sharp(Buffer.from(backgroundSvg(shot.line1, shot.line2, SUBTITLES[shot.file]))).png().toBuffer();

  const out = await sharp(bg)
    .composite([
      { input: shadow, left: frameX - 40, top: frameY - 40 },
      { input: rounded, left: frameX, top: frameY },
    ])
    .png()
    .toFile(path.join(OUT, `${String(index + 1).padStart(2, '0')}_${shot.file.replace(/^screenshot_\d+_/, '')}`));

  console.log('wrote', `${String(index + 1).padStart(2, '0')}_${shot.file.replace(/^screenshot_\d+_/, '')}`, `(frame ${FRAME_W}x${FRAME_H})`);
}

for (let i = 0; i < SHOTS.length; i++) {
  await build(SHOTS[i], i);
}
console.log('\nDone. Marketing screenshots in assets/store_upload/marketing/');
