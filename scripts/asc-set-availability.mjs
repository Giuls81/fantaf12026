#!/usr/bin/env node
// Fixes the MISSING_METADATA state on 38 cosmetic IAPs by creating the
// missing inAppPurchaseAvailability resource for each. IAPs created via
// the ASC API without this resource stay stuck at MISSING_METADATA even
// when price, screenshot and localization are all set — Apple uses
// availability as a gate for the READY_TO_SUBMIT transition.
//
// Root cause: seed-appstore-connect.mjs does not create availability;
// the ASC web UI does it automatically when you create an IAP through
// the form, which is why the manually-created Premium Season was the
// only IAP flipped to READY_TO_SUBMIT.
//
// Usage:
//   ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_PRIVATE_KEY_PATH=... \
//     node scripts/asc-set-availability.mjs
//
// Idempotent: skips any IAP that already has availability set.

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
async function asc(path, opts = {}) {
  const { method = 'GET', body = null } = opts;
  const res = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt()}`,
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

async function getAppId() {
  const r = await asc(`/v1/apps?filter%5BbundleId%5D=${encodeURIComponent(BUNDLE_ID)}`);
  return r.body.data[0].id;
}

async function getAllTerritories() {
  const all = [];
  let url = '/v1/territories?limit=200';
  while (url) {
    const r = await asc(url);
    for (const d of r.body.data || []) all.push(d.id);
    url = r.body.links?.next ? r.body.links.next.replace(API_ROOT, '') : null;
  }
  return all;
}

async function listAllCosmeticIaps(appId) {
  const all = [];
  let url = `/v1/apps/${appId}/inAppPurchasesV2?limit=200`;
  while (url) {
    const r = await asc(url);
    for (const d of r.body.data || []) {
      const pid = d.attributes?.productId;
      if (pid && pid.startsWith('fantaf1.cosmetic.')) {
        all.push({ id: d.id, productId: pid, state: d.attributes?.state });
      }
    }
    url = r.body.links?.next ? r.body.links.next.replace(API_ROOT, '') : null;
  }
  return all;
}

async function hasAvailability(iapId) {
  const r = await asc(`/v2/inAppPurchases/${iapId}/inAppPurchaseAvailability`);
  return r.ok && r.body?.data != null;
}

async function createAvailability(iapId, territoryIds) {
  const payload = {
    data: {
      type: 'inAppPurchaseAvailabilities',
      attributes: { availableInNewTerritories: true },
      relationships: {
        inAppPurchase: { data: { type: 'inAppPurchases', id: iapId } },
        availableTerritories: {
          data: territoryIds.map((id) => ({ type: 'territories', id })),
        },
      },
    },
  };
  return asc('/v1/inAppPurchaseAvailabilities', { method: 'POST', body: payload });
}

(async () => {
  console.log('=== ASC set IAP availability ===\n');

  const appId = await getAppId();
  console.log(`App: ${appId}`);

  const territories = await getAllTerritories();
  console.log(`Fetched ${territories.length} territories`);

  const iaps = await listAllCosmeticIaps(appId);
  console.log(`Found ${iaps.length} cosmetic IAPs\n`);

  let fixed = 0, skipped = 0, failed = 0;
  for (const iap of iaps) {
    const has = await hasAvailability(iap.id);
    if (has) {
      console.log(`· ${iap.productId} — already has availability, skip`);
      skipped += 1;
      continue;
    }
    const r = await createAvailability(iap.id, territories);
    if (r.ok) {
      console.log(`✓ ${iap.productId} — availability set (${territories.length} territories)`);
      fixed += 1;
    } else {
      console.error(`✖ ${iap.productId} — ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      failed += 1;
    }
    await sleep(250);
  }

  console.log(`\n=== Done: ${fixed} fixed, ${skipped} skipped, ${failed} failed ===`);
})().catch((e) => { console.error(e); process.exit(1); });
