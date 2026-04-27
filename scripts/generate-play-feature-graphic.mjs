#!/usr/bin/env node
// Generates the Google Play "Feature graphic" — 1024x500 PNG displayed at
// the top of the Play Store listing. Matches the FantaGP icon aesthetic:
// dark gradient background, "FANTA GP 2026" wordmark, red-to-orange accent
// speed line, abstract checkered tiles (generic racing, not F1-specific).
//
// Run:  node scripts/generate-play-feature-graphic.mjs
// Output: assets/play-feature-graphic.png

import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '..', 'assets', 'play-feature-graphic.png');

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
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
    <linearGradient id="wordmark" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#c9d4e8"/>
    </linearGradient>
  </defs>

  <rect width="1024" height="500" fill="url(#bg)"/>

  <!-- abstract checkered tiles in the bottom-left corner -->
  <g opacity="0.1" fill="#ffffff">
    <rect x="30"  y="380" width="36" height="36"/>
    <rect x="102" y="380" width="36" height="36"/>
    <rect x="66"  y="416" width="36" height="36"/>
    <rect x="30"  y="452" width="36" height="36"/>
    <rect x="102" y="452" width="36" height="36"/>
  </g>
  <!-- mirror top-right -->
  <g opacity="0.1" fill="#ffffff">
    <rect x="886" y="30"  width="36" height="36"/>
    <rect x="958" y="30"  width="36" height="36"/>
    <rect x="922" y="66"  width="36" height="36"/>
    <rect x="886" y="102" width="36" height="36"/>
    <rect x="958" y="102" width="36" height="36"/>
  </g>

  <!-- FANTA upper wordmark -->
  <text x="512" y="190"
        font-family="Impact, 'Arial Black', sans-serif"
        font-size="90"
        font-weight="900"
        letter-spacing="18"
        text-anchor="middle"
        fill="#e6edf7"
        opacity="0.92">FANTA</text>

  <!-- GP main monogram -->
  <text x="512" y="330"
        font-family="Impact, 'Arial Black', sans-serif"
        font-size="150"
        font-weight="900"
        letter-spacing="-6"
        text-anchor="middle"
        fill="url(#wordmark)"
        stroke="#0b1220"
        stroke-width="3">GP 2026</text>

  <!-- accent speed bar -->
  <rect x="362" y="370" width="300" height="8" rx="4" fill="url(#accent)"/>

  <!-- tagline -->
  <text x="512" y="430"
        font-family="Arial, Helvetica, sans-serif"
        font-size="26"
        font-weight="700"
        letter-spacing="6"
        text-anchor="middle"
        fill="#a9b6cc">FANTASY RACING MANAGER</text>
</svg>
`;

await sharp(Buffer.from(svg))
  .png()
  .toFile(outPath);

console.log(`Wrote ${outPath} (1024x500)`);
