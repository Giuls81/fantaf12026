#!/usr/bin/env node
// Diagnostic: for a given productId (or all if --all), print what ASC
// thinks is set/missing on the IAP so we can debug "Missing Metadata".
//
// Usage:
//   ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_PRIVATE_KEY_PATH=... \
//     node scripts/asc-diagnose-iap.mjs fantaf1.cosmetic.emblem.lightning
//
//   node scripts/asc-diagnose-iap.mjs --all   # summary of every IAP

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const BUNDLE_ID = 'com.fantaf1.app';
const API_ROOT = 'https://api.appstoreconnect.apple.com';

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER_ID = process.env.ASC_ISSUER_ID;
const KEY_PATH = process.env.ASC_PRIVATE_KEY_PATH;
if (!KEY_ID || !ISSUER_ID || !KEY_PATH) {
  console.error('Missing env vars.');
  process.exit(1);
}
const privateKeyPem = readFileSync(KEY_PATH, 'utf8');

const args = process.argv.slice(2);
const DO_ALL = args.includes('--all');
const TARGET_PID = args.find((a) => !a.startsWith('--'));

function b64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function jwt() {
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('SHA256');
  signer.update(signingInput);
  const sig = signer.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(sig)}`;
}
async function asc(path) {
  const res = await fetch(`${API_ROOT}${path}`, { headers: { Authorization: `Bearer ${jwt()}` } });
  const text = await res.text();
  try { return { status: res.status, body: text ? JSON.parse(text) : null }; }
  catch { return { status: res.status, body: text }; }
}

async function appId() {
  const { body } = await asc(`/v1/apps?filter%5BbundleId%5D=${encodeURIComponent(BUNDLE_ID)}`);
  return body.data[0].id;
}

async function listAllIaps(id) {
  const all = [];
  let url = `/v1/apps/${id}/inAppPurchasesV2?limit=200`;
  while (url) {
    const { body } = await asc(url);
    for (const d of body.data || []) {
      all.push({ id: d.id, productId: d.attributes?.productId, state: d.attributes?.state, name: d.attributes?.name });
    }
    url = body.links?.next?.replace(API_ROOT, '') ?? null;
  }
  return all;
}

async function diagnoseOne(iapId, productId) {
  console.log(`\n=== ${productId} (id ${iapId}) ===`);
  // 1. Top-level fields
  const main = await asc(`/v2/inAppPurchases/${iapId}`);
  const a = main.body?.data?.attributes ?? {};
  console.log('FULL ATTRIBUTES:');
  console.log(JSON.stringify(a, null, 2));
  console.log(`state: ${a.state}`);
  console.log(`reviewNote: ${a.reviewNote ?? '(none)'}`);
  console.log(`familySharable: ${a.familySharable}`);
  console.log(`contentHosting: ${a.contentHosting}`);

  // 2. Localizations
  const loc = await asc(`/v2/inAppPurchases/${iapId}/inAppPurchaseLocalizations?limit=20`);
  const locs = loc.body?.data ?? [];
  console.log(`localizations: ${locs.length}`);
  for (const l of locs) {
    const la = l.attributes || {};
    console.log(`  · ${la.locale} — name="${la.name}" state=${la.state} description.len=${(la.description || '').length}`);
  }

  // 3. Pricing
  const price = await asc(`/v2/inAppPurchases/${iapId}/iapPriceSchedule`);
  const priceOk = !!price.body?.data;
  console.log(`priceSchedule: ${priceOk ? 'SET' : 'MISSING'}`);

  // 4. Review screenshot — dump all attrs to check assetDeliveryState
  const shot = await asc(`/v2/inAppPurchases/${iapId}/appStoreReviewScreenshot`);
  if (shot.body?.data) {
    console.log('reviewScreenshot attributes:');
    console.log(JSON.stringify(shot.body.data.attributes, null, 2));
  } else {
    console.log('reviewScreenshot: MISSING');
  }

  // 5. Full IAP fetch including all relationships to spot anything missing
  console.log('\nFull include dump:');
  const full = await asc(`/v2/inAppPurchases/${iapId}?include=inAppPurchaseLocalizations,iapPriceSchedule,appStoreReviewScreenshot,content,promotedPurchase,images,pricePoints`);
  console.log(JSON.stringify(full.body?.data?.relationships ?? {}, null, 2));
  if (full.body?.included) {
    console.log('\n--- INCLUDED ---');
    for (const inc of full.body.included) {
      console.log(`[${inc.type} id=${inc.id}] attributes=`, JSON.stringify(inc.attributes).slice(0, 200));
    }
  }
}

(async () => {
  const id = await appId();
  console.log(`App: ${id}`);

  if (DO_ALL) {
    const iaps = await listAllIaps(id);
    const byState = {};
    for (const i of iaps) byState[i.state] = (byState[i.state] || 0) + 1;
    console.log(`Total: ${iaps.length}`);
    console.log('By state:', byState);
    console.log('');
    for (const i of iaps.filter((x) => x.state !== 'READY_TO_SUBMIT').slice(0, 5)) {
      console.log(`  · ${i.productId} — ${i.state}`);
    }
    return;
  }

  const iaps = await listAllIaps(id);
  const target = iaps.find((i) => i.productId === TARGET_PID);
  if (!target) {
    console.error(`No IAP with productId ${TARGET_PID}`);
    process.exit(1);
  }
  await diagnoseOne(target.id, target.productId);
})().catch((e) => { console.error(e); process.exit(1); });
