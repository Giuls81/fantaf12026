#!/usr/bin/env node
// Deletes promoted IAP images from every cosmetic IAP on App Store Connect.
//
// Apple rejected v1.0 under Guideline 2.3.2 because at least one promoted
// IAP image was identical to the app icon. We are not currently running
// App Store promoted IAP campaigns, so the fastest fix is to remove every
// promoted image. They can be re-added post-launch with per-IAP artwork.
//
// This does NOT touch:
//   - the IAP itself (product ID, name, price, availability)
//   - review screenshots (appStoreReviewScreenshot) — those stay
//   - localizations, price schedules, or territories
//
// --- Env vars (same as sibling scripts) ---
//   ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY_PATH
//
// --- Usage ---
//   node scripts/asc-delete-promoted-images.mjs --dry-run
//   node scripts/asc-delete-promoted-images.mjs
//   node scripts/asc-delete-promoted-images.mjs --only=fantaf1.cosmetic.bundle.starter

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const BUNDLE_ID = 'com.fantaf1.app';
const API_ROOT = 'https://api.appstoreconnect.apple.com';

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER_ID = process.env.ASC_ISSUER_ID;
const KEY_PATH = process.env.ASC_PRIVATE_KEY_PATH;

const argsArr = process.argv.slice(2);
const args = new Set(argsArr);
const DRY_RUN = args.has('--dry-run');
const onlyArg = argsArr.find((a) => a.startsWith('--only='));
const ONLY_IDS = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').filter(Boolean)) : null;

if (!KEY_ID || !ISSUER_ID || !KEY_PATH) {
  console.error('Missing env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY_PATH');
  process.exit(1);
}

const privateKeyPem = readFileSync(KEY_PATH, 'utf8');

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
  const { method = 'GET', body = null } = opts;
  const jwt = generateJWT();
  const res = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* noop */ }
  return { status: res.status, ok: res.ok, body: json ?? text };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      });
    }
    const next = r.body.links?.next;
    url = next ? next.replace(API_ROOT, '') : null;
  }
  return all;
}

// Returns the promoted-purchase image id for an IAP, or null if none.
async function fetchPromotedImageId(iapId) {
  // v1/inAppPurchases/{id}/promotedPurchase → single (or 404/empty if none)
  const r = await asc(`/v1/inAppPurchases/${iapId}/promotedPurchase`);
  if (!r.ok) return null;
  const promotedId = r.body?.data?.id;
  if (!promotedId) return null;

  // v1/promotedPurchases/{id}/promotedPurchaseImages → list of images
  const imgs = await asc(`/v1/promotedPurchases/${promotedId}/promotedPurchaseImages`);
  if (!imgs.ok) return null;
  const first = imgs.body?.data?.[0];
  return first?.id ?? null;
}

async function deletePromotedImage(iap) {
  const imageId = await fetchPromotedImageId(iap.id);
  if (!imageId) {
    console.log(`  · no promoted image, skip`);
    return { skipped: true };
  }
  console.log(`  → DELETE /v1/promotedPurchaseImages/${imageId}`);
  if (DRY_RUN) {
    return { dryRun: true };
  }
  const del = await asc(`/v1/promotedPurchaseImages/${imageId}`, { method: 'DELETE' });
  if (del.ok || del.status === 204) {
    console.log(`    ✓ deleted`);
    return { deleted: true };
  }
  console.error(`    ✖ ${del.status} ${JSON.stringify(del.body).slice(0, 200)}`);
  return { error: del.status };
}

(async () => {
  console.log(`\n=== ASC delete promoted IAP images ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
  console.log(`Bundle: ${BUNDLE_ID}`);

  const appId = await fetchAppId();
  const iaps = await fetchAllIaps(appId);
  const targets = ONLY_IDS ? iaps.filter(i => ONLY_IDS.has(i.productId)) : iaps;
  console.log(`IAPs in scope: ${targets.length} of ${iaps.length} total\n`);

  let deleted = 0, skipped = 0, failed = 0;
  for (const iap of targets) {
    console.log(`${iap.productId}  (${iap.id})`);
    const r = await deletePromotedImage(iap);
    if (r.deleted) deleted++;
    else if (r.skipped) skipped++;
    else if (r.error) failed++;
    await sleep(200);
  }

  console.log(`\n=== Done ===`);
  console.log(`  deleted: ${deleted}`);
  console.log(`  skipped (no image): ${skipped}`);
  console.log(`  failed: ${failed}`);
  if (DRY_RUN) console.log('\n(Dry run — nothing was actually deleted.)');
})().catch(e => { console.error('\n✖', e); process.exit(1); });
