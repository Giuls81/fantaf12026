#!/usr/bin/env node
// Generates a trademark-safe FantaGP app icon (1024x1024).
// No F1 / Formula 1 references, no open-wheel race cars.
// Produces: assets/icon-only.png, assets/logo.png, assets/splash.png, assets/splash-dark.png
//
// Run:  node scripts/generate-app-icon.mjs

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
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
    <linearGradient id="gp" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#c9d4e8"/>
    </linearGradient>
  </defs>

  <!-- background -->
  <rect width="1024" height="1024" rx="220" ry="220" fill="url(#bg)"/>

  <!-- abstract checkered corner pattern (generic racing, not F1-specific) -->
  <g opacity="0.08" fill="#ffffff">
    <rect x="40"  y="40"  width="56" height="56"/>
    <rect x="152" y="40"  width="56" height="56"/>
    <rect x="96"  y="96"  width="56" height="56"/>
    <rect x="40"  y="152" width="56" height="56"/>
    <rect x="152" y="152" width="56" height="56"/>

    <rect x="816" y="816" width="56" height="56"/>
    <rect x="928" y="816" width="56" height="56"/>
    <rect x="872" y="872" width="56" height="56"/>
    <rect x="816" y="928" width="56" height="56"/>
    <rect x="928" y="928" width="56" height="56"/>
  </g>

  <!-- FANTA top wordmark -->
  <text x="512" y="340"
        font-family="Impact, 'Arial Black', sans-serif"
        font-size="140"
        font-weight="900"
        letter-spacing="24"
        text-anchor="middle"
        fill="#e6edf7"
        opacity="0.92">FANTA</text>

  <!-- GP monogram -->
  <text x="512" y="640"
        font-family="Impact, 'Arial Black', sans-serif"
        font-size="360"
        font-weight="900"
        letter-spacing="-10"
        text-anchor="middle"
        fill="url(#gp)"
        stroke="#0b1220"
        stroke-width="6">GP</text>

  <!-- accent underline / speed bar -->
  <rect x="260" y="700" width="504" height="14" rx="7" fill="url(#accent)"/>

  <!-- 2026 subtitle -->
  <text x="512" y="830"
        font-family="Impact, 'Arial Black', sans-serif"
        font-size="120"
        font-weight="900"
        letter-spacing="18"
        text-anchor="middle"
        fill="#a9b6cc">2026</text>
</svg>
`;

const outDir = path.join(root, 'assets');

async function main() {
  const iconBuf = await sharp(Buffer.from(iconSvg)).png().toBuffer();

  // Square icon (1024x1024) — used as the Capacitor asset source
  await sharp(iconBuf).toFile(path.join(outDir, 'icon-only.png'));
  await sharp(iconBuf).toFile(path.join(outDir, 'logo.png'));
  console.log('Wrote assets/icon-only.png  (1024x1024)');
  console.log('Wrote assets/logo.png       (1024x1024)');

  // Splash: 2732x2732 (Capacitor standard) dark background + centered icon
  const SPLASH = 2732;
  const splashBg = await sharp({
    create: { width: SPLASH, height: SPLASH, channels: 4, background: { r: 11, g: 18, b: 32, alpha: 1 } },
  }).png().toBuffer();

  const logoForSplash = await sharp(iconBuf).resize(900, 900).png().toBuffer();

  await sharp(splashBg)
    .composite([{ input: logoForSplash, gravity: 'center' }])
    .toFile(path.join(outDir, 'splash.png'));
  console.log('Wrote assets/splash.png     (2732x2732)');

  await sharp(splashBg)
    .composite([{ input: logoForSplash, gravity: 'center' }])
    .toFile(path.join(outDir, 'splash-dark.png'));
  console.log('Wrote assets/splash-dark.png (2732x2732)');

  console.log('\nNext: npx @capacitor/assets generate');
}

main().catch((e) => { console.error(e); process.exit(1); });
