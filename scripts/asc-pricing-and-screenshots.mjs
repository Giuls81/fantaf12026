#!/usr/bin/env node
// Sets per-IAP pricing and uploads a shared review screenshot for all
// cosmetic IAPs on App Store Connect. Expects that the IAPs were already
// created by scripts/seed-appstore-connect.mjs.
//
// Prices by category (base territory USA):
//   emblem + color   -> $0.99
//   helmet + suit    -> $1.99
//   livery           -> $2.99
//   (premium pass is skipped — it's already priced manually)
//
// --- Env vars ---
//   ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY_PATH  (same as seed script)
//   SCREENSHOT_PATH=C:\path\to\screenshot.png         (>= 640x920 px PNG)
//
// --- Usage ---
//   node scripts/asc-pricing-and-screenshots.mjs --dry-run
//   node scripts/asc-pricing-and-screenshots.mjs --prices-only
//   node scripts/asc-pricing-and-screenshots.mjs --screenshots-only
//   node scripts/asc-pricing-and-screenshots.mjs                  (both)

import crypto from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const BUNDLE_ID = 'com.fantaf1.app';
const API_ROOT = 'https://api.appstoreconnect.apple.com';
const BASE_TERRITORY = 'USA';

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER_ID = process.env.ASC_ISSUER_ID;
const KEY_PATH = process.env.ASC_PRIVATE_KEY_PATH;

// Per-category review screenshot paths. Defaults point at the PNGs generated
// by scripts/generate-review-screenshots.mjs. Override any of them by setting
// SCREENSHOT_PATH=... to use a single image for everything.
const SCREENSHOT_PATH = process.env.SCREENSHOT_PATH;
const SCREENSHOTS_BY_CATEGORY = {
  emblem: SCREENSHOT_PATH || 'assets/iap-review-shot-emblems-colors.png',
  color: SCREENSHOT_PATH || 'assets/iap-review-shot-emblems-colors.png',
  helmet: SCREENSHOT_PATH || 'assets/iap-review-shot-helmets-suits.png',
  suit: SCREENSHOT_PATH || 'assets/iap-review-shot-helmets-suits.png',
  livery: SCREENSHOT_PATH || 'assets/iap-review-shot-liveries.png',
};

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const PRICES_ONLY = args.has('--prices-only');
const SCREENSHOTS_ONLY = args.has('--screenshots-only');
const DO_PRICES = !SCREENSHOTS_ONLY;
const DO_SCREENSHOTS = !PRICES_ONLY;

if (!KEY_ID || !ISSUER_ID || !KEY_PATH) {
  console.error('Missing env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY_PATH');
  process.exit(1);
}
// No explicit SCREENSHOT_PATH check — defaults are per-category PNGs.

const privateKeyPem = readFileSync(KEY_PATH, 'utf8');

// --- Category → price map ---
const PRICE_USD_BY_CATEGORY = {
  emblem: '0.99',
  helmet: '1.99',
  suit: '1.99',
  color: '0.99',
  livery: '2.99',
};
function categoryOf(productId) {
  const parts = productId.split('.');
  // fantaf1.cosmetic.<category>.<name>
  return parts[2] ?? null;
}

// --- JWT + HTTP helpers ---
function b64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function generateJWT() {
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('SHA256');
  signer.update(signingInput);
  const signature = signer.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(signature)}`;
}
async function asc(path, opts = {}) {
  const { method = 'GET', body = null, headers: extraHeaders = {} } = opts;
  const jwt = generateJWT();
  const res = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* noop */ }
  return { status: res.status, ok: res.ok, body: json ?? text };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Fetch all IAPs for app ---
async function fetchAppId() {
  const r = await asc(`/v1/apps?filter%5BbundleId%5D=${encodeURIComponent(BUNDLE_ID)}`);
  if (!r.ok) throw new Error(`fetchAppId: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data[0].id;
}
async function fetchAllIaps(appId) {
  const all = [];
  let url = `/v1/apps/${appId}/inAppPurchasesV2?limit=200`;
  while (url) {
    const r = await asc(url);
    if (!r.ok) throw new Error(`fetchAllIaps: ${r.status} ${JSON.stringify(r.body)}`);
    for (const item of r.body.data) {
      all.push({
        id: item.id,
        productId: item.attributes?.productId,
        name: item.attributes?.name,
        state: item.attributes?.state,
      });
    }
    // Paginate via relative next link — Apple returns full URL; strip origin
    const next = r.body.links?.next;
    url = next ? next.replace(API_ROOT, '') : null;
  }
  return all;
}

// --- Pricing ---
async function findPricePointId(iapId, usdAmount) {
  // List price points filtered to the base territory; page until we find the
  // price point whose customerPrice matches the target.
  let url = `/v2/inAppPurchases/${iapId}/pricePoints?filter%5Bterritory%5D=${BASE_TERRITORY}&limit=200`;
  while (url) {
    const r = await asc(url);
    if (!r.ok) throw new Error(`pricePoints ${iapId}: ${r.status} ${JSON.stringify(r.body)}`);
    for (const pp of r.body.data) {
      const amount = pp.attributes?.customerPrice;
      // Normalise "0.99" vs "$0.99" vs "0.9900" to a decimal comparison
      if (amount && Number(amount).toFixed(2) === Number(usdAmount).toFixed(2)) {
        return pp.id;
      }
    }
    const next = r.body.links?.next;
    url = next ? next.replace(API_ROOT, '') : null;
  }
  return null;
}

async function setPriceSchedule(iap, targetPriceUsd) {
  const pricePointId = await findPricePointId(iap.id, targetPriceUsd);
  if (!pricePointId) {
    console.error(`  ✖ no price point for $${targetPriceUsd} on ${iap.productId}`);
    return false;
  }
  const payload = {
    data: {
      type: 'inAppPurchasePriceSchedules',
      relationships: {
        inAppPurchase: { data: { type: 'inAppPurchases', id: iap.id } },
        manualPrices: { data: [{ type: 'inAppPurchasePrices', id: '${price1}' }] },
        baseTerritory: { data: { type: 'territories', id: BASE_TERRITORY } },
      },
    },
    included: [
      {
        type: 'inAppPurchasePrices',
        id: '${price1}',
        attributes: { startDate: null },
        relationships: {
          inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iap.id } },
          inAppPurchasePricePoint: { data: { type: 'inAppPurchasePricePoints', id: pricePointId } },
        },
      },
    ],
  };
  console.log(`  → price $${targetPriceUsd} (point ${pricePointId})`);
  if (DRY_RUN) {
    return true;
  }
  const r = await asc('/v1/inAppPurchasePriceSchedules', { method: 'POST', body: payload });
  if (r.ok) {
    console.log(`    ✓ price schedule created`);
    return true;
  }
  console.error(`    ✖ ${r.status} ${JSON.stringify(r.body)}`);
  return false;
}

// --- Screenshot upload (3-step Apple upload) ---
async function uploadScreenshot(iap, imgBytes, fileName, fileSize, checksumHex) {
  console.log(`  → screenshot upload for ${iap.productId}`);
  if (DRY_RUN) {
    return true;
  }

  // 1. Reserve
  const reserveRes = await asc('/v1/inAppPurchaseAppStoreReviewScreenshots', {
    method: 'POST',
    body: {
      data: {
        type: 'inAppPurchaseAppStoreReviewScreenshots',
        attributes: { fileName, fileSize },
        relationships: {
          inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iap.id } },
        },
      },
    },
  });
  if (!reserveRes.ok) {
    console.error(`    ✖ reserve ${reserveRes.status} ${JSON.stringify(reserveRes.body)}`);
    return false;
  }
  const shotId = reserveRes.body.data.id;
  const ops = reserveRes.body.data.attributes?.uploadOperations ?? [];

  // 2. PUT binary to each operation URL
  for (const op of ops) {
    const start = op.offset ?? 0;
    const length = op.length ?? imgBytes.length;
    const chunk = imgBytes.subarray(start, start + length);
    const headers = { 'Content-Type': 'application/octet-stream' };
    for (const h of op.requestHeaders || []) headers[h.name] = h.value;
    const putRes = await fetch(op.url, {
      method: op.method || 'PUT',
      headers,
      body: chunk,
    });
    if (!putRes.ok) {
      const text = await putRes.text().catch(() => '');
      console.error(`    ✖ PUT chunk failed ${putRes.status} ${text.slice(0, 200)}`);
      return false;
    }
  }

  // 3. Commit
  const commitRes = await asc(`/v1/inAppPurchaseAppStoreReviewScreenshots/${shotId}`, {
    method: 'PATCH',
    body: {
      data: {
        type: 'inAppPurchaseAppStoreReviewScreenshots',
        id: shotId,
        attributes: { uploaded: true, sourceFileChecksum: checksumHex },
      },
    },
  });
  if (!commitRes.ok) {
    console.error(`    ✖ commit ${commitRes.status} ${JSON.stringify(commitRes.body)}`);
    return false;
  }
  console.log(`    ✓ screenshot attached`);
  return true;
}

// --- Main ---
(async () => {
  console.log(`\n=== ASC Pricing + Screenshots ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
  console.log(`Bundle: ${BUNDLE_ID}`);
  console.log(`Actions: ${DO_PRICES ? 'prices ' : ''}${DO_SCREENSHOTS ? 'screenshots' : ''}`);
  if (DO_SCREENSHOTS && SCREENSHOT_PATH) {
    console.log(`Screenshot: ${SCREENSHOT_PATH}`);
  }

  const appId = await fetchAppId();
  console.log(`App id: ${appId}\n`);

  let iaps = await fetchAllIaps(appId);
  // Only act on cosmetic IAPs — leave the premium pass alone
  iaps = iaps.filter((i) => i.productId && i.productId.startsWith('fantaf1.cosmetic.'));
  console.log(`Found ${iaps.length} cosmetic IAPs.\n`);

  // Pre-load each per-category screenshot exactly once so we don't hit disk
  // and hash 36 times.
  const screenshotCache = new Map();
  function loadScreenshot(path) {
    if (screenshotCache.has(path)) return screenshotCache.get(path);
    const bytes = readFileSync(path);
    const hash = crypto.createHash('sha256');
    hash.update(bytes);
    const entry = {
      bytes,
      fileName: basename(path),
      fileSize: bytes.length,
      checksumHex: hash.digest('hex'),
    };
    screenshotCache.set(path, entry);
    console.log(`Loaded screenshot ${entry.fileName} (${entry.fileSize} bytes, sha256=${entry.checksumHex.slice(0, 16)}...)`);
    return entry;
  }
  if (DO_SCREENSHOTS && !DRY_RUN) {
    // Pre-load all distinct screenshots referenced by SCREENSHOTS_BY_CATEGORY
    for (const p of new Set(Object.values(SCREENSHOTS_BY_CATEGORY))) {
      loadScreenshot(p);
    }
    console.log('');
  }

  let okCount = 0;
  let failCount = 0;

  for (const iap of iaps) {
    const cat = categoryOf(iap.productId);
    const priceUsd = PRICE_USD_BY_CATEGORY[cat];
    console.log(`• ${iap.productId} (id ${iap.id})`);

    if (DO_PRICES) {
      if (!priceUsd) {
        console.log(`  · skipping pricing: unknown category "${cat}"`);
      } else {
        const ok = await setPriceSchedule(iap, priceUsd);
        if (ok) okCount += 1; else failCount += 1;
        await sleep(250);
      }
    }

    if (DO_SCREENSHOTS) {
      const shotPath = SCREENSHOTS_BY_CATEGORY[cat];
      if (!shotPath) {
        console.log(`  · no screenshot configured for category "${cat}"`);
      } else if (DRY_RUN) {
        console.log(`  → screenshot upload (DRY) using ${shotPath}`);
      } else {
        const s = loadScreenshot(shotPath);
        const ok = await uploadScreenshot(iap, s.bytes, s.fileName, s.fileSize, s.checksumHex);
        if (ok) okCount += 1; else failCount += 1;
        await sleep(250);
      }
    }
  }

  console.log(`\n=== Done: ${okCount} ok, ${failCount} failed ===`);
  if (failCount === 0) {
    console.log('When pricing + screenshot are both set Apple auto-flips each IAP');
    console.log('to "Ready to Submit". Verify in the ASC dashboard.');
  }
})().catch((e) => {
  console.error('\n✖ Error:', e);
  process.exit(1);
});
